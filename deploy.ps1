<#
.SYNOPSIS
  Deploys the VDS MIS dashboard to Google Cloud Run and (re)creates the Cloud Scheduler job
  that triggers the daily Month-to-Date bank report emails.

.DESCRIPTION
  Secrets are NOT stored in Secret Manager. They are read from the local .env file at deploy
  time and passed to Cloud Run as environment variables (via a temporary env-vars file that is
  deleted afterwards). Run from the repo root. Re-running is safe: the service is redeployed
  and the scheduler job is updated in place.

  Required in .env:
    GOOGLE_SHEET_ID, SHEET_NAME, CREDENTIALS_PATH (service account key file),
    GMAIL_USER, GMAIL_APP_PASSWORD, EMAIL_SETTINGS_PASSPHRASE
  Generated automatically (and appended to .env) if missing:
    REPORT_CRON_SECRET

.PARAMETER ProjectId
  GCP project to deploy to. Default: vds-billing.

.PARAMETER Region
  Region for Cloud Run and Cloud Scheduler. Default: asia-south1 (Mumbai).

.PARAMETER DryRun
  Validate .env and print every gcloud command (secrets masked) without changing anything.

.EXAMPLE
  ./deploy.ps1 -DryRun
  ./deploy.ps1 -ProjectId my-gcp-project
#>
[CmdletBinding()]
param(
    [string]$ProjectId = 'vds-billing',
    [string]$Region = 'asia-south1',
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

# ---------------- Configuration ----------------
$ServiceName  = 'vds-mis-dashboard'
$SchedulerJob = 'vds-mis-mtd-reports'
$ScheduleCron = '30 19 * * 1-6'   # 7:30 PM, Mon-Sat. Use '30 19 * * *' to include Sundays.
$TimeZone     = 'Asia/Kolkata'
$EnvFile      = Join-Path $PSScriptRoot '.env'

$RequiredKeys = @(
    'GOOGLE_SHEET_ID', 'SHEET_NAME', 'CREDENTIALS_PATH',
    'GMAIL_USER', 'GMAIL_APP_PASSWORD', 'EMAIL_SETTINGS_PASSPHRASE'
)

# ---------------- Helpers ----------------
$script:SecretValues = @()

function Write-Step([string]$Text) { Write-Host "`n==> $Text" -ForegroundColor Cyan }

function Format-GcloudArgs([string[]]$GcloudArgs) {
    $text = ($GcloudArgs | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }) -join ' '
    foreach ($s in $script:SecretValues) { if ($s) { $text = $text.Replace($s, '***') } }
    return $text
}

# Runs gcloud. -ReadOnly commands also run during -DryRun; everything else is only printed.
# -Capture returns trimmed stdout as a string.
function Invoke-Gcloud {
    param(
        [Parameter(Mandatory)][string[]]$GcloudArgs,
        [switch]$Capture,
        [switch]$ReadOnly
    )
    if ($DryRun -and -not $ReadOnly) {
        Write-Host ('[dry-run] gcloud ' + (Format-GcloudArgs $GcloudArgs)) -ForegroundColor Yellow
        return ''
    }
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'   # gcloud writes progress to stderr; judge by exit code instead
    try {
        if ($Capture) { $out = & gcloud @GcloudArgs }
        else { & gcloud @GcloudArgs | Out-Host }
    }
    finally { $ErrorActionPreference = $prev }
    if ($LASTEXITCODE -ne 0) {
        throw ("gcloud " + (Format-GcloudArgs $GcloudArgs) + " failed (exit code $LASTEXITCODE)")
    }
    if ($Capture) { return (($out | Out-String).Trim()) }
}

function Read-DotEnv([string]$Path) {
    $vars = [ordered]@{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        $t = $line.Trim()
        if (-not $t -or $t.StartsWith('#')) { continue }
        $idx = $t.IndexOf('=')
        if ($idx -lt 1) { continue }
        $key = $t.Substring(0, $idx).Trim()
        $val = $t.Substring($idx + 1).Trim()
        $quoted = $val.Length -ge 2 -and (
            ($val.StartsWith('"') -and $val.EndsWith('"')) -or ($val.StartsWith("'") -and $val.EndsWith("'")))
        if ($quoted) { $val = $val.Substring(1, $val.Length - 2) }
        elseif ($val -match '\s#') { $val = ($val -split '\s#', 2)[0].Trim() }   # inline comment, like dotenv
        $vars[$key] = $val
    }
    return $vars
}

function New-RandomSecret {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    $rng.Dispose()
    return (($bytes | ForEach-Object { $_.ToString('x2') }) -join '')
}

# ---------------- Preflight ----------------
Write-Step 'Preflight checks'

if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
    throw 'gcloud CLI not found. Install it from https://cloud.google.com/sdk/docs/install and run "gcloud auth login".'
}
if (-not (Test-Path -LiteralPath $EnvFile)) { throw ".env not found at $EnvFile" }
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'Dockerfile'))) { throw 'Dockerfile not found - run this script from the repo root.' }

$account = Invoke-Gcloud -ReadOnly -Capture @('auth', 'list', '--filter=status:ACTIVE', '--format=value(account)')
if (-not $account) { throw 'No active gcloud account. Run "gcloud auth login" first.' }
Write-Host "gcloud account : $account"

if (-not $ProjectId) {
    $ProjectId = Invoke-Gcloud -ReadOnly -Capture @('config', 'get-value', 'project', '--quiet')
}
if (-not $ProjectId) { throw 'No GCP project. Pass -ProjectId or run "gcloud config set project <id>".' }
Write-Host "project        : $ProjectId"
Write-Host "region         : $Region"
if ($DryRun) { Write-Host 'DRY RUN - nothing will be changed.' -ForegroundColor Yellow }

# ---------------- Read .env ----------------
Write-Step 'Reading .env'
$envVars = Read-DotEnv $EnvFile

$missing = $RequiredKeys | Where-Object { -not $envVars[$_] }
if ($missing) { throw ('Missing in .env: ' + ($missing -join ', ')) }

$credPath = $envVars['CREDENTIALS_PATH']
if (-not [System.IO.Path]::IsPathRooted($credPath)) { $credPath = Join-Path $PSScriptRoot $credPath }
if (-not (Test-Path -LiteralPath $credPath)) { throw "Service account key file not found: $credPath" }
$credJson = (Get-Content -LiteralPath $credPath -Raw).Trim()
$serviceAccountEmail = ($credJson | ConvertFrom-Json).client_email

if (-not $envVars['REPORT_CRON_SECRET']) {
    $envVars['REPORT_CRON_SECRET'] = New-RandomSecret
    if ($DryRun) {
        Write-Host 'REPORT_CRON_SECRET missing - would generate one and append it to .env'
    }
    else {
        $prefix = ''
        $raw = Get-Content -LiteralPath $EnvFile -Raw
        if ($raw -and -not $raw.EndsWith("`n")) { $prefix = "`r`n" }
        Add-Content -LiteralPath $EnvFile -Value ($prefix + 'REPORT_CRON_SECRET=' + $envVars['REPORT_CRON_SECRET'])
        Write-Host 'Generated REPORT_CRON_SECRET and appended it to .env'
    }
}

# Variables sent to Cloud Run (PORT is reserved by Cloud Run; CREDENTIALS_PATH is replaced by the JSON content)
$cloudEnv = [ordered]@{
    GOOGLE_SHEET_ID           = $envVars['GOOGLE_SHEET_ID']
    SHEET_NAME                = $envVars['SHEET_NAME']
    GOOGLE_CREDENTIALS_JSON   = $credJson
    GMAIL_USER                = $envVars['GMAIL_USER']
    GMAIL_APP_PASSWORD        = $envVars['GMAIL_APP_PASSWORD']
    EMAIL_SETTINGS_PASSPHRASE = $envVars['EMAIL_SETTINGS_PASSPHRASE']
    REPORT_CRON_SECRET        = $envVars['REPORT_CRON_SECRET']
}
foreach ($optional in 'MAIL_FROM_NAME', 'MAIL_FROM_ADDRESS') {
    if ($envVars[$optional]) { $cloudEnv[$optional] = $envVars[$optional] }
}
$script:SecretValues = @($credJson, $envVars['GMAIL_APP_PASSWORD'], $envVars['EMAIL_SETTINGS_PASSPHRASE'], $envVars['REPORT_CRON_SECRET'])
Write-Host ('Environment variables for Cloud Run: ' + ($cloudEnv.Keys -join ', '))

# ---------------- Enable APIs ----------------
Write-Step 'Enabling required Google Cloud APIs'
Invoke-Gcloud @('services', 'enable', 'run.googleapis.com', 'cloudbuild.googleapis.com',
    'artifactregistry.googleapis.com', 'cloudscheduler.googleapis.com', '--project', $ProjectId)

# ---------------- Deploy to Cloud Run ----------------
Write-Step "Deploying '$ServiceName' to Cloud Run (builds the Dockerfile with Cloud Build)"
$envYaml = Join-Path ([System.IO.Path]::GetTempPath()) ("vds-mis-env-" + [guid]::NewGuid().ToString('N') + '.yaml')
try {
    if (-not $DryRun) {
        # JSON strings are valid YAML double-quoted scalars; avoids comma/quote problems of --set-env-vars
        $yaml = ($cloudEnv.GetEnumerator() | ForEach-Object {
                $_.Key + ': ' + (ConvertTo-Json -InputObject ([string]$_.Value) -Compress)
            }) -join "`n"
        [System.IO.File]::WriteAllText($envYaml, $yaml + "`n", (New-Object System.Text.UTF8Encoding($false)))
    }
    Invoke-Gcloud @('run', 'deploy', $ServiceName,
        '--source', $PSScriptRoot,
        '--project', $ProjectId,
        '--region', $Region,
        '--allow-unauthenticated',
        '--memory', '2Gi',
        '--cpu', '1',
        '--timeout', '600',
        '--min-instances', '0',
        '--max-instances', '2',
        '--env-vars-file', $envYaml,
        '--quiet')
}
finally {
    if (Test-Path -LiteralPath $envYaml) { Remove-Item -LiteralPath $envYaml -Force }
}

$serviceUrl = Invoke-Gcloud -Capture @('run', 'services', 'describe', $ServiceName,
    '--project', $ProjectId, '--region', $Region, '--format=value(status.url)')
if ($DryRun -or -not $serviceUrl) { $serviceUrl = "https://$ServiceName-<hash>.$Region.run.app" }
Write-Host "Service URL: $serviceUrl"

# ---------------- Cloud Scheduler ----------------
Write-Step "Configuring Cloud Scheduler job '$SchedulerJob' ($ScheduleCron, $TimeZone)"
try {
    $existingJobs = Invoke-Gcloud -ReadOnly -Capture @('scheduler', 'jobs', 'list',
        '--project', $ProjectId, '--location', $Region, '--format=value(name)')
}
catch {
    if (-not $DryRun) { throw }
    Write-Host "Could not list scheduler jobs (dry run, continuing): $($_.Exception.Message)" -ForegroundColor DarkYellow
    $existingJobs = ''
}
$jobExists = [bool]($existingJobs -split "\r?\n" | Where-Object { $_.Trim() -match ('(^|/)' + [regex]::Escape($SchedulerJob) + '$') })

$authHeader = 'Authorization=Bearer ' + $envVars['REPORT_CRON_SECRET']
$jobArgs = @(
    '--project', $ProjectId,
    '--location', $Region,
    '--schedule', $ScheduleCron,
    '--time-zone', $TimeZone,
    '--uri', "$serviceUrl/api/send-reports",
    '--http-method', 'POST',
    '--attempt-deadline', '15m',
    '--max-retry-attempts', '0',  # a retried timeout could double-send emails
    '--format', 'none'            # gcloud would otherwise echo the Authorization header (the secret) back
)
if ($jobExists) {
    Invoke-Gcloud (@('scheduler', 'jobs', 'update', 'http', $SchedulerJob) + $jobArgs + @('--update-headers', $authHeader))
}
else {
    Invoke-Gcloud (@('scheduler', 'jobs', 'create', 'http', $SchedulerJob) + $jobArgs + @('--headers', $authHeader))
}

# ---------------- Summary ----------------
Write-Step 'Done'
Write-Host "Dashboard      : $serviceUrl"
Write-Host "Schedule       : $ScheduleCron ($TimeZone) -> POST $serviceUrl/api/send-reports"
Write-Host ''
Write-Host 'Before the first real run, make sure the Google Sheet has:' -ForegroundColor Cyan
Write-Host "  - the service account shared as EDITOR: $serviceAccountEmail"
Write-Host '  - a "Recipients" tab  (columns: Bank | To | Cc | Bcc | Active)'
Write-Host '  - an empty "EmailSettings" tab'
Write-Host ''
Write-Host 'Test it:' -ForegroundColor Cyan
Write-Host "  gcloud scheduler jobs run $SchedulerJob --location $Region --project $ProjectId"
Write-Host "  (dry run, no emails: POST $serviceUrl/api/send-reports?dryRun=true with header 'Authorization: Bearer <REPORT_CRON_SECRET from .env>')"
Write-Host ''
Write-Host 'Note: .env values are stored as plain Cloud Run environment variables (visible to anyone with view access to the project).' -ForegroundColor DarkYellow
$global:LASTEXITCODE = 0

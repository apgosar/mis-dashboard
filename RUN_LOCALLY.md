# Running Locally

All commands are run from the project root (`C:\VDS\mis_dashboard`) in PowerShell.

## Deploy to Google Cloud Run

Reads secrets from the local `.env`, builds the Dockerfile with Cloud Build, deploys the service and creates/updates the Cloud Scheduler job.

```powershell
.\deploy.ps1
```

Preview every step without executing anything (secrets are masked):

```powershell
.\deploy.ps1 -DryRun
```

Override the project or region (defaults: `vds-billing`, `asia-south1`):

```powershell
.\deploy.ps1 -ProjectId vds-billing -Region asia-south1
```

## Run the app locally

```powershell
npm install
npm start
```

Dashboard: http://localhost:3000

If port 3000 is already taken, use another port:

```powershell
$env:PORT = 3099; npm start
```

## Test the scheduled email job

Trigger the Cloud Scheduler job now (sends real emails to the active banks in the `Recipients` tab):

```powershell
gcloud scheduler jobs run vds-mis-mtd-reports --location asia-south1 --project vds-billing
```

Dry run against the live service (renders reports, sends nothing). Use the `REPORT_CRON_SECRET` value from `.env`:

```powershell
curl.exe -X POST "https://vds-mis-dashboard-2exmfzwjba-el.a.run.app/api/send-reports?dryRun=true" -H "Authorization: Bearer <REPORT_CRON_SECRET>" -d ""
```

Limit it to one bank:

```powershell
curl.exe -X POST "https://vds-mis-dashboard-2exmfzwjba-el.a.run.app/api/send-reports?dryRun=true&bank=ICICI%20BANK" -H "Authorization: Bearer <REPORT_CRON_SECRET>" -d ""
```

## Check logs

```powershell
gcloud run services logs read vds-mis-dashboard --region asia-south1 --project vds-billing --limit 100
```

# VDS Advisory — MIS Dashboard

A real-time Management Information System (MIS) dashboard for VDS Advisory that connects to Google Sheets and visualizes valuation case data with interactive charts, KPIs, and drill-down tables.

![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white)
![Chart.js](https://img.shields.io/badge/Chart.js-4.x-FF6384?logo=chartdotjs&logoColor=white)

---

## Features

- **Live KPI Cards** — Total Cases, Avg Visit TAT, Avg Report TAT (auto-animated)
- **TAT Breakup** — Color-coded T+0 through T+4+ buckets with click-to-drill-down
- **Today's Schedule** — Collapsible table showing cases with "Today Schedule" status
- **Interactive Charts** — Case Status (doughnut), Property Type, Location, Engineer Efficiency, Bank Distribution, Report Generation Efficiency
- **Drill-Down** — Click any chart segment/bar to view detailed case records
- **"Others" Aggregation** — Charts with many entries group the tail into clickable "Others"
- **Month Filter** — Filter all data by Initiation Date month
- **Auto-Refresh** — Dashboard refreshes every 60 seconds
- **Responsive** — Charts resize and re-render on window resize

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js, Express |
| Frontend | Vanilla HTML/CSS/JS |
| Charts | Chart.js (CDN) |
| Data Source | Google Sheets API v4 |
| Auth | Google Service Account |

---

## Project Structure

```
mis_dashboard/
├── server.js              # Express server, metrics calculation, report/email endpoints
├── sheets.js              # Google Sheets read/write helpers
├── emailConfig.js         # Recipients tab + email settings (graph selection)
├── reportMailer.js        # Renders charts, builds email + Excel, sends via Gmail
├── Dockerfile             # Cloud Run container (Node + Chromium)
├── deploy.ps1             # One-step Cloud Run + Cloud Scheduler deployment
├── package.json
├── .env                   # Environment variables (not committed)
├── .gitignore
├── decent-subset-*.json   # Google service account credentials (not committed)
└── public/
    ├── index.html         # Dashboard HTML structure
    ├── app.js             # Frontend logic, chart rendering, drill-down
    └── style.css          # Dark theme styling
```

---

## Google Sheet Setup

### Required Columns

Your Google Sheet must have the following column headers (exact names):

| Column | Description | Example |
|--------|-------------|---------|
| `Sr no` | Serial number | `1` |
| `Borrower Name` | Borrower / property name | `Jai Malhar CHS` |
| `Bank Name` | Lending bank | `HDFC Bank` |
| `Branch` | Bank branch | `Andheri` |
| `Case Type` | Type of case | `Valuation` |
| `Address` | Property address | `Plot 42, Sector 5...` |
| `Location` | City/area | `Andheri` |
| `Property type` | Property type | `Flat` |
| `Engineer Name` | Assigned engineer | `Swapnil Bhoir` |
| `Initiation Date` | Case initiation date | `3-Dec-2025` |
| `Visit Date` | Site visit date | `5-Dec-2025` |
| `Report Date` | Report submission date | `6-Dec-2025` |
| `Status` | Current status | `Report Released` |
| `Prepared by` | Report preparer | `Satish` |
| `TAT (Visit)` | Visit turnaround (legacy) | `2` |
| `TAT (Report)` | Report turnaround (legacy) | `3` |
| `Query Time (Days)` | Time spent in Query status | `0.5` |
| `Query Description` | Details of the query | `Pending document X` |

### Date Format

Dates must be in **DD-Mon-YYYY** format (e.g., `3-Dec-2025`, `30-Sep-2025`).

### Status Values

The dashboard recognizes these status values for special behavior:
- **`Report Released`** — Used for TAT Breakup calculation
- **`Today Schedule`** — Shown in the "Today's Schedule" section

---

## Data Filtering & Inclusion Rules

It is important to understand which cases are included in each metric, especially when data is missing (e.g., empty dates). 

### 1. Global Filters (Month & Bank)
The top dropdowns (Month and Bank) act as **global filters**. Changing these will filter the *entire dataset* before any metrics or charts are calculated.
*   **Month Filter:** Filters cases based on the **`Initiation Date`** column. If a record has an invalid or empty Initiation Date, it will only appear when "All Months" is selected.
*   **Bank Filter:** Filters cases based on an exact match with the **`Bank Name`** column.

### 2. Main KPI Cards
*   **Total Cases:** Shows the absolute count of all rows that pass the global filters, *regardless* of whether they have empty dates, missing statuses, or blank fields.
*   **Avg Visit TAT:** Calculates `(Visit Date - Initiation Date) - Query Time (Days)`. It **EXCLUDES** any row where either the Visit Date or Initiation Date is empty or invalid. *Note: Excludes Sundays.*
*   **Avg Report TAT:** Calculates `(Report Date - Initiation Date) - Query Time (Days)`. It **EXCLUDES** any row where either the Report Date or Initiation Date is empty or invalid. *Note: Excludes Sundays.*

### 3. TAT Breakup Section
The TAT Breakup section (T+0, T+1, etc.) calculates `(Report Date - Initiation Date) - Query Time (Days)` to determine the bucket.
*   It **ONLY INCLUDES** rows where the `Status` is exactly **"Report Released"**.
*   It **EXCLUDES** rows where either the Report Date or Initiation Date is empty.
*   *Note: An empty 'Visit Date' does NOT exclude a case from this section.*
*   *Note: Excludes Sundays in calculation.*

### 4. Overview Charts
All charts (Case Status, Property Type, Location, etc.) simply count the frequency of text in their respective columns for rows passing the global filters.
*   If a row has an **empty value** for that specific column, it is simply **not counted** in that specific chart. It is *not* removed from the rest of the dashboard.

### 5. Today's Schedule
*   **ONLY INCLUDES** rows where the `Status` is exactly **"Today Schedule"**.

---

## Local Development

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or higher
- A Google Cloud service account with Google Sheets API enabled

### 1. Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/mis-dashboard.git
cd mis-dashboard
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment

Create a `.env` file:

```env
GOOGLE_SHEET_ID=your_google_sheet_id_here
SHEET_NAME=Reports
CREDENTIALS_PATH=./your-credentials-file.json
PORT=3000
```

Place your Google service account JSON key file in the project root.

### 4. Run the Server

```bash
node server.js
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Deployment (Google Cloud Run)

The app runs on **Cloud Run** (a container that includes Chromium for PDF export and email chart rendering). A **Cloud Scheduler** job triggers the daily Month-to-Date bank emails. Everything is deployed by one script: `deploy.ps1`.

### 1. Prerequisites

- [gcloud CLI](https://cloud.google.com/sdk/docs/install) installed and logged in (`gcloud auth login`), and a GCP project with billing enabled (`gcloud config set project <id>`)
- A `.env` file in the repo root with these keys (secrets stay local; the script injects them into Cloud Run at deploy time):

| Key | Value |
|-----|-------|
| `GOOGLE_SHEET_ID` | Your Google Sheet ID |
| `SHEET_NAME` | Main data tab name, e.g. `Reports` |
| `CREDENTIALS_PATH` | Path to the service account key file, e.g. `./decent-subset-*.json` |
| `GMAIL_USER` | Gmail address the reports are sent from |
| `GMAIL_APP_PASSWORD` | A Google **App Password** for that account (requires 2-Step Verification) |
| `MAIL_FROM_NAME` | *(optional)* Sender name recipients see, default `VDS Advisory MIS` |
| `MAIL_FROM_ADDRESS` | *(optional)* Sender address recipients see, default `GMAIL_USER`. Gmail only allows the account's own address or a verified "Send mail as" alias |
| `EMAIL_SETTINGS_PASSPHRASE` | Passphrase required to save the dashboard's *Email Settings* |
| `REPORT_CRON_SECRET` | *(optional)* Generated and appended to `.env` by the script if missing |

- The Google Sheet must be shared with the service account as **Editor**, and contain the `Recipients` and `EmailSettings` tabs (see below).

### 2. Deploy

```powershell
./deploy.ps1 -DryRun                 # validate .env and preview every command (secrets masked)
./deploy.ps1 -ProjectId <your-id>    # deploy for real
```

The script enables the required APIs, builds and deploys the service to Cloud Run (`asia-south1`), and creates/updates the Cloud Scheduler job. Re-running it redeploys and updates the job in place. The schedule is the `$ScheduleCron` variable at the top of the script (default `30 19 * * 1-6` = 7:30 PM IST, Mon-Sat).

> `.env` values end up as plain Cloud Run environment variables (visible to anyone with view access to the GCP project). Keep `.env` out of git (it is in `.gitignore`).

---

## Scheduled Bank Emails

Every evening each bank receives its own **Month-to-Date** report: the selected graphs (plus KPI summary and TAT breakup) in the email body, and the full case list attached as an Excel file. Cases are sorted newest Initiation Date first.

### `Recipients` tab

Create a tab named exactly `Recipients` in the Google Sheet, header in row 1, one row per bank:

| Bank | To | Cc | Bcc | Active |
|------|----|----|-----|--------|
| ICICI BANK | a@icici.com, b@icici.com | mgr@icici.com | ops@vdsadvisory.in | Y |
| BAJAJ | x@bajaj.com | | | Y |
| HDFC | y@hdfc.com | z@hdfc.com | | N |

- `Bank` must match the main tab's `Bank Name` values (case-insensitive).
- `To` / `Cc` / `Bcc` accept several addresses separated by `,` or `;`. `To` is required.
- `Active`: `Y` or blank sends; `N` skips the bank.
- Invalid addresses are ignored, duplicates across To/Cc/Bcc are removed, and banks with no cases month-to-date are skipped.

### `EmailSettings` tab and the Email Settings button

Create an empty tab named `EmailSettings`. In the dashboard, click **Email Settings**, tick the sections to include (KPI Summary, TAT Breakup and the five graphs), enter the passphrase and save. The choice applies to all banks and is stored in that tab.

### Testing

```bash
# Dry run: renders everything and reports what would be sent, but sends nothing
curl -X POST -H "Authorization: Bearer <REPORT_CRON_SECRET>" "<service-url>/api/send-reports?dryRun=true&bank=ICICI%20BANK"
```

Optional query parameters: `bank=<name>` (single bank), `date=YYYY-MM-DD` (default: today in IST). To trigger the real job immediately: `gcloud scheduler jobs run vds-mis-mtd-reports --location asia-south1`.

---

## Updating the Google Sheet

The dashboard reads live from Google Sheets on every request. To update the data:

### Adding / Editing Rows

1. Open your Google Sheet directly in Google Sheets
2. Add new rows or edit existing data — no code changes needed
3. The dashboard will show updated data on the next auto-refresh (every 60 seconds) or manual refresh

### Changing Sheet Structure

If you need to **rename columns**, **add new columns**, or **change the sheet name**:

1. **Renaming a column** — Update the column header in the sheet, then update the corresponding field name in `server.js` (search for the old column name in `parseRows`, `countBy`, or metrics calculation)
2. **Changing sheet name** — Update the `SHEET_NAME` value in your `.env` file (local), then re-run `deploy.ps1` (cloud)
3. **Switching to a different Google Sheet** — Update `GOOGLE_SHEET_ID` in `.env`, then re-run `deploy.ps1` for the cloud deployment

### Connecting a New Google Sheet

1. Copy the Sheet ID from the URL: `https://docs.google.com/spreadsheets/d/`**`SHEET_ID_HERE`**`/edit`
2. **Share the sheet** with your service account email (found in your credentials JSON under `client_email`) — give **Editor** access (needed to save the dashboard's Email Settings)
3. Update `GOOGLE_SHEET_ID` in your environment
4. Restart the server (local) or re-run `deploy.ps1` (cloud)

### Adding a New Status Value

To add a new status (e.g., "On Hold") that needs special dashboard handling:
1. Add the status value in your Google Sheet's `Status` column
2. It will automatically appear in the **Case Status Distribution** chart
3. If it needs a dedicated section (like "Today Schedule"), modify `server.js` accordingly

---

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /` | Dashboard UI |
| `GET /api/data?month=all` | Raw row data (with optional month filter) |
| `GET /api/metrics?month=all` | Aggregated metrics, charts data, TAT breakup, schedule |

---

## License

Private — VDS Advisory

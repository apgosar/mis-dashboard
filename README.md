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
├── server.js              # Express server, Google Sheets API, metrics calculation
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
| `Property typ` | Property type | `Flat` |
| `Engineer Name` | Assigned engineer | `Swapnil Bhoir` |
| `Initiation Date` | Case initiation date | `3-Dec-2025` |
| `Visit Date` | Site visit date | `5-Dec-2025` |
| `Report Date` | Report submission date | `6-Dec-2025` |
| `Status` | Current status | `Report Released` |
| `Prepared by` | Report preparer | `Satish` |
| `TAT (Visit)` | Visit turnaround (legacy) | `2` |
| `TAT (Report)` | Report turnaround (legacy) | `3` |
| `Query Time (Days)` | Time spent in Query status | `0.5` |

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

## Deployment (Render)

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/mis-dashboard.git
git branch -M main
git push -u origin main
```

### 2. Create a Render Web Service

1. Go to [dashboard.render.com](https://dashboard.render.com)
2. Click **New +** → **Web Service**
3. Connect your GitHub repository

| Setting | Value |
|---------|-------|
| Build Command | `npm install` |
| Start Command | `node server.js` |
| Instance Type | Free |

### 3. Set Environment Variables

In Render → **Environment** tab:

| Key | Value |
|-----|-------|
| `GOOGLE_SHEET_ID` | Your Google Sheet ID |
| `SHEET_NAME` | `Reports` |
| `GOOGLE_CREDENTIALS_JSON` | *(entire content of your service account JSON file)* |

> **Note:** On Render, credentials are passed via `GOOGLE_CREDENTIALS_JSON` env var (the full JSON string), not as a file.

### 4. Deploy

Click **Deploy**. Your dashboard will be live at `https://your-app.onrender.com`.

Future `git push` to `main` will **auto-deploy**.

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
2. **Changing sheet name** — Update the `SHEET_NAME` value in your `.env` file (local) or Render environment variables (cloud)
3. **Switching to a different Google Sheet** — Update `GOOGLE_SHEET_ID` in `.env` or Render environment variables

### Connecting a New Google Sheet

1. Copy the Sheet ID from the URL: `https://docs.google.com/spreadsheets/d/`**`SHEET_ID_HERE`**`/edit`
2. **Share the sheet** with your service account email (found in your credentials JSON under `client_email`) — give **Viewer** access
3. Update `GOOGLE_SHEET_ID` in your environment
4. Restart the server (local) or redeploy (Render)

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

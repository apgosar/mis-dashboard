require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const path = require('path');
const puppeteer = require('puppeteer');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_NAME = process.env.SHEET_NAME || 'Sheet 1';
const CREDENTIALS_PATH = process.env.CREDENTIALS_PATH || './credentials.json';

// --- Google Sheets Auth ---
async function getAuthClient() {
  let authOptions;

  // Cloud: use GOOGLE_CREDENTIALS_JSON env var (paste full JSON content)
  if (process.env.GOOGLE_CREDENTIALS_JSON) {
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
    authOptions = {
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    };
  } else {
    // Local: use key file
    authOptions = {
      keyFile: path.resolve(__dirname, CREDENTIALS_PATH),
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    };
  }

  const auth = new google.auth.GoogleAuth(authOptions);
  return auth.getClient();
}

async function fetchSheetData() {
  const authClient = await getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth: authClient });
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: SHEET_NAME,
  });
  return response.data.values || [];
}

// --- Helpers ---
function parseRows(rawData) {
  if (rawData.length < 2) return [];
  const headers = rawData[0].map(h => h.trim());
  const rows = rawData.slice(1).map(row => {
    const obj = {};
    headers.forEach((header, i) => {
      obj[header] = row[i] !== undefined ? row[i].trim() : '';
    });
    return obj;
  });
  return rows;
}

// Parse "Initiation Date" to extract month key like "2025-01"
// Handles formats: "30-Sep-2025", "1-Oct-2025" (DD-Mon-YYYY)
const MONTH_ABBR = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

function getMonthKey(dateStr) {
  if (!dateStr) return null;
  const s = dateStr.trim();
  let d = null;

  // Try DD-Mon-YYYY (e.g. "30-Sep-2025", "1-Oct-2025")
  const abbrMatch = s.match(/^(\d{1,2})[\-\/\s]([A-Za-z]{3})[\-\/\s](\d{4})$/);
  if (abbrMatch) {
    const day = parseInt(abbrMatch[1]);
    const mon = MONTH_ABBR[abbrMatch[2].toLowerCase()];
    const year = parseInt(abbrMatch[3]);
    if (mon !== undefined) {
      d = new Date(year, mon, day);
    }
  }

  // Fallback: try native Date parsing
  if (!d || isNaN(d.getTime())) {
    d = new Date(s);
  }

  if (!d || isNaN(d.getTime())) return null;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

// Parse a date string to a Date object (reuses MONTH_ABBR)
function parseDate(dateStr) {
  if (!dateStr) return null;
  const s = dateStr.trim();
  const abbrMatch = s.match(/^(\d{1,2})[\-\/\s]([A-Za-z]{3})[\-\/\s](\d{4})$/);
  if (abbrMatch) {
    const day = parseInt(abbrMatch[1]);
    const mon = MONTH_ABBR[abbrMatch[2].toLowerCase()];
    const year = parseInt(abbrMatch[3]);
    if (mon !== undefined) {
      return new Date(year, mon, day);
    }
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// Count business days between two dates (excludes Sundays)
function businessDaysDiff(startDate, endDate) {
  if (endDate < startDate) return 0;
  let count = 0;
  const cur = new Date(startDate);
  cur.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);
  while (cur < end) {
    cur.setDate(cur.getDate() + 1);
    if (cur.getDay() !== 0) count++; // 0 = Sunday
  }
  return count;
}

// TAT Breakup for "Report Released" cases: Report Date - Initiation Date (excl. Sundays)
function getTATBreakup(rows) {
  const buckets = { 'T+0': 0, 'T+1': 0, 'T+2': 0, 'T+3': 0, 'T+4+': 0 };
  const bucketRows = { 'T+0': [], 'T+1': [], 'T+2': [], 'T+3': [], 'T+4+': [] };
  let totalCases = 0;

  rows.forEach(row => {
    if (row['Status'] !== 'Report Released') return;
    const initDate = parseDate(row['Initiation Date']);
    const reportDate = parseDate(row['Report Date']);
    if (!initDate || !reportDate) return;

    let diffDays = businessDaysDiff(initDate, reportDate);
    const queryTime = parseFloat(row['Query Time (Days)']);
    if (!isNaN(queryTime) && queryTime > 0) {
      diffDays = Math.max(0, diffDays - queryTime);
    }
    
    totalCases++;

    let bucket;
    const roundedDiff = Math.round(diffDays);
    if (roundedDiff <= 0) bucket = 'T+0';
    else if (roundedDiff === 1) bucket = 'T+1';
    else if (roundedDiff === 2) bucket = 'T+2';
    else if (roundedDiff === 3) bucket = 'T+3';
    else bucket = 'T+4+';

    buckets[bucket]++;
    bucketRows[bucket].push(row['Sr no']);
  });

  return { buckets, bucketRows, totalCases };
}

// Calculate Avg Visit TAT = Visit Date - Initiation Date (excl. Sundays)
function calcAvgVisitTAT(rows) {
  let sum = 0, count = 0;
  rows.forEach(row => {
    const initDate = parseDate(row['Initiation Date']);
    const visitDate = parseDate(row['Visit Date']);
    if (!initDate || !visitDate) return;
    
    let diff = businessDaysDiff(initDate, visitDate);
    const queryTime = parseFloat(row['Query Time (Days)']);
    if (!isNaN(queryTime) && queryTime > 0) {
      diff = Math.max(0, diff - queryTime);
    }

    if (diff >= 0) { sum += diff; count++; }
  });
  return count > 0 ? Math.round((sum / count) * 100) / 100 : 0;
}

// Calculate Avg Report TAT = Report Date - Initiation Date (excl. Sundays)
function calcAvgReportTAT(rows) {
  let sum = 0, count = 0;
  rows.forEach(row => {
    const initDate = parseDate(row['Initiation Date']);
    const reportDate = parseDate(row['Report Date']);
    if (!initDate || !reportDate) return;
    
    let diff = businessDaysDiff(initDate, reportDate);
    const queryTime = parseFloat(row['Query Time (Days)']);
    if (!isNaN(queryTime) && queryTime > 0) {
      diff = Math.max(0, diff - queryTime);
    }

    if (diff >= 0) { sum += diff; count++; }
  });
  return count > 0 ? Math.round((sum / count) * 100) / 100 : 0;
}

function getAvailableMonths(rows) {
  const monthSet = new Map();
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  rows.forEach(row => {
    const key = getMonthKey(row['Initiation Date']);
    if (key && !monthSet.has(key)) {
      const [y, m] = key.split('-');
      monthSet.set(key, `${monthNames[parseInt(m) - 1]} ${y}`);
    }
  });
  // Sort descending (newest first)
  return Array.from(monthSet.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([value, label]) => ({ value, label }));
}

function filterByMonth(rows, month) {
  if (!month || month === 'all') return rows;
  return rows.filter(row => getMonthKey(row['Initiation Date']) === month);
}

function filterByBank(rows, bank) {
  if (!bank || bank === 'all') return rows;
  return rows.filter(row => (row['Bank Name'] || '') === bank);
}

function getAvailableBanks(rows) {
  const bankSet = new Set();
  rows.forEach(row => {
    const bank = (row['Bank Name'] || '').trim();
    if (bank) bankSet.add(bank);
  });
  return Array.from(bankSet).sort();
}

function countBy(rows, field) {
  const counts = {};
  rows.forEach(row => {
    const val = row[field] || 'Unknown';
    if (val && val !== '') {
      counts[val] = (counts[val] || 0) + 1;
    }
  });
  return counts;
}

// Case-insensitive version: groups 'wada' and 'Wada' together, using title-case label
function countByCaseInsensitive(rows, field) {
  const counts = {};
  const labelMap = {}; // lowercase -> preferred label (first seen or Title Case)
  rows.forEach(row => {
    const raw = (row[field] || '').trim();
    if (!raw) return;
    const key = raw.toLowerCase();
    if (!labelMap[key]) {
      // Use Title Case: capitalize first letter of each word
      labelMap[key] = raw.replace(/\b\w/g, c => c.toUpperCase());
    }
    counts[key] = (counts[key] || 0) + 1;
  });
  // Re-key with the nice label
  const result = {};
  for (const [key, count] of Object.entries(counts)) {
    result[labelMap[key]] = count;
  }
  return result;
}

function averageTAT(rows, field) {
  let sum = 0;
  let count = 0;
  rows.forEach(row => {
    const val = parseFloat(row[field]);
    if (!isNaN(val)) {
      sum += val;
      count++;
    }
  });
  return count > 0 ? Math.round((sum / count) * 100) / 100 : 0;
}

function sortByCountDesc(obj) {
  return Object.entries(obj)
    .sort((a, b) => b[1] - a[1])
    .reduce((sorted, [key, val]) => {
      sorted[key] = val;
      return sorted;
    }, {});
}

function calcAvgQueryTime(rows) {
  let sum = 0, count = 0;
  rows.forEach(row => {
    const queryTime = parseFloat(row['Query Time (Days)']);
    if (!isNaN(queryTime) && queryTime > 0) {
      sum += queryTime;
      count++;
    }
  });
  return count > 0 ? Math.round((sum / count) * 100) / 100 : 0;
}

function countCasesWithQueries(rows) {
  let count = 0;
  rows.forEach(row => {
    const queryTime = parseFloat(row['Query Time (Days)']);
    if (!isNaN(queryTime) && queryTime > 0) {
      count++;
    }
  });
  return count;
}

function calcQueryTimeByField(rows, field) {
  const sums = {};
  const counts = {};
  
  rows.forEach(row => {
    const val = (row[field] || '').trim();
    const queryTime = parseFloat(row['Query Time (Days)']);
    
    if (val && !isNaN(queryTime) && queryTime > 0) {
      sums[val] = (sums[val] || 0) + queryTime;
      counts[val] = (counts[val] || 0) + 1;
    }
  });
  
  const avgs = {};
  for (const key in sums) {
    avgs[key] = Math.round((sums[key] / counts[key]) * 100) / 100;
  }
  return sortByCountDesc(avgs);
}

function countQueryCasesByField(rows, field) {
  const counts = {};
  rows.forEach(row => {
    const val = (row[field] || '').trim();
    const queryTime = parseFloat(row['Query Time (Days)']);
    if (val && !isNaN(queryTime) && queryTime > 0) {
      counts[val] = (counts[val] || 0) + 1;
    }
  });
  return sortByCountDesc(counts);
}

// --- API Routes ---

// Return raw data as JSON
app.get('/api/data', async (req, res) => {
  try {
    const rawData = await fetchSheetData();
    const allRows = parseRows(rawData);
    let rows = filterByMonth(allRows, req.query.month);
    rows = filterByBank(rows, req.query.bank);

    // Exclude 'Query' status with empty 'Visit Date'
    const validRows = rows.filter(row => {
      const status = (row['Status'] || '').trim();
      const visitDate = (row['Visit Date'] || '').trim();
      return !(status === 'Query' && !visitDate);
    });

    res.json({ success: true, count: validRows.length, data: validRows });
  } catch (error) {
    console.error('Error fetching data:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PDF Export Endpoint using Puppeteer
app.get('/api/export-pdf', async (req, res) => {
  try {
    const { type, date, bank, sections } = req.query;
    
    // Launch headless browser
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    // Construct local URL for the print template
    const url = `http://localhost:${PORT}/report-print.html?type=${type || 'daily'}&date=${date || ''}&bank=${encodeURIComponent(bank || 'all')}&sections=${encodeURIComponent(sections || '{}')}`;
    
    await page.goto(url, { waitUntil: 'networkidle0' });
    
    // Wait for the custom #status element to say 'Ready'
    await page.waitForFunction('document.getElementById("status").textContent === "Ready"', { timeout: 30000 });
    
    // Generate PDF
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '15mm', bottom: '15mm', left: '15mm', right: '15mm' }
    });
    
    await browser.close();
    
    const safeDate = date || 'report';
    const safeBank = (bank && bank !== 'all') ? `_${bank.replace(/[^a-zA-Z0-9]/g, '')}` : '';
    const filename = `VDS_MIS_${type}_${safeDate}${safeBank}.pdf`;
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.end(Buffer.from(pdfBuffer));
    
  } catch (error) {
    console.error('PDF generation error:', error);
    res.status(500).send('Error generating PDF: ' + error.message);
  }
});

// Return pre-computed metrics
app.get('/api/metrics', async (req, res) => {
  try {
    const rawData = await fetchSheetData();
    const allRows = parseRows(rawData);
    let rows = filterByMonth(allRows, req.query.month);
    rows = filterByBank(rows, req.query.bank);

    const validRows = [];
    const queryNotVisited = [];

    rows.forEach(row => {
      const status = (row['Status'] || '').trim();
      const visitDate = (row['Visit Date'] || '').trim();
      if (status === 'Query' && !visitDate) {
        queryNotVisited.push({
          srNo: row['Sr no'] || '',
          borrower: row['Borrower Name'] || '',
          bank: row['Bank Name'] || '',
          branch: row['Branch'] || '',
          address: row['Address'] || '',
          location: row['Location'] || '',
          propertyType: row['Property type'] || '',
          engineer: row['Engineer Name'] || '',
          initiationDate: row['Initiation Date'] || '',
          queryDescription: row['Query Description'] || '',
        });
      } else {
        validRows.push(row);
      }
    });

    const metrics = {
      totalCases: validRows.length,

      // Available months for dropdown
      availableMonths: getAvailableMonths(allRows),

      // Available banks for dropdown
      availableBanks: getAvailableBanks(allRows),

      // Today's Schedule: cases with Status "Today Schedule"
      todaySchedule: validRows
        .filter(row => row['Status'] === 'Today Schedule')
        .map(row => ({
          srNo: row['Sr no'] || '',
          borrower: row['Borrower Name'] || '',
          bank: row['Bank Name'] || '',
          branch: row['Branch'] || '',
          address: row['Address'] || '',
          location: row['Location'] || '',
          propertyType: row['Property type'] || '',
          engineer: row['Engineer Name'] || '',
          initiationDate: row['Initiation Date'] || '',
        })),

      // Query and Visit Not Done
      queryNotVisited,

      // 1. Case Status Distribution
      caseStatus: sortByCountDesc(countBy(validRows, 'Status')),

      // 2. Property Type Distribution
      propertyType: sortByCountDesc(countBy(validRows, 'Property type')),

      // 3. Location Distribution (case-insensitive)
      location: sortByCountDesc(countByCaseInsensitive(validRows, 'Location')),

      // 4. Engineer Efficiency (cases per engineer)
      engineerEfficiency: sortByCountDesc(countBy(validRows, 'Engineer Name')),

      // 5. Report Generation Efficiency (cases per "Prepared by")
      reportEfficiency: sortByCountDesc(countBy(validRows, 'Prepared by')),

      // 6. Bank Distribution
      bankDistribution: sortByCountDesc(countBy(validRows, 'Bank Name')),

      // Averages
      avgVisitTAT: calcAvgVisitTAT(validRows),
      avgReportTAT: calcAvgReportTAT(validRows),
      avgQueryTime: calcAvgQueryTime(validRows),
      casesWithQueries: countCasesWithQueries(validRows),

      // Query Time by specific fields
      queryTimeByBank: calcQueryTimeByField(validRows, 'Bank Name'),
      queryCasesByBank: countQueryCasesByField(validRows, 'Bank Name'),

      // TAT Breakup for Report Released
      tatBreakup: getTATBreakup(validRows),
    };

    res.json({ success: true, metrics });
  } catch (error) {
    console.error('Error computing metrics:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Filter rows by date range (daily or weekly)
function filterByDateRange(rows, type, dateStr) {
  if (!dateStr) return rows;

  if (type === 'daily') {
    // dateStr = "YYYY-MM-DD"
    return rows.filter(row => {
      const d = parseDate(row['Initiation Date']);
      if (!d) return false;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return key === dateStr;
    });
  }

  if (type === 'mtd') {
    // dateStr = "YYYY-MM-DD"
    const ref = new Date(dateStr + 'T00:00:00');
    const startOfMonth = new Date(ref.getFullYear(), ref.getMonth(), 1);
    const endOfDay = new Date(ref);
    endOfDay.setHours(23, 59, 59, 999);

    return rows.filter(row => {
      const d = parseDate(row['Initiation Date']);
      if (!d) return false;
      return d >= startOfMonth && d <= endOfDay;
    });
  }

  return rows;
}

// Report endpoint – returns metrics for a specific date range
app.get('/api/report', async (req, res) => {
  try {
    const rawData = await fetchSheetData();
    const allRows = parseRows(rawData);

    // Apply date range filter
    let rows = filterByDateRange(allRows, req.query.type || 'daily', req.query.date);
    // Apply bank filter
    rows = filterByBank(rows, req.query.bank);

    // Month-to-date reports are sorted by Initiation Date, most recent first
    if ((req.query.type || 'daily') === 'mtd') {
      rows = rows.slice().sort((a, b) => {
        const da = parseDate(a['Initiation Date']);
        const db = parseDate(b['Initiation Date']);
        if (!da && !db) return 0;
        if (!da) return 1;
        if (!db) return -1;
        return db - da;
      });
    }

    // Separate query-not-visited
    const validRows = [];
    const queryNotVisited = [];
    rows.forEach(row => {
      const status = (row['Status'] || '').trim();
      const visitDate = (row['Visit Date'] || '').trim();
      if (status === 'Query' && !visitDate) {
        queryNotVisited.push({
          borrower: row['Borrower Name'] || '',
          bank: row['Bank Name'] || '',
          branch: row['Branch'] || '',
          address: row['Address'] || '',
          location: row['Location'] || '',
          propertyType: row['Property type'] || '',
          engineer: row['Engineer Name'] || '',
          initiationDate: row['Initiation Date'] || '',
          queryDescription: row['Query Description'] || '',
        });
      } else {
        validRows.push(row);
      }
    });

    // Sr no in the sheet is often left blank for newer rows, so the report
    // numbers rows itself based on the order shown in each table.
    const withSrNo = (items) => items.map((item, i) => ({ srNo: i + 1, ...item }));

    const metrics = {
      totalCases: validRows.length,
      todaySchedule: withSrNo(validRows
        .filter(row => row['Status'] === 'Today Schedule')
        .map(row => ({
          borrower: row['Borrower Name'] || '',
          bank: row['Bank Name'] || '',
          branch: row['Branch'] || '',
          address: row['Address'] || '',
          location: row['Location'] || '',
          propertyType: row['Property type'] || '',
          engineer: row['Engineer Name'] || '',
          initiationDate: row['Initiation Date'] || '',
        }))),
      queryNotVisited: withSrNo(queryNotVisited),
      // All case details for the report
      allCaseDetails: withSrNo(validRows.map(row => ({
        borrower: row['Borrower Name'] || '',
        bank: row['Bank Name'] || '',
        branch: row['Branch'] || '',
        location: row['Location'] || '',
        propertyType: row['Property type'] || '',
        engineer: row['Engineer Name'] || '',
        initiationDate: row['Initiation Date'] || '',
        visitDate: row['Visit Date'] || '',
        reportDate: row['Report Date'] || '',
        status: row['Status'] || '',
        preparedBy: row['Prepared by'] || '',
      }))),
      caseStatus: sortByCountDesc(countBy(validRows, 'Status')),
      propertyType: sortByCountDesc(countBy(validRows, 'Property type')),
      location: sortByCountDesc(countByCaseInsensitive(validRows, 'Location')),
      engineerEfficiency: sortByCountDesc(countBy(validRows, 'Engineer Name')),
      reportEfficiency: sortByCountDesc(countBy(validRows, 'Prepared by')),
      bankDistribution: sortByCountDesc(countBy(validRows, 'Bank Name')),
      avgVisitTAT: calcAvgVisitTAT(validRows),
      avgReportTAT: calcAvgReportTAT(validRows),
      tatBreakup: getTATBreakup(validRows),
    };

    res.json({ success: true, metrics });
  } catch (error) {
    console.error('Error generating report:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✅ VDS MIS Dashboard server running at http://localhost:${PORT}`);
});

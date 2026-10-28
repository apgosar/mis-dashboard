const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const ExcelJS = require('exceljs');
const {
  getRecipients,
  getEmailSettings,
  sectionsFromKeys,
} = require('./emailConfig');

const LOGO_PATH = path.join(__dirname, 'public', 'logo.png');
const CHART_KEYS = ['caseStatus', 'propertyType', 'location', 'engineer', 'reportEff'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// "2026-09-08" -> "8 Sep 2026"
function formatDate(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

// --- Charts: screenshot each Chart.js canvas from the print page ---

async function renderCharts({ browser, port, date, bank, sections }) {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 900, height: 1200, deviceScaleFactor: 2 });
    const url = `http://localhost:${port}/report-print.html?type=mtd&date=${date}`
      + `&bank=${encodeURIComponent(bank)}&sections=${encodeURIComponent(JSON.stringify(sections))}`;
    await page.goto(url, { waitUntil: 'networkidle0' });
    await page.waitForFunction('document.getElementById("status").textContent === "Ready"', { timeout: 30000 });
    await new Promise(r => setTimeout(r, 500)); // let Chart.js animations settle

    const canvases = await page.$$('canvas');
    const charts = [];
    for (let i = 0; i < canvases.length; i++) {
      const title = await canvases[i].evaluate(el => {
        const section = el.closest('.section');
        const t = section && section.querySelector('.section-title');
        return t ? t.textContent : '';
      });
      const box = await canvases[i].evaluateHandle(el => el.parentElement);
      const buffer = Buffer.from(await box.asElement().screenshot({ type: 'png' }));
      charts.push({ title, buffer, cid: `chart${i}@vds` });
    }
    return charts;
  } finally {
    await page.close();
  }
}

// --- Email body ---

function kpiCell(label, value) {
  return `<td width="33%" style="padding:6px;">
    <div style="background:#f7fafc;border:1px solid #e3e8ee;border-radius:6px;padding:12px 14px;">
      <div style="font-size:11px;color:#4f566b;text-transform:uppercase;font-weight:600;">${esc(label)}</div>
      <div style="font-size:20px;font-weight:700;color:#1a1f36;margin-top:4px;">${esc(value)}</div>
    </div></td>`;
}

function tatCell(label, value) {
  return `<td width="20%" style="padding:6px;">
    <div style="background:#f7fafc;border:1px solid #e3e8ee;border-radius:6px;padding:10px 12px;">
      <div style="font-size:11px;color:#4f566b;font-weight:600;">${esc(label)}</div>
      <div style="font-size:18px;font-weight:700;color:#1a1f36;margin-top:4px;">${esc(value)}</div>
    </div></td>`;
}

function sectionTitle(title) {
  return `<div style="font-size:16px;font-weight:700;color:#2b5797;border-bottom:1px solid #e3e8ee;padding-bottom:5px;margin:26px 0 12px;">${esc(title)}</div>`;
}

function buildEmailHtml({ metrics, charts, bank, date, sections, hasLogo, attachmentName }) {
  const parts = [];

  if (sections.kpi) {
    parts.push(sectionTitle('KPI Summary'));
    parts.push(`<table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>
      ${kpiCell('Total Cases', metrics.totalCases)}
      ${kpiCell('Avg Visit TAT', `${metrics.avgVisitTAT} days`)}
      ${kpiCell('Avg Report TAT', `${metrics.avgReportTAT} days`)}
    </tr></table>`);
  }

  if (sections.tat) {
    const b = (metrics.tatBreakup && metrics.tatBreakup.buckets) || {};
    parts.push(sectionTitle('TAT Breakup'));
    parts.push(`<table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>
      ${['T+0', 'T+1', 'T+2', 'T+3', 'T+4+'].map(k => tatCell(k, b[k] || 0)).join('')}
    </tr></table>`);
  }

  charts.forEach(c => {
    parts.push(sectionTitle(c.title));
    parts.push(`<img src="cid:${c.cid}" alt="${esc(c.title)}" width="640" style="display:block;width:100%;max-width:640px;height:auto;border:0;">`);
  });

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#1a1f36;">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr><td align="center" style="padding:20px 10px;">
<table width="680" cellpadding="0" cellspacing="0" role="presentation" style="max-width:680px;width:100%;">
  <tr><td style="border-bottom:2px solid #2b5797;padding-bottom:14px;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>
      <td>${hasLogo ? '<img src="cid:logo@vds" alt="VDS Advisory" height="60" style="display:block;height:60px;border:0;">' : ''}</td>
      <td align="right">
        <div style="font-size:20px;font-weight:700;color:#2b5797;">${esc(bank)} Month to Date MIS Report</div>
        <div style="font-size:12px;color:#697386;margin-top:4px;">As of ${esc(formatDate(date))}</div>
      </td>
    </tr></table>
  </td></tr>
  <tr><td>
    ${parts.join('\n')}
    <p style="font-size:12px;color:#697386;margin-top:28px;">The full case details are attached as an Excel file (${esc(attachmentName)}).<br>
    This report was generated automatically by the VDS Advisory MIS Dashboard.</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

// --- Excel attachment ---

// "1-Sep-2026" -> Date (UTC midnight so Excel shows the same day); otherwise leave as text
function toExcelDate(text) {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec((text || '').trim());
  if (!m) return text || '';
  const mon = MONTHS.findIndex(x => x.toLowerCase() === m[2].toLowerCase());
  if (mon === -1) return text;
  return new Date(Date.UTC(Number(m[3]), mon, Number(m[1])));
}

async function buildExcel(cases) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'VDS Advisory MIS Dashboard';
  const ws = wb.addWorksheet('Case Details');

  const dateFmt = 'd-mmm-yyyy';
  ws.columns = [
    { header: 'Sr', key: 'srNo', width: 6 },
    { header: 'Borrower', key: 'borrower', width: 36 },
    { header: 'Location', key: 'location', width: 16 },
    { header: 'Property Type', key: 'propertyType', width: 26 },
    { header: 'Initiation Date', key: 'initiationDate', width: 15, style: { numFmt: dateFmt } },
    { header: 'Visit Date', key: 'visitDate', width: 13, style: { numFmt: dateFmt } },
    { header: 'Report Date', key: 'reportDate', width: 13, style: { numFmt: dateFmt } },
    { header: 'Status', key: 'status', width: 22 },
  ];

  cases.forEach(c => {
    ws.addRow({
      ...c,
      initiationDate: toExcelDate(c.initiationDate),
      visitDate: toExcelDate(c.visitDate),
      reportDate: toExcelDate(c.reportDate),
    });
  });

  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2B5797' } };
  header.alignment = { vertical: 'middle' };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// --- Orchestration ---

function createTransporter() {
  const user = process.env.GMAIL_USER;
  const pass = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
  if (!user || !pass) throw new Error('GMAIL_USER and GMAIL_APP_PASSWORD must be set');
  return nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
}

// deps: { port, launchBrowser, buildReportMetrics, resolveBank }
// resolveBank(name) -> canonical "Bank Name" from the main sheet, or null
async function runMtdEmailJob({ date, bank, dryRun, debugDir }, deps) {
  const [recipients, graphKeys] = await Promise.all([getRecipients(), getEmailSettings()]);
  const sections = sectionsFromKeys(graphKeys);
  const wantsCharts = CHART_KEYS.some(k => sections[k]);

  let entries = recipients;
  if (bank) {
    entries = recipients.filter(e => e.bank.toLowerCase() === bank.trim().toLowerCase());
    if (!entries.length) return [{ bank, status: 'skipped', reason: 'not found in Recipients tab' }];
  }

  const transporter = dryRun ? null : createTransporter();
  // Gmail only accepts the account's own address (or a verified "Send mail as" alias) as the From address
  const fromName = process.env.MAIL_FROM_NAME || 'VDS Advisory MIS';
  const fromAddress = process.env.MAIL_FROM_ADDRESS || process.env.GMAIL_USER;
  const hasLogo = fs.existsSync(LOGO_PATH);
  const results = [];
  let browser = null;

  try {
    for (const entry of entries) {
      const result = { bank: entry.bank, to: entry.to, cc: entry.cc, bcc: entry.bcc };
      if (entry.warnings.length) result.warnings = entry.warnings;
      try {
        if (entry.skip) {
          results.push({ ...result, status: 'skipped', reason: entry.skip });
          continue;
        }

        const canonicalBank = await deps.resolveBank(entry.bank);
        if (!canonicalBank) {
          results.push({ ...result, status: 'skipped', reason: 'bank name not found in main sheet' });
          continue;
        }

        const metrics = await deps.buildReportMetrics({ type: 'mtd', date, bank: canonicalBank });
        if (!metrics.allCaseDetails.length) {
          results.push({ ...result, status: 'skipped', reason: 'no cases month-to-date' });
          continue;
        }

        let charts = [];
        if (wantsCharts) {
          if (!browser) browser = await deps.launchBrowser();
          charts = await renderCharts({ browser, port: deps.port, date, bank: canonicalBank, sections });
        }

        const safeBank = canonicalBank.replace(/[^a-zA-Z0-9]/g, '');
        const attachmentName = `VDS_MIS_MTD_${safeBank}_${date}.xlsx`;
        const xlsx = await buildExcel(metrics.allCaseDetails);
        const html = buildEmailHtml({ metrics, charts, bank: canonicalBank, date, sections, hasLogo, attachmentName });
        const subject = `${canonicalBank} – Month to Date MIS Report (${formatDate(date)})`;

        if (dryRun) {
          if (debugDir) {
            fs.mkdirSync(debugDir, { recursive: true });
            fs.writeFileSync(path.join(debugDir, `${safeBank}.html`), html.replace(/cid:(chart\d+)@vds/g, '$1.png').replace('cid:logo@vds', 'logo.png'));
            fs.writeFileSync(path.join(debugDir, attachmentName), xlsx);
            charts.forEach((c, i) => fs.writeFileSync(path.join(debugDir, `chart${i}.png`), c.buffer));
          }
          results.push({ ...result, status: 'dry-run', cases: metrics.allCaseDetails.length, charts: charts.map(c => c.title), subject });
          continue;
        }

        const attachments = [
          { filename: attachmentName, content: xlsx },
          ...charts.map((c, i) => ({ filename: `chart${i}.png`, content: c.buffer, cid: c.cid, contentDisposition: 'inline' })),
        ];
        if (hasLogo) attachments.push({ filename: 'logo.png', path: LOGO_PATH, cid: 'logo@vds', contentDisposition: 'inline' });

        const info = await transporter.sendMail({
          from: { name: fromName, address: fromAddress },
          to: entry.to,
          cc: entry.cc,
          bcc: entry.bcc,
          subject,
          html,
          attachments,
        });
        results.push({ ...result, status: 'sent', cases: metrics.allCaseDetails.length, charts: charts.length, messageId: info.messageId });
      } catch (err) {
        console.error(`MTD email failed for ${entry.bank}:`, err);
        results.push({ ...result, status: 'error', error: err.message });
      }
    }
  } finally {
    if (browser) await browser.close();
  }

  return results;
}

module.exports = { runMtdEmailJob };

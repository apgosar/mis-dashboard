const { fetchSheetData, updateRange } = require('./sheets');

const RECIPIENTS_TAB = 'Recipients';
const SETTINGS_TAB = 'EmailSettings';

// Selectable sections for the emailed report (keys match report-print.js sections)
const GRAPH_KEYS = ['kpi', 'tat', 'caseStatus', 'propertyType', 'location', 'engineer', 'reportEff'];

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

// --- Email settings (which graphs go in the mail body) ---

async function getEmailSettings() {
  try {
    const rows = await fetchSheetData(`${SETTINGS_TAB}!A1:B1`);
    if (!rows[0]) return [...GRAPH_KEYS]; // nothing saved yet -> everything on
    const raw = rows[0][1] || '';
    const saved = raw.split(',').map(s => s.trim());
    return GRAPH_KEYS.filter(k => saved.includes(k));
  } catch (err) {
    console.warn(`Could not read ${SETTINGS_TAB} tab, defaulting to all graphs:`, err.message);
    return [...GRAPH_KEYS];
  }
}

async function saveEmailSettings(keys) {
  const invalid = keys.filter(k => !GRAPH_KEYS.includes(k));
  if (invalid.length) throw new Error(`Unknown section(s): ${invalid.join(', ')}`);
  const ordered = GRAPH_KEYS.filter(k => keys.includes(k));
  await updateRange(`${SETTINGS_TAB}!A1:B1`, [['graphs', ordered.join(',')]]);
  return ordered;
}

function sectionsFromKeys(keys) {
  const sections = {};
  GRAPH_KEYS.forEach(k => { sections[k] = keys.includes(k); });
  return sections;
}

// --- Recipients (To / Cc / Bcc per bank) ---

function splitAddresses(cell) {
  return (cell || '')
    .split(/[,;\n]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

// Returns one entry per bank row: { bank, to, cc, bcc, skip, warnings }.
// Addresses are validated and de-duplicated across To > Cc > Bcc.
async function getRecipients() {
  const raw = await fetchSheetData(RECIPIENTS_TAB);
  if (raw.length < 2) return [];

  const headers = raw[0].map(h => (h || '').trim().toLowerCase());
  const col = name => headers.indexOf(name);
  const bankCol = col('bank');
  const toCol = col('to');
  if (bankCol === -1 || toCol === -1) {
    throw new Error(`"${RECIPIENTS_TAB}" tab needs header columns: Bank, To, Cc, Bcc, Active`);
  }
  const ccCol = col('cc');
  const bccCol = col('bcc');
  const activeCol = col('active');

  return raw.slice(1)
    .filter(row => (row[bankCol] || '').trim())
    .map(row => {
      const bank = row[bankCol].trim();
      const warnings = [];
      const seen = new Set();

      const clean = (colIdx, label) => {
        if (colIdx === -1) return [];
        const out = [];
        splitAddresses(row[colIdx]).forEach(addr => {
          const key = addr.toLowerCase();
          if (!EMAIL_RE.test(addr)) { warnings.push(`${label}: invalid address "${addr}"`); return; }
          if (seen.has(key)) return;
          seen.add(key);
          out.push(addr);
        });
        return out;
      };

      const to = clean(toCol, 'To');
      const cc = clean(ccCol, 'Cc');
      const bcc = clean(bccCol, 'Bcc');

      let skip = null;
      const active = activeCol === -1 ? '' : (row[activeCol] || '').trim().toLowerCase();
      if (['n', 'no', 'false', '0'].includes(active)) skip = 'inactive';
      else if (!to.length) skip = 'no valid To address';

      return { bank, to, cc, bcc, skip, warnings };
    });
}

module.exports = {
  GRAPH_KEYS,
  getEmailSettings,
  saveEmailSettings,
  sectionsFromKeys,
  getRecipients,
};

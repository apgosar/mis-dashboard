// ===== VDS Advisory MIS Dashboard — Frontend App =====

const API_METRICS = '/api/metrics';
const API_DATA = '/api/data';
const REFRESH_INTERVAL = 60; // seconds

let autoRefreshEnabled = localStorage.getItem('vds_autoRefresh') !== null
    ? localStorage.getItem('vds_autoRefresh') === 'true'
    : true;
let countdown = REFRESH_INTERVAL;
let countdownTimer = null;
let charts = {};
// Get current month in YYYY-MM format
const now = new Date();
const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

let allRows = []; // Store all rows for drill-down filtering
let selectedMonth = currentMonthStr; // Default to current month
let selectedBank = localStorage.getItem('vds_selectedBank') || 'all';
let lastMetrics = null; // Store for resize re-render
let othersLabelMap = {}; // Store original labels aggregated into "Others"

// Table columns to show in drill-down
const DRILLDOWN_COLUMNS = [
    'Sr no', 'Borrower Name', 'Bank Name', 'Branch', 'Case Type', 'Address',
    'Location', 'Property typ', 'Engineer Name', 'Initiation Date',
    'Visit Date', 'Report Date', 'Status', 'Prepared by', 'TAT (Visit)', 'TAT (Report)'
];

// ===== Chart Color Palettes =====
const PALETTE = {
    gold: ['#d4a843', '#c49630', '#e6c060', '#f0cc6b', '#b8892c', '#dbb554', '#c9a03a', '#e8d080'],
    blue: ['#2b5797', '#3d7fd9', '#1e3f6e', '#5a9cf0', '#174a8a', '#4a8ed4', '#2666b0', '#7ab4f5'],
    mixed: ['#2b5797', '#d4a843', '#4ecdc4', '#e76f51', '#6c5ce7', '#00b894', '#fd79a8', '#fdcb6e',
        '#0984e3', '#e17055', '#a29bfe', '#55efc4', '#f39c12', '#3498db', '#e74c3c', '#1abc9c'],
    doughnut: ['#2b5797', '#d4a843', '#4ecdc4', '#e76f51', '#6c5ce7', '#00b894', '#fd79a8', '#fdcb6e',
        '#0984e3', '#e17055'],
};

// ===== Chart.js Global Defaults =====
Chart.defaults.color = '#8b95b0';
Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';
Chart.defaults.font.family = "'Inter', sans-serif";
Chart.defaults.plugins.legend.labels.usePointStyle = true;
Chart.defaults.plugins.legend.labels.pointStyle = 'circle';

// ===== Initialization =====
document.addEventListener('DOMContentLoaded', () => {
    // Restore auto-refresh toggle state
    const autoToggle = document.getElementById('autoRefreshToggle');
    autoToggle.checked = autoRefreshEnabled;
    if (!autoRefreshEnabled) {
        document.getElementById('refreshTimer').textContent = 'OFF';
    }

    // Restore bank filter from localStorage
    const savedBank = localStorage.getItem('vds_selectedBank');
    if (savedBank && savedBank !== 'all') {
        const bankSelect = document.getElementById('bankSelect');
        // Will be properly set after populateBankDropdown runs
        selectedBank = savedBank;
    }

    fetchAndRender();
    if (autoRefreshEnabled) startCountdown();

    // Responsive: re-render charts on window resize (debounced)
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (lastMetrics) renderCharts(lastMetrics);
        }, 250);
    });

    document.getElementById('btnRefresh').addEventListener('click', () => {
        fetchAndRender();
        resetCountdown();
    });

    document.getElementById('autoRefreshToggle').addEventListener('change', (e) => {
        autoRefreshEnabled = e.target.checked;
        localStorage.setItem('vds_autoRefresh', autoRefreshEnabled);
        if (autoRefreshEnabled) {
            resetCountdown();
            startCountdown();
        } else {
            clearInterval(countdownTimer);
            document.getElementById('refreshTimer').textContent = 'OFF';
        }
    });

    document.getElementById('toastClose').addEventListener('click', () => {
        document.getElementById('toastError').classList.remove('show');
    });

    // Month filter dropdown
    document.getElementById('monthSelect').addEventListener('change', (e) => {
        selectedMonth = e.target.value;
        fetchAndRender();
        resetCountdown();
    });

    // Bank filter dropdown
    document.getElementById('bankSelect').addEventListener('change', (e) => {
        selectedBank = e.target.value;
        localStorage.setItem('vds_selectedBank', selectedBank);
        fetchAndRender();
        resetCountdown();
    });

    // Total Cases drill-down
    document.getElementById('kpiTotal').addEventListener('click', () => {
        currentDrilldownRows = allRows;
        document.getElementById('drilldownTitle').textContent = 'All Cases';
        document.getElementById('drilldownCount').textContent = `${allRows.length} records`;
        document.getElementById('drilldownSearch').value = '';
        renderDrilldownTable(allRows);
        document.getElementById('drilldownOverlay').classList.add('open');
        document.body.style.overflow = 'hidden';
    });

    // CSV export
    document.getElementById('btnExportCsv').addEventListener('click', exportDrilldownCSV);

    // Drill-down modal controls
    document.getElementById('drilldownClose').addEventListener('click', closeDrilldown);
    document.getElementById('drilldownOverlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeDrilldown();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeDrilldown();
    });
    document.getElementById('drilldownSearch').addEventListener('input', (e) => {
        filterDrilldownTable(e.target.value);
    });

    // Schedule toggle
    document.getElementById('scheduleToggle').addEventListener('click', () => {
        const body = document.getElementById('scheduleBody');
        const btn = document.getElementById('scheduleExpandBtn');
        body.classList.toggle('collapsed');
        btn.classList.toggle('collapsed');
    });

    // Query toggle
    document.getElementById('queryToggle').addEventListener('click', () => {
        const body = document.getElementById('queryBody');
        const btn = document.getElementById('queryExpandBtn');
        body.classList.toggle('collapsed');
        btn.classList.toggle('collapsed');
    });
});

// ===== Data Fetching =====
async function fetchAndRender() {
    showLoading(true);
    try {
        let params = [];
        if (selectedMonth !== 'all') params.push(`month=${selectedMonth}`);
        if (selectedBank !== 'all') params.push(`bank=${encodeURIComponent(selectedBank)}`);
        const queryStr = params.length ? '?' + params.join('&') : '';
        // Fetch metrics and raw data in parallel
        const [metricsRes, dataRes] = await Promise.all([
            fetch(API_METRICS + queryStr),
            fetch(API_DATA + queryStr)
        ]);

        if (!metricsRes.ok) throw new Error(`Metrics error: ${metricsRes.status}`);
        if (!dataRes.ok) throw new Error(`Data error: ${dataRes.status}`);

        const metricsJson = await metricsRes.json();
        const dataJson = await dataRes.json();

        if (!metricsJson.success) throw new Error(metricsJson.error || 'Unknown error');
        if (!dataJson.success) throw new Error(dataJson.error || 'Unknown error');

        allRows = dataJson.data; // Store for drill-down

        lastMetrics = metricsJson.metrics;
        populateMonthDropdown(metricsJson.metrics.availableMonths);
        populateBankDropdown(metricsJson.metrics.availableBanks);
        renderSchedule(metricsJson.metrics.todaySchedule);
        renderQueryList(metricsJson.metrics.queryNotVisited);
        renderKPIs(metricsJson.metrics);
        renderTATBreakup(metricsJson.metrics.tatBreakup);
        renderCharts(metricsJson.metrics);
        updateTimestamp();
        hideError();
    } catch (err) {
        console.error('Fetch error:', err);
        showError(err.message);
    } finally {
        showLoading(false);
    }
}

// ===== Month Dropdown =====
function populateMonthDropdown(months) {
    const select = document.getElementById('monthSelect');
    const current = select.value;
    // Only repopulate if months changed
    const existingValues = Array.from(select.options).map(o => o.value).join(',');
    const newValues = 'all,' + months.map(m => m.value).join(',');
    if (existingValues === newValues) return;

    select.innerHTML = '<option value="all">All Months</option>';
    months.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.value;
        opt.textContent = m.label;
        select.appendChild(opt);
    });

    // Check if selectedMonth exists in options, else fallback to 'all'
    if (select.querySelector(`option[value="${selectedMonth}"]`)) {
        select.value = selectedMonth;
    } else {
        selectedMonth = 'all';
        select.value = 'all';
    }
}

// ===== Bank Dropdown =====
function populateBankDropdown(banks) {
    const select = document.getElementById('bankSelect');
    const current = select.value;
    const existingValues = Array.from(select.options).map(o => o.value).join(',');
    const newValues = 'all,' + banks.join(',');
    if (existingValues === newValues) return;

    select.innerHTML = '<option value="all">All Banks</option>';
    banks.forEach(bank => {
        const opt = document.createElement('option');
        opt.value = bank;
        opt.textContent = bank;
        select.appendChild(opt);
    });
    select.value = current && select.querySelector(`option[value="${current}"]`) ? current : 'all';
    // Restore saved bank selection after dropdown is populated
    const savedBank = localStorage.getItem('vds_selectedBank');
    if (savedBank && select.querySelector(`option[value="${savedBank}"]`)) {
        select.value = savedBank;
        selectedBank = savedBank;
    }
}

// ===== CSV Export =====
function exportDrilldownCSV() {
    if (!currentDrilldownRows.length) return;

    const columns = DRILLDOWN_COLUMNS;
    const csvRows = [];

    // Header
    csvRows.push(columns.map(c => `"${c}"`).join(','));

    // Data rows
    currentDrilldownRows.forEach(row => {
        csvRows.push(columns.map(col => {
            const val = (row[col] || '').toString().replace(/"/g, '""');
            return `"${val}"`;
        }).join(','));
    });

    const csvContent = csvRows.join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const title = document.getElementById('drilldownTitle').textContent.replace(/[^a-zA-Z0-9]/g, '_');
    a.href = url;
    a.download = `VDS_${title}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

// ===== TAT Breakup =====
let tatBucketData = {}; // Store per-bucket Sr No lists for drill-down

function renderTATBreakup(tatData) {
    document.getElementById('tatTotal').textContent = `${tatData.totalCases} cases`;

    // Store bucket row data for drill-down
    tatBucketData = tatData.bucketRows;

    // Attach click handlers FIRST (cloneNode replaces elements in DOM)
    const bucketMap = {
        'tat-t0': 'T+0',
        'tat-t1': 'T+1',
        'tat-t2': 'T+2',
        'tat-t3': 'T+3',
        'tat-t4': 'T+4+',
    };

    Object.entries(bucketMap).forEach(([className, bucketKey]) => {
        const el = document.querySelector(`.${className}`);
        el.style.cursor = 'pointer';
        const newEl = el.cloneNode(true);
        el.parentNode.replaceChild(newEl, el);
        newEl.addEventListener('click', () => {
            openTATDrilldown(bucketKey);
        });
    });

    // Animate numbers AFTER cloning so they target the live DOM elements
    animateNumber('tatT0', tatData.buckets['T+0']);
    animateNumber('tatT1', tatData.buckets['T+1']);
    animateNumber('tatT2', tatData.buckets['T+2']);
    animateNumber('tatT3', tatData.buckets['T+3']);
    animateNumber('tatT4', tatData.buckets['T+4+']);
}

function openTATDrilldown(bucketKey) {
    const srNos = tatBucketData[bucketKey] || [];
    if (!srNos.length) return;

    // Filter allRows by Sr no in this bucket
    const srSet = new Set(srNos);
    currentDrilldownRows = allRows.filter(row => srSet.has(row['Sr no']));

    document.getElementById('drilldownTitle').textContent = `TAT Breakup: ${bucketKey}`;
    document.getElementById('drilldownCount').textContent = `${currentDrilldownRows.length} records`;
    document.getElementById('drilldownSearch').value = '';

    renderDrilldownTable(currentDrilldownRows);

    document.getElementById('drilldownOverlay').classList.add('open');
    document.body.style.overflow = 'hidden';
}

// ===== Today's Schedule =====
const SCHEDULE_COLUMNS = [
    { key: 'srNo', label: 'Sr No' },
    { key: 'borrower', label: 'Borrower' },
    { key: 'bank', label: 'Bank' },
    { key: 'branch', label: 'Branch' },
    { key: 'address', label: 'Address' },
    { key: 'location', label: 'Location' },
    { key: 'propertyType', label: 'Property Type' },
    { key: 'engineer', label: 'Engineer' },
    { key: 'initiationDate', label: 'Initiation Date' },
];

function renderSchedule(scheduleData) {
    const thead = document.getElementById('scheduleHead');
    const tbody = document.getElementById('scheduleTableBody');
    const empty = document.getElementById('scheduleEmpty');
    const badge = document.getElementById('scheduleCount');
    const section = document.getElementById('scheduleSection');

    badge.textContent = `${scheduleData.length} visit${scheduleData.length !== 1 ? 's' : ''}`;

    if (scheduleData.length === 0) {
        thead.innerHTML = '';
        tbody.innerHTML = '';
        empty.classList.add('show');
        section.classList.add('empty');
        return;
    }

    section.classList.remove('empty');
    empty.classList.remove('show');

    thead.innerHTML = '<tr>' + SCHEDULE_COLUMNS.map(col =>
        `<th>${escapeHtml(col.label)}</th>`
    ).join('') + '</tr>';

    tbody.innerHTML = scheduleData.map(row =>
        '<tr>' + SCHEDULE_COLUMNS.map(col =>
            `<td title="${escapeHtml(row[col.key] || '')}">${escapeHtml(row[col.key] || '—')}</td>`
        ).join('') + '</tr>'
    ).join('');
}

// ===== Query Not Visited =====
function renderQueryList(queryData) {
    const thead = document.getElementById('queryHead');
    const tbody = document.getElementById('queryTableBody');
    const empty = document.getElementById('queryEmpty');
    const badge = document.getElementById('queryCount');
    const section = document.getElementById('querySection');

    badge.textContent = `${queryData.length} case${queryData.length !== 1 ? 's' : ''}`;

    if (queryData.length === 0) {
        thead.innerHTML = '';
        tbody.innerHTML = '';
        empty.classList.add('show');
        section.classList.add('empty');
        return;
    }

    section.classList.remove('empty');
    empty.classList.remove('show');

    thead.innerHTML = '<tr>' + SCHEDULE_COLUMNS.map(col =>
        `<th>${escapeHtml(col.label)}</th>`
    ).join('') + '</tr>';

    tbody.innerHTML = queryData.map(row =>
        '<tr>' + SCHEDULE_COLUMNS.map(col =>
            `<td title="${escapeHtml(row[col.key] || '')}">${escapeHtml(row[col.key] || '—')}</td>`
        ).join('') + '</tr>'
    ).join('');
}

// ===== KPI Rendering =====
function renderKPIs(metrics) {
    animateNumber('totalCases', metrics.totalCases);
    animateNumber('avgVisitTAT', metrics.avgVisitTAT, true);
    animateNumber('avgReportTAT', metrics.avgReportTAT, true);
}

function animateNumber(elementId, target, isDecimal = false) {
    const el = document.getElementById(elementId);
    const start = parseFloat(el.textContent) || 0;
    const duration = 600;
    const startTime = performance.now();

    function tick(now) {
        const progress = Math.min((now - startTime) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        const current = start + (target - start) * eased;
        el.textContent = isDecimal ? current.toFixed(2) : Math.round(current);
        if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
}

// ===== Chart Rendering =====
function renderCharts(metrics) {
    renderDoughnut('chartStatus', metrics.caseStatus, 'Status');
    renderBar('chartPropertyType', metrics.propertyType, 'Property typ', PALETTE.blue, false);
    renderBar('chartLocation', limitEntries(metrics.location, 15, 'Location'), 'Location', PALETTE.mixed, true);
    renderBar('chartEngineer', metrics.engineerEfficiency, 'Engineer Name', PALETTE.gold, true);
    renderBar('chartBank', limitEntries(metrics.bankDistribution, 15, 'Bank Name'), 'Bank Name', PALETTE.mixed, true);
    renderBar('chartPreparedBy', metrics.reportEfficiency, 'Prepared by', PALETTE.blue, true);
}

function limitEntries(obj, max, filterField) {
    const entries = Object.entries(obj);
    if (entries.length <= max) {
        othersLabelMap[filterField] = null;
        return obj;
    }
    const top = entries.slice(0, max);
    const othersEntries = entries.slice(max);
    const othersCount = othersEntries.reduce((s, [, v]) => s + v, 0);
    const result = Object.fromEntries(top);
    result['Others'] = othersCount;
    // Store the labels that are aggregated into "Others" so we can drill down
    othersLabelMap[filterField] = othersEntries.map(([k]) => k);
    return result;
}

// --- Drill-down click handler factory ---
function makeClickHandler(chartInstance, filterField) {
    return (event) => {
        const points = chartInstance.getElementsAtEventForMode(event, 'nearest', { intersect: true }, false);
        if (!points.length) return;
        const idx = points[0].index;
        const label = chartInstance.data.labels[idx];
        if (label === 'Others') {
            // Drill down on all labels aggregated into "Others"
            const otherLabels = othersLabelMap[filterField];
            if (!otherLabels || !otherLabels.length) return;
            openDrilldownMulti(filterField, otherLabels);
        } else {
            openDrilldown(filterField, label);
        }
    };
}

function renderDoughnut(canvasId, data, filterField) {
    const canvas = document.getElementById(canvasId);
    const ctx = canvas.getContext('2d');
    const labels = Object.keys(data);
    const values = Object.values(data);
    const total = values.reduce((a, b) => a + b, 0);

    if (charts[canvasId]) charts[canvasId].destroy();

    // Remove old custom legend if it exists
    const parent = canvas.closest('.chart-card');
    const oldLegend = parent.querySelector('.custom-legend');
    if (oldLegend) oldLegend.remove();

    charts[canvasId] = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data: values,
                backgroundColor: PALETTE.doughnut.slice(0, labels.length),
                borderColor: 'rgba(15,19,32,0.8)',
                borderWidth: 2,
                hoverOffset: 8,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '62%',
            plugins: {
                legend: { display: false }, // We use custom legend
                tooltip: {
                    backgroundColor: '#1c2240',
                    titleColor: '#e8ecf4',
                    bodyColor: '#8b95b0',
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 8,
                    callbacks: {
                        label: (ctx) => {
                            const pct = ((ctx.parsed / total) * 100).toFixed(1);
                            return ` ${ctx.label}: ${ctx.parsed} (${pct}%)`;
                        },
                        footer: () => ['🔍 Click to view details'],
                    },
                    footerColor: '#d4a843',
                    footerFont: { size: 10 },
                }
            },
            onClick: function (event) {
                makeClickHandler(this, filterField)(event);
            }
        }
    });

    // Build custom HTML legend with percentages and click handlers
    const legendDiv = document.createElement('div');
    legendDiv.className = 'custom-legend';
    labels.forEach((label, i) => {
        const pct = ((values[i] / total) * 100).toFixed(1);
        const color = PALETTE.doughnut[i % PALETTE.doughnut.length];
        const item = document.createElement('div');
        item.className = 'legend-item';
        item.innerHTML = `<span class="legend-color" style="background:${color}"></span>
            <span class="legend-text">${escapeHtml(label)}</span>
            <span class="legend-pct">${pct}%</span>
            <span class="legend-count">(${values[i]})</span>`;
        item.title = `${label}: ${values[i]} cases (${pct}%) — Click for details`;
        item.style.cursor = 'pointer';
        item.addEventListener('click', () => {
            openDrilldown(filterField, label);
        });
        // Hover: highlight the corresponding segment
        item.addEventListener('mouseenter', () => {
            const chart = charts[canvasId];
            chart.setActiveElements([{ datasetIndex: 0, index: i }]);
            chart.tooltip.setActiveElements([{ datasetIndex: 0, index: i }], { x: 0, y: 0 });
            chart.update();
        });
        item.addEventListener('mouseleave', () => {
            const chart = charts[canvasId];
            chart.setActiveElements([]);
            chart.tooltip.setActiveElements([], { x: 0, y: 0 });
            chart.update();
        });
        legendDiv.appendChild(item);
    });
    parent.appendChild(legendDiv);
}

function renderBar(canvasId, data, filterField, palette, horizontal) {
    const canvas = document.getElementById(canvasId);
    const ctx = canvas.getContext('2d');
    const labels = Object.keys(data);
    const values = Object.values(data);
    const colors = labels.map((_, i) => palette[i % palette.length]);

    if (charts[canvasId]) charts[canvasId].destroy();

    // Dynamic height for horizontal bars — 30px per label, min 300px
    if (horizontal) {
        const minH = Math.max(300, labels.length * 30);
        canvas.closest('.chart-container').style.height = minH + 'px';
    }

    charts[canvasId] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: `${filterField} Count`,
                data: values,
                backgroundColor: colors.map(c => c + 'CC'),
                borderColor: colors,
                borderWidth: 1,
                borderRadius: 6,
                borderSkipped: false,
                minBarLength: 8, // Ensure small values are still visible/clickable
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: horizontal ? 'y' : 'x',
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#1c2240',
                    titleColor: '#e8ecf4',
                    bodyColor: '#8b95b0',
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 8,
                    footer: () => ['🔍 Click to view details'],
                    footerColor: '#d4a843',
                    footerFont: { size: 10 },
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255,255,255,0.04)' },
                    ticks: {
                        font: { size: 11 },
                        maxRotation: horizontal ? 0 : 45,
                        minRotation: horizontal ? 0 : 25,
                        autoSkip: !horizontal,
                    }
                },
                y: {
                    grid: { color: 'rgba(255,255,255,0.04)' },
                    ticks: {
                        font: { size: 11 },
                        autoSkip: false,
                    },
                    beginAtZero: true,
                }
            },
            onClick: function (event) {
                makeClickHandler(this, filterField)(event);
            }
        }
    });
}

// ===== Drill-Down Logic =====
let currentDrilldownRows = [];

function openDrilldown(filterField, filterValue) {
    // Filter rows matching the clicked value (case-insensitive for location)
    currentDrilldownRows = allRows.filter(row => {
        const val = (row[filterField] || '').trim();
        return val.toLowerCase() === filterValue.toLowerCase();
    });

    // Update header
    document.getElementById('drilldownTitle').textContent = `${filterField}: ${filterValue}`;
    document.getElementById('drilldownCount').textContent = `${currentDrilldownRows.length} records`;
    document.getElementById('drilldownSearch').value = '';

    // Render table
    renderDrilldownTable(currentDrilldownRows);

    // Open modal
    document.getElementById('drilldownOverlay').classList.add('open');
    document.body.style.overflow = 'hidden';
}

function openDrilldownMulti(filterField, filterValues) {
    // Filter rows matching ANY of the "Others" labels
    currentDrilldownRows = allRows.filter(row => {
        const val = (row[filterField] || '').trim();
        return filterValues.includes(val);
    });

    document.getElementById('drilldownTitle').textContent = `${filterField}: Others (${filterValues.length} categories)`;
    document.getElementById('drilldownCount').textContent = `${currentDrilldownRows.length} records`;
    document.getElementById('drilldownSearch').value = '';

    renderDrilldownTable(currentDrilldownRows);

    document.getElementById('drilldownOverlay').classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeDrilldown() {
    document.getElementById('drilldownOverlay').classList.remove('open');
    document.body.style.overflow = '';
}

function renderDrilldownTable(rows) {
    const thead = document.getElementById('drilldownHead');
    const tbody = document.getElementById('drilldownBody');
    const empty = document.getElementById('drilldownEmpty');

    // Header
    thead.innerHTML = '<tr>' + DRILLDOWN_COLUMNS.map(col =>
        `<th>${escapeHtml(col)}</th>`
    ).join('') + '</tr>';

    // Body
    if (rows.length === 0) {
        tbody.innerHTML = '';
        empty.classList.add('show');
        return;
    }

    empty.classList.remove('show');
    tbody.innerHTML = rows.map(row =>
        '<tr>' + DRILLDOWN_COLUMNS.map(col =>
            `<td title="${escapeHtml(row[col] || '')}">${escapeHtml(row[col] || '—')}</td>`
        ).join('') + '</tr>'
    ).join('');
}

function filterDrilldownTable(query) {
    const q = query.toLowerCase().trim();
    if (!q) {
        renderDrilldownTable(currentDrilldownRows);
        return;
    }
    const filtered = currentDrilldownRows.filter(row =>
        DRILLDOWN_COLUMNS.some(col => (row[col] || '').toLowerCase().includes(q))
    );
    renderDrilldownTable(filtered);
    document.getElementById('drilldownCount').textContent = `${filtered.length} of ${currentDrilldownRows.length} records`;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ===== Timer =====
function startCountdown() {
    clearInterval(countdownTimer);
    countdown = REFRESH_INTERVAL;
    document.getElementById('refreshTimer').textContent = countdown + 's';

    countdownTimer = setInterval(() => {
        if (!autoRefreshEnabled) return;
        countdown--;
        document.getElementById('refreshTimer').textContent = countdown + 's';
        if (countdown <= 0) {
            fetchAndRender();
            countdown = REFRESH_INTERVAL;
        }
    }, 1000);
}

function resetCountdown() {
    countdown = REFRESH_INTERVAL;
    document.getElementById('refreshTimer').textContent = countdown + 's';
}

// ===== UI Helpers =====
function showLoading(show) {
    const el = document.getElementById('loadingOverlay');
    if (show) el.classList.remove('hidden');
    else el.classList.add('hidden');
}

function showError(msg) {
    const toast = document.getElementById('toastError');
    document.getElementById('toastMessage').textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 8000);
}

function hideError() {
    document.getElementById('toastError').classList.remove('show');
}

function updateTimestamp() {
    const now = new Date();
    const time = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    document.getElementById('lastUpdated').textContent = `Updated: ${time}`;
}

// ===== Report Generation =====
(function initReport() {
    const overlay = document.getElementById('reportOverlay');
    const btnOpen = document.getElementById('btnReport');
    const btnClose = document.getElementById('reportClose');
    const btnDownload = document.getElementById('btnDownloadReport');
    const dateInput = document.getElementById('reportDateInput');
    const dateLabel = document.getElementById('reportDateLabel');
    const bankCheckbox = document.getElementById('reportBankCheckbox');

    // Set default date to today
    const today = new Date();
    dateInput.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    function openReportModal() {
        // Hide bank checkbox if a specific bank is selected
        if (selectedBank && selectedBank !== 'all') {
            bankCheckbox.classList.add('hidden');
            bankCheckbox.querySelector('input').checked = false;
        } else {
            bankCheckbox.classList.remove('hidden');
            bankCheckbox.querySelector('input').checked = true;
        }
        overlay.classList.add('open');
        document.body.style.overflow = 'hidden';
    }

    function closeReportModal() {
        overlay.classList.remove('open');
        document.body.style.overflow = '';
    }

    btnOpen.addEventListener('click', openReportModal);
    btnClose.addEventListener('click', closeReportModal);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeReportModal();
    });

    // Radio toggle: Daily / Weekly
    document.querySelectorAll('input[name="reportType"]').forEach(radio => {
        radio.addEventListener('change', () => {
            if (radio.value === 'weekly') {
                dateLabel.textContent = 'Select any date in the week';
            } else {
                dateLabel.textContent = 'Select Date';
            }
        });
    });

    // Download PDF
    btnDownload.addEventListener('click', async () => {
        const reportType = document.querySelector('input[name="reportType"]:checked').value;
        const dateVal = dateInput.value;
        if (!dateVal) { alert('Please select a date.'); return; }

        // Get selected sections
        const sections = {};
        document.querySelectorAll('#reportSections .report-checkbox').forEach(label => {
            const key = label.dataset.section;
            const checked = label.querySelector('input').checked;
            if (!label.classList.contains('hidden')) {
                sections[key] = checked;
            }
        });

        btnDownload.disabled = true;
        btnDownload.textContent = 'Generating...';

        try {
            // Fetch report data
            let params = [`type=${reportType}`, `date=${dateVal}`];
            if (selectedBank && selectedBank !== 'all') {
                params.push(`bank=${encodeURIComponent(selectedBank)}`);
            }
            const res = await fetch(`/api/report?${params.join('&')}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Failed to fetch report data');

            const m = json.metrics;
            await generatePDF(m, sections, reportType, dateVal);
        } catch (err) {
            console.error('Report error:', err);
            alert('Error generating report: ' + err.message);
        } finally {
            btnDownload.disabled = false;
            btnDownload.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg> Download PDF`;
        }
    });

    let _logoCache = null;
    async function loadLogoBase64() {
        if (_logoCache) return _logoCache;
        return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth;
                canvas.height = img.naturalHeight;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                _logoCache = canvas.toDataURL('image/png');
                resolve(_logoCache);
            };
            img.onerror = () => resolve(null);
            img.src = '/logo.png';
        });
    }

    async function generatePDF(m, sections, reportType, dateVal) {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();
        const margin = 15;
        const contentW = pageW - margin * 2;
        let y = margin;

        // Colors
        const gold = [212, 168, 67];
        const blue = [43, 87, 151];
        const darkBg = [22, 27, 34];
        const cardBg = [30, 36, 46];
        const textPrimary = [230, 233, 240];
        const textSecondary = [139, 149, 176];
        const borderColor = [55, 63, 78];

        function checkPageBreak(needed) {
            if (y + needed > pageH - margin) {
                doc.addPage();
                // Fill dark background on new page immediately
                doc.setFillColor(...darkBg);
                doc.rect(0, 0, pageW, pageH, 'F');
                y = margin;
            }
        }

        function drawSectionTitle(title, reserveAfter) {
            // Reserve space for title (10mm) + whatever content follows
            const needed = 10 + (reserveAfter || 20);
            checkPageBreak(needed);
            doc.setFontSize(13);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(...gold);
            doc.text(title, margin, y);
            y += 2;
            doc.setDrawColor(...gold);
            doc.setLineWidth(0.5);
            doc.line(margin, y, margin + contentW, y);
            y += 8;
        }

        function drawTable(headers, rows, colWidths) {
            const rowH = 7;
            const headerH = 8;

            // Header
            checkPageBreak(headerH + rowH * Math.min(rows.length, 3));
            doc.setFillColor(...blue);
            doc.rect(margin, y, contentW, headerH, 'F');
            doc.setFontSize(8);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(255, 255, 255);
            let x = margin + 2;
            headers.forEach((h, i) => {
                doc.text(h, x, y + 5.5);
                x += colWidths[i];
            });
            y += headerH;

            // Rows
            doc.setFont('helvetica', 'normal');
            rows.forEach((row, ri) => {
                checkPageBreak(rowH);
                if (ri % 2 === 0) {
                    doc.setFillColor(25, 31, 40);
                } else {
                    doc.setFillColor(20, 25, 33);
                }
                doc.rect(margin, y, contentW, rowH, 'F');
                doc.setTextColor(...textPrimary);
                doc.setFontSize(7.5);
                let rx = margin + 2;
                row.forEach((cell, ci) => {
                    const text = String(cell || '—').substring(0, Math.floor(colWidths[ci] / 2));
                    doc.text(text, rx, y + 5);
                    rx += colWidths[ci];
                });
                y += rowH;
            });
            y += 6;
        }

        function drawKeyValueTable(data, label1, label2) {
            const entries = Object.entries(data);
            if (!entries.length) return;
            const col1W = contentW * 0.65;
            const col2W = contentW * 0.35;
            drawTable([label1, label2], entries, [col1W, col2W]);
        }

        // ===== HEADER =====
        // Dark background
        doc.setFillColor(...darkBg);
        doc.rect(0, 0, pageW, pageH, 'F');

        // Title bar
        doc.setFillColor(...cardBg);
        doc.roundedRect(margin, y, contentW, 30, 3, 3, 'F');

        // Add logo
        try {
            const logoDataUrl = await loadLogoBase64();
            if (logoDataUrl) {
                doc.addImage(logoDataUrl, 'PNG', margin + 3, y + 3, 60, 24);
            }
        } catch (e) { console.warn('Logo load failed:', e); }

        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...gold);
        doc.text('MIS Report', margin + 68, y + 13);

        // Subtitle
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...textSecondary);
        const typeLabel = reportType === 'weekly' ? 'Weekly Report' : 'Daily Report';
        const bankLabel = (selectedBank && selectedBank !== 'all') ? ` | Bank: ${selectedBank}` : '';
        doc.text(`${typeLabel} — ${dateVal}${bankLabel}`, margin + 68, y + 22);
        y += 38;

        // ===== KPI SUMMARY =====
        if (sections.kpi) {
            drawSectionTitle('KPI Summary');
            checkPageBreak(20);

            const kpiW = contentW / 3;
            const kpis = [
                { label: 'Total Cases', value: String(m.totalCases) },
                { label: 'Avg Visit TAT', value: `${m.avgVisitTAT} days` },
                { label: 'Avg Report TAT', value: `${m.avgReportTAT} days` },
            ];
            kpis.forEach((kpi, i) => {
                const kx = margin + i * kpiW;
                doc.setFillColor(...cardBg);
                doc.roundedRect(kx + 1, y, kpiW - 2, 18, 2, 2, 'F');
                doc.setFontSize(8);
                doc.setFont('helvetica', 'normal');
                doc.setTextColor(...textSecondary);
                doc.text(kpi.label, kx + 5, y + 7);
                doc.setFontSize(14);
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(...gold);
                doc.text(kpi.value, kx + 5, y + 15);
            });
            y += 26;
        }

        // ===== TAT BREAKUP =====
        if (sections.tat) {
            drawSectionTitle('TAT Breakup');
            const tat = m.tatBreakup;
            const buckets = Object.entries(tat.buckets);
            if (buckets.length) {
                const bktW = contentW / buckets.length;
                checkPageBreak(16);
                buckets.forEach(([label, count], i) => {
                    const bx = margin + i * bktW;
                    doc.setFillColor(...cardBg);
                    doc.roundedRect(bx + 1, y, bktW - 2, 14, 2, 2, 'F');
                    doc.setFontSize(8);
                    doc.setTextColor(...textSecondary);
                    doc.text(label, bx + 4, y + 6);
                    doc.setFontSize(12);
                    doc.setFont('helvetica', 'bold');
                    doc.setTextColor(...textPrimary);
                    doc.text(String(count), bx + 4, y + 12);
                });
                y += 22;
            }
        }

        // ===== CHART RENDERING HELPER =====
        function renderChartToImage(type, labels, values, colors, horizontal) {
            return new Promise((resolve) => {
                const total = values.reduce((a, b) => a + b, 0);
                const canvas = document.createElement('canvas');
                // Use high resolution for crisp PDF output
                canvas.width = 1200;
                canvas.height = type === 'doughnut' ? 900 : 700;
                const ctx = canvas.getContext('2d');

                // Fill dark background FIRST
                ctx.fillStyle = '#1e242e';
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                const chartConfig = type === 'doughnut' ? {
                    type: 'doughnut',
                    data: {
                        labels,
                        datasets: [{
                            data: values,
                            backgroundColor: colors.slice(0, labels.length),
                            borderColor: '#1e242e',
                            borderWidth: 3,
                            hoverOffset: 8,
                        }]
                    },
                    options: {
                        responsive: false,
                        animation: false,
                        cutout: '60%',
                        layout: { padding: { top: 20, bottom: 20, left: 20, right: 20 } },
                        plugins: {
                            legend: {
                                display: true,
                                position: 'bottom',
                                labels: {
                                    color: '#e6e9f0',
                                    font: { size: 22, weight: '500' },
                                    padding: 18,
                                    usePointStyle: true,
                                    pointStyle: 'circle',
                                    generateLabels: (chart) => {
                                        const data = chart.data;
                                        return data.labels.map((label, i) => {
                                            const val = data.datasets[0].data[i];
                                            const pct = total ? ((val / total) * 100).toFixed(1) : 0;
                                            return {
                                                text: `${label}  ${pct}%  (${val})`,
                                                fillStyle: data.datasets[0].backgroundColor[i],
                                                strokeStyle: 'transparent',
                                                index: i,
                                                fontColor: '#e6e9f0',
                                            };
                                        });
                                    }
                                }
                            }
                        }
                    }
                } : {
                    type: 'bar',
                    data: {
                        labels,
                        datasets: [{
                            data: values,
                            backgroundColor: colors.slice(0, labels.length),
                            borderRadius: 6,
                            barThickness: horizontal ? 22 : undefined,
                            maxBarThickness: 40,
                        }]
                    },
                    options: {
                        responsive: false,
                        animation: false,
                        indexAxis: horizontal ? 'y' : 'x',
                        layout: { padding: { top: 10, bottom: 10, left: 10, right: 20 } },
                        plugins: {
                            legend: { display: false },
                            tooltip: { enabled: false },
                        },
                        scales: {
                            x: {
                                ticks: { color: '#8b95b0', font: { size: 16 } },
                                grid: { color: 'rgba(255,255,255,0.06)' },
                                border: { color: 'rgba(255,255,255,0.1)' },
                            },
                            y: {
                                ticks: { color: '#e6e9f0', font: { size: 16 } },
                                grid: { color: 'rgba(255,255,255,0.06)' },
                                border: { color: 'rgba(255,255,255,0.1)' },
                            }
                        }
                    }
                };

                const chart = new Chart(ctx, chartConfig);
                setTimeout(() => {
                    const imgData = canvas.toDataURL('image/png');
                    chart.destroy();
                    resolve(imgData);
                }, 150);
            });
        }

        // ===== DISTRIBUTION CHARTS =====
        const distSections = [
            { key: 'caseStatus', title: 'Case Status Distribution', data: m.caseStatus, type: 'doughnut', colors: PALETTE.doughnut, horizontal: false },
            { key: 'propertyType', title: 'Property Type Distribution', data: m.propertyType, type: 'bar', colors: PALETTE.blue, horizontal: false },
            { key: 'location', title: 'Location Distribution', data: m.location, type: 'bar', colors: PALETTE.mixed, horizontal: true },
            { key: 'engineer', title: 'Engineer Efficiency', data: m.engineerEfficiency, type: 'bar', colors: PALETTE.gold, horizontal: true },
            { key: 'reportEff', title: 'Report Generation Efficiency', data: m.reportEfficiency, type: 'bar', colors: PALETTE.blue, horizontal: true },
        ];

        for (const sec of distSections) {
            if (!sections[sec.key]) continue;
            const entries = Object.entries(sec.data);
            if (!entries.length) continue;

            const chartH = sec.type === 'doughnut' ? 95 : 80;
            drawSectionTitle(sec.title, chartH);

            const labels = entries.map(e => e[0]);
            const values = entries.map(e => e[1]);
            const chartImg = await renderChartToImage(sec.type, labels, values, sec.colors, sec.horizontal);
            doc.addImage(chartImg, 'PNG', margin, y, contentW, chartH);
            y += chartH + 6;
        }

        // ===== SCHEDULED VISITS =====
        if (sections.schedule && m.todaySchedule && m.todaySchedule.length > 0) {
            drawSectionTitle(`Scheduled Visits (${m.todaySchedule.length})`, 30);
            const schedHeaders = ['Sr No', 'Borrower', 'Location', 'Engineer', 'Date'];
            const schedColW = [15, contentW * 0.25, contentW * 0.25, contentW * 0.25, contentW * 0.25 - 15];
            const schedRows = m.todaySchedule.map(r => [r.srNo, r.borrower, r.location, r.engineer, r.initiationDate]);
            drawTable(schedHeaders, schedRows, schedColW);
        }

        // ===== QUERY NOT VISITED =====
        if (sections.query && m.queryNotVisited && m.queryNotVisited.length > 0) {
            drawSectionTitle(`Query and Visit not done (${m.queryNotVisited.length})`, 30);
            const qHeaders = ['Sr No', 'Borrower', 'Location', 'Engineer', 'Date'];
            const qColW = [15, contentW * 0.25, contentW * 0.25, contentW * 0.25, contentW * 0.25 - 15];
            const qRows = m.queryNotVisited.map(r => [r.srNo, r.borrower, r.location, r.engineer, r.initiationDate]);
            drawTable(qHeaders, qRows, qColW);
        }

        // ===== TOTAL CASES DETAILS (always included) =====
        drawSectionTitle(`Total Cases Details (${m.allCaseDetails ? m.allCaseDetails.length : 0} cases)`, 30);
        if (m.allCaseDetails && m.allCaseDetails.length > 0) {
            const detHeaders = ['Sr', 'Borrower', 'Location', 'Status', 'Init Date', 'Visit', 'Report'];
            const detColW = [12, contentW * 0.20, contentW * 0.16, contentW * 0.14, contentW * 0.14, contentW * 0.14, contentW * 0.22 - 12];
            const detRows = m.allCaseDetails.map(r => [
                r.srNo, r.borrower, r.location, r.status,
                r.initiationDate, r.visitDate, r.reportDate
            ]);
            drawTable(detHeaders, detRows, detColW);
        } else {
            doc.setFontSize(9);
            doc.setFont('helvetica', 'italic');
            doc.setTextColor(...textSecondary);
            doc.text('No cases found for the selected date range.', margin, y);
            y += 10;
        }

        // ===== FOOTER on each page =====
        const totalPages = doc.internal.getNumberOfPages();
        for (let i = 1; i <= totalPages; i++) {
            doc.setPage(i);
            doc.setFontSize(7);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(...textSecondary);
            doc.text(`VDS Advisory — MIS Report | Generated: ${new Date().toLocaleString('en-IN')}`, margin, pageH - 8);
            doc.text(`Page ${i} of ${totalPages}`, pageW - margin - 20, pageH - 8);
        }

        // Save
        const bankSuffix = (selectedBank && selectedBank !== 'all') ? `_${selectedBank}` : '';
        doc.save(`VDS_MIS_${reportType}_${dateVal}${bankSuffix}.pdf`);
    }
})();

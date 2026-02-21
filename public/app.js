// ===== VDS Advisory MIS Dashboard — Frontend App =====

const API_METRICS = '/api/metrics';
const API_DATA = '/api/data';
const REFRESH_INTERVAL = 60; // seconds

let autoRefreshEnabled = true;
let countdown = REFRESH_INTERVAL;
let countdownTimer = null;
let charts = {};
let allRows = []; // Store all rows for drill-down filtering
let selectedMonth = 'all';
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
    fetchAndRender();
    startCountdown();

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
});

// ===== Data Fetching =====
async function fetchAndRender() {
    showLoading(true);
    try {
        const monthParam = selectedMonth !== 'all' ? `?month=${selectedMonth}` : '';
        // Fetch metrics and raw data in parallel
        const [metricsRes, dataRes] = await Promise.all([
            fetch(API_METRICS + monthParam),
            fetch(API_DATA + monthParam)
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
        renderSchedule(metricsJson.metrics.todaySchedule);
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
    // Restore selection
    select.value = current && select.querySelector(`option[value="${current}"]`) ? current : 'all';
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

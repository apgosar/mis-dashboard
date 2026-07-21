document.addEventListener('DOMContentLoaded', async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const type = urlParams.get('type');
  const date = urlParams.get('date');
  const bank = urlParams.get('bank') || 'all';
  const sectionsStr = urlParams.get('sections');
  const sections = sectionsStr ? JSON.parse(decodeURIComponent(sectionsStr)) : {};

  // Update Header
  const typeLabel = type === 'mtd' ? 'Month to Date' : 'Daily';
  const prefix = bank !== 'all' ? `${bank} ` : '';
  
  document.getElementById('reportTitle').textContent = `${prefix}${typeLabel} MIS Report`;
  document.getElementById('reportMeta').textContent = `Generated for ${date}`;

  try {
    const res = await fetch(`/api/report?type=${type}&date=${date}&bank=${encodeURIComponent(bank)}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    renderReport(json.metrics, sections);
  } catch (err) {
    document.getElementById('content').innerHTML = `<p style="color:red">Error: ${err.message}</p>`;
    document.getElementById('status').textContent = 'Ready';
  }
});

function renderReport(m, sections) {
  const container = document.getElementById('content');

  const addSectionTitle = (title) => {
    const div = document.createElement('div');
    div.className = 'section-title';
    div.textContent = title;
    return div;
  };

  const createSection = (title) => {
    const div = document.createElement('div');
    div.className = 'section';
    div.appendChild(addSectionTitle(title));
    container.appendChild(div);
    return div;
  };

  // 1. KPI Summary
  if (sections.kpi) {
    const sec = createSection('KPI Summary');
    const grid = document.createElement('div');
    grid.className = 'kpi-grid';
    grid.innerHTML = `
      <div class="kpi-box"><div class="kpi-label">Total Cases</div><div class="kpi-val">${m.totalCases}</div></div>
      <div class="kpi-box"><div class="kpi-label">Avg Visit TAT</div><div class="kpi-val">${m.avgVisitTAT} days</div></div>
      <div class="kpi-box"><div class="kpi-label">Avg Report TAT</div><div class="kpi-val">${m.avgReportTAT} days</div></div>
    `;
    sec.appendChild(grid);
  }

  // 2. TAT Breakup
  if (sections.tat) {
    const sec = createSection('TAT Breakup');
    const grid = document.createElement('div');
    grid.className = 'kpi-grid';
    const tat = m.tatBreakup || {};
    grid.innerHTML = `
      <div class="kpi-box"><div class="kpi-label">T+0</div><div class="kpi-val">${tat.t0 || 0}</div></div>
      <div class="kpi-box"><div class="kpi-label">T+1</div><div class="kpi-val">${tat.t1 || 0}</div></div>
      <div class="kpi-box"><div class="kpi-label">T+2</div><div class="kpi-val">${tat.t2 || 0}</div></div>
      <div class="kpi-box"><div class="kpi-label">T+3</div><div class="kpi-val">${tat.t3 || 0}</div></div>
      <div class="kpi-box"><div class="kpi-label">T+4+</div><div class="kpi-val">${tat.t4Plus || 0}</div></div>
    `;
    sec.appendChild(grid);
  }

  // Chart setup
  const blue = ['#2b5797', '#3d7fd9', '#1e3f6e', '#5a9cf0', '#174a8a', '#4a8ed4', '#2666b0', '#7ab4f5'];
  const gold = ['#b8892c', '#c9a03a', '#c49630', '#d4a843', '#e6c060', '#dbb554', '#f0cc6b'];
  const mixed = ['#2b5797', '#d4a843', '#4ecdc4', '#e76f51', '#6c5ce7', '#00b894', '#fd79a8', '#fdcb6e'];

  const createChart = (secObj, id) => {
    const sec = createSection(secObj.title);
    // Add page break before large charts if needed, but css page-break-inside: avoid handles it mostly
    const box = document.createElement('div');
    box.className = secObj.horizontal ? 'chart-box-large' : 'chart-box';
    const canvas = document.createElement('canvas');
    canvas.id = id;
    box.appendChild(canvas);
    sec.appendChild(box);

    const entries = Object.entries(secObj.data || {});
    if (entries.length === 0) return;

    const labels = entries.map(e => e[0]);
    const values = entries.map(e => e[1]);
    const colors = labels.map((_, i) => secObj.colors[i % secObj.colors.length]);

    new Chart(canvas.getContext('2d'), {
      type: secObj.type,
      data: {
        labels,
        datasets: [{
          label: secObj.label || 'Count',
          data: values,
          backgroundColor: secObj.type === 'bar' ? colors.map(c => c+'CC') : colors,
          borderColor: secObj.type === 'bar' ? colors : '#fff',
          borderWidth: 1
        }]
      },
      plugins: [ChartDataLabels],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: secObj.horizontal ? 'y' : 'x',
        layout: {
          padding: 15
        },
        plugins: { 
          legend: { 
            display: secObj.type === 'doughnut', 
            position: 'right',
            labels: { 
              font: { size: 14 },
              generateLabels: (chart) => {
                const data = chart.data;
                if (data.labels.length && data.datasets.length) {
                  return data.labels.map((label, i) => {
                    const val = data.datasets[0].data[i];
                    const total = data.datasets[0].data.reduce((a, b) => a + b, 0);
                    const pct = total ? ((val / total) * 100).toFixed(0) : 0;
                    return {
                      text: `${label}: ${val} (${pct}%)`,
                      fillStyle: data.datasets[0].backgroundColor[i],
                      hidden: false,
                      index: i
                    };
                  });
                }
                return [];
              }
            }
          },
          datalabels: {
            display: secObj.type !== 'doughnut',
            color: '#1a1f36',
            font: { weight: 'bold', size: 10 },
            formatter: (val) => val,
            anchor: secObj.horizontal ? 'end' : 'end',
            align: secObj.horizontal ? 'right' : 'top',
            offset: 2
          }
        }
      }
    });
  };

  const chartSections = [
    { key: 'caseStatus', title: 'Case Status Distribution', data: m.caseStatus, type: 'doughnut', colors: mixed, horizontal: false },
    { key: 'propertyType', title: 'Property Type Distribution', data: m.propertyType, type: 'bar', colors: blue, horizontal: false },
    { key: 'location', title: 'Location Distribution', data: m.location, type: 'bar', colors: mixed, horizontal: true },
    { key: 'engineer', title: 'Engineer Efficiency', data: m.engineerEfficiency, type: 'bar', colors: gold, horizontal: true },
    { key: 'bank', title: 'Bank Distribution', data: m.bankDistribution, type: 'bar', colors: mixed, horizontal: true },
    { key: 'reportEff', title: 'Report Generation Efficiency', data: m.reportEfficiency, type: 'bar', colors: blue, horizontal: true },
    { key: 'queryTimeByBank', title: 'Avg Query Time by Bank (Days)', data: m.queryTimeByBank, type: 'bar', colors: mixed, horizontal: true, label: 'Days' },
    { key: 'queryCasesByBank', title: 'Number of Cases in Query by Bank', data: m.queryCasesByBank, type: 'bar', colors: gold, horizontal: true, label: 'Cases' }
  ];

  chartSections.forEach((s, i) => {
    if (sections[s.key] && s.data && Object.keys(s.data).length > 0) {
      createChart(s, 'chart_' + i);
    }
  });

  // Table generic func
  const createTableSection = (title, columns, rowsData) => {
    if (!rowsData || rowsData.length === 0) return;
    const sec = createSection(title + ` (${rowsData.length} cases)`);
    sec.className = 'section page-break';
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr>' + columns.map(c => `<th>${c.label}</th>`).join('') + '</tr>';
    table.appendChild(thead);
    
    const tbody = document.createElement('tbody');
    rowsData.forEach(row => {
      tbody.innerHTML += '<tr>' + columns.map(c => `<td>${row[c.key] || '—'}</td>`).join('') + '</tr>';
    });
    table.appendChild(tbody);
    sec.appendChild(table);
  };

  if (sections.todaySchedule) {
    createTableSection("Today's Scheduled Visits", [
      { key: 'srNo', label: 'Sr' }, { key: 'borrower', label: 'Borrower' },
      { key: 'location', label: 'Location' }, { key: 'engineer', label: 'Engineer' }
    ], m.todaySchedule);
  }

  if (sections.queryNotVisited) {
    createTableSection("Query and Visit Not Done", [
      { key: 'srNo', label: 'Sr' }, { key: 'borrower', label: 'Borrower' },
      { key: 'location', label: 'Location' }, { key: 'queryDescription', label: 'Query Description' }
    ], m.queryNotVisited);
  }

  // All Cases Table
  if (m.allCaseDetails && m.allCaseDetails.length > 0) {
    createTableSection("Total Cases Details", [
      { key: 'srNo', label: 'Sr' },
      { key: 'borrower', label: 'Borrower' },
      { key: 'location', label: 'Location' },
      { key: 'status', label: 'Status' },
      { key: 'initiationDate', label: 'Init Date' },
      { key: 'visitDate', label: 'Visit' },
      { key: 'reportDate', label: 'Report' }
    ], m.allCaseDetails);
  }

  // Signal Puppeteer that we are ready
  // Slight delay for Chart.js animation completion
  setTimeout(() => {
    document.getElementById('status').textContent = 'Ready';
  }, 1000);
}

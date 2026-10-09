// ── Cheap hours ──
function refreshCheapHours() {
  fetch('/api/prices').then(function(r){return r.json();}).then(function(p) {
    var grid = document.getElementById('cheap-hours-grid');
    if (!grid) return;
    var hours = (p.hours || []).filter(function(h) { return h.elec != null; });
    if (!hours.length) { grid.innerHTML = '<div class="empty-note">Uurprijzen niet beschikbaar</div>'; return; }
    var nowH = new Date().getHours();
    var sorted = hours.map(function(h) { return h.elec; }).sort(function(a, b) { return a - b; });
    var cheapMax = sorted[Math.floor(sorted.length / 3)], expMin = sorted[Math.floor(sorted.length * 2 / 3)];
    function hh(h) { return parseInt(h.hour.slice(11), 10); }
    var rest = hours.filter(function(h) { return hh(h) >= nowH; }).sort(function(a, b) { return a.elec - b.elec; }).slice(0, 3).sort(function(a, b) { return hh(a) - hh(b); });
    var html = '<div class="cheap-summary">Goedkoopst vanaf nu: <strong>' +
      rest.map(function(h) { return hh(h) + ':00 (€' + nlNum(h.elec, 2) + ')'; }).join(', ') + '</strong></div>';
    html += hours.map(function(h) {
      var cls = h.elec <= cheapMax ? 'hour-cheap' : h.elec >= expMin ? 'hour-exp' : 'hour-mid';
      var when = hh(h) < nowH ? ' past' : hh(h) === nowH ? ' now' : '';
      return '<span class="' + cls + when + '" title="€' + nlNum(h.elec, 4) + '/kWh">' + hh(h) + 'u · ' + nlNum(h.elec, 2) + '</span>';
    }).join('');
    grid.innerHTML = html;
  }).catch(function(){});
}

// ── Weekday chart ──
var chartWeekday = null;
function loadWeekdayChart() {
  fetch('/api/weekday-avg').then(function(r){return r.json();}).then(function(rows) {
    var dayNames = ['Zo','Ma','Di','Wo','Do','Vr','Za'];
    var byDow = {};
    rows.forEach(function(r){ byDow[parseInt(r.dow,10)] = r; });
    var labels = [], data = [];
    for (var d = 0; d < 7; d++) {
      labels.push(dayNames[d]);
      var r = byDow[d];
      data.push(r && r.avg_del != null ? Number(r.avg_del).toFixed(3) : 0);
    }
    if (chartWeekday) chartWeekday.destroy();
    chartWeekday = new Chart(document.getElementById('chart-weekday'), {
      type: 'bar',
      data: { labels: labels, datasets: [{ label: 'Gem. verbruik (kW)', data: data, backgroundColor: ['rgba(141,178,85,0.4)','rgba(141,178,85,0.6)','rgba(141,178,85,0.6)','rgba(141,178,85,0.6)','rgba(141,178,85,0.6)','rgba(141,178,85,0.6)','rgba(141,178,85,0.4)'], borderColor: '#8DB255', borderWidth: 1, borderRadius: 4 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: CHART_TEXT, font: { size: 11, weight: '600' } }, grid: { color: CHART_GRID } }, y: { ticks: { color: CHART_TICK, font: { size: 11 } }, grid: { color: CHART_GRID }, beginAtZero: true } } }
    });
  }).catch(function(){});
}

// ── Heatmap ──
function loadHeatmap(range, btn) {
  document.querySelectorAll('[data-hm]').forEach(function(t) { t.classList.remove('active'); });
  if (btn) btn.classList.add('active');
  fetch('/api/heatmap?range=' + (range || 'alltime')).then(function(r){return r.json();}).then(function(rows) {
    var dayNames = ['Zo','Ma','Di','Wo','Do','Vr','Za'];
    var grid = {}, maxVal = 0;
    rows.forEach(function(r) {
      var v = r.avg_del != null ? Number(r.avg_del) : 0;
      grid[r.dow + '_' + parseInt(r.hour,10)] = v;
      if (v > maxVal) maxVal = v;
    });
    if (maxVal === 0) maxVal = 1;
    var html = '<div class="hm-label"></div>';
    for (var h = 0; h < 24; h++) html += '<div class="hm-hour-label">' + (h % 3 === 0 ? h : '') + '</div>';
    for (var d = 0; d < 7; d++) {
      html += '<div class="hm-label">' + dayNames[d] + '</div>';
      for (var h = 0; h < 24; h++) {
        var v = grid[d + '_' + h] || 0;
        var ratio = v / maxVal;
        var alpha = 0.08 + ratio*0.87;
        var bg = 'rgba(141,178,85,'+alpha.toFixed(2)+')';
        html += '<div class="hm-cell" style="background:'+bg+'" title="'+dayNames[d]+' '+h+':00 — '+powerText(v)+'"></div>';
      }
    }
    var hmEl = document.getElementById('heatmap'); if (hmEl) hmEl.innerHTML = html;
  }).catch(function(){});
}

// ── Daily costs chart ──
var chartCostsDaily = null;
function loadCostsDaily() {
  fetch('/api/costs-daily').then(function(r){return r.json();}).then(function(rows) {
    var labels  = rows.map(function(r){ return r.day.slice(5); });
    var elecD   = rows.map(function(r){ return r.elec_cost != null ? Number(r.elec_cost).toFixed(2) : 0; });
    var gasD    = rows.map(function(r){ return r.gas_cost  != null ? Number(r.gas_cost).toFixed(2)  : 0; });
    if (chartCostsDaily) chartCostsDaily.destroy();
    chartCostsDaily = new Chart(document.getElementById('chart-costs-daily'), {
      type: 'bar',
      data: { labels: labels, datasets: [
        { label: 'Stroom (€)', data: elecD, backgroundColor: 'rgba(141,178,85,0.55)', borderColor: '#8DB255', borderWidth: 1, borderRadius: 3, stack: 'cost' },
        { label: 'Gas (€)',    data: gasD,  backgroundColor: 'rgba(249,115,22,0.55)', borderColor: '#F97316', borderWidth: 1, borderRadius: 3, stack: 'cost' }
      ].filter(function(ds, i) { return i === 0 || moduleOn('gas'); })},
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: CHART_TEXT, boxWidth: 10, font: { size: 11 } } } }, scales: { x: { ticks: { color: CHART_TICK, maxRotation: 45, font: { size: 11 } }, grid: { color: CHART_GRID }, stacked: true }, y: { ticks: { color: CHART_TICK, font: { size: 11 }, callback: function(v){ return '€'+v; } }, grid: { color: CHART_GRID }, beginAtZero: true, stacked: true } } }
    });
  }).catch(function(){});
}

// ── Kosten-pagina ──
// Balkjes met bedrag en aandeel; regels zonder bedrag (bv. gas uit) vallen weg
function shareBars(id, items) {
  items = items.filter(function(i) { return i.cost != null; });
  var total = items.reduce(function(t, i) { return t + i.cost; }, 0);
  setEl(id, items.map(function(i) {
    var pct = total > 0 ? i.cost / total * 100 : 0;
    return '<div class="share-row"><div class="share-head"><span>' + i.label + (i.sub ? '<small>' + i.sub + '</small>' : '') + '</span><span>' + eur(i.cost) + ' · ' + pct.toFixed(0) + '%</span></div>' +
      '<div class="phase-bar-track"><div class="phase-bar-fill" style="width:' + pct.toFixed(1) + '%' + (i.color ? ';background:' + i.color : '') + '"></div></div></div>';
  }).join('') || '<div class="power-sub">Nog geen gegevens</div>');
}
var chartCostsMonthly = null, chartStandbyNights = null;
function loadCostsOverview() {
  fetch('/api/costs-overview').then(function(r){return r.json();}).then(function(o) {
    var r = o.recent, a = o.avg_day;
    function nlDate(d, opts) { return new Date(d + 'T12:00:00').toLocaleDateString('nl-NL', opts); }

    setEl('kost-month', eur(o.month.total));
    setEl('kost-month-sub', 'stroom ' + eur(o.month.elec) + (o.month.gas != null ? ' · gas ' + eur(o.month.gas) : ''));
    var left = o.month.days_in_month - parseInt(o.today.slice(8), 10);
    setEl('kost-fc-month', eur(o.forecast_month));
    setEl('kost-fc-month-sub', a ? 'nog ' + left + (left === 1 ? ' dag' : ' dagen') + ' te gaan' : 'na één volle dag meten');
    setEl('kost-avg-day', a ? eur(a.total) : '—');
    setEl('kost-avg-day-sub', a ? 'over ' + a.days + (a.days === 1 ? ' dag' : ' dagen') : '');
    setEl('kost-fc-year', o.forecast_year != null ? '€' + nlNum(o.forecast_year, 0) : '—');
    setEl('kost-fc-year-sub', a ? 'als elke dag zo is als nu' : '');

    var sb = r.standby;
    setEl('kost-standby', sb && sb.cost_year != null ? '€' + nlNum(sb.cost_year, 0) : '—');
    setEl('kost-standby-sub', sb ? (sb.kw * 1000).toFixed(0) + ' W continu' + (r.elec_cost ? ' · ' + (sb.cost / r.elec_cost * 100).toFixed(0) + '% van je stroom' : '') : '');
    var phases = r.phases.filter(function(p) { return p.kwh > 0; });
    var phaseKwh = phases.reduce(function(t, p) { return t + p.kwh; }, 0);
    var top = phases.slice().sort(function(x, y) { return y.kwh - x.kwh; })[0];
    setEl('kost-top-phase', top ? top.label : '—');
    setEl('kost-top-phase-sub', top ? (top.kwh / phaseKwh * 100).toFixed(0) + '% van je stroom' : '');
    setEl('kost-paid', r.paid_per_kwh != null ? '€' + nlNum(r.paid_per_kwh, 3) + '<span class="stat-unit">/kWh</span>' : '—');
    if (r.paid_per_kwh != null && r.avg_price) {
      var diff = (r.paid_per_kwh - r.avg_price) / r.avg_price * 100;
      setEl('kost-paid-sub', Math.abs(diff) < 0.5 ? 'gelijk aan de gem. uurprijs' : Math.abs(diff).toFixed(0) + '% ' + (diff < 0 ? 'onder' : 'boven') + ' de gem. uurprijs');
    }
    setEl('kost-priciest', o.priciest_day ? eur(o.priciest_day.cost) : '—');
    setEl('kost-priciest-sub', o.priciest_day ? nlDate(o.priciest_day.day, {weekday:'short', day:'numeric', month:'short'}) : '');

    var hasSb = sb && r.elec_cost != null;
    shareBars('kost-split', [
      { label: 'Sluipverbruik', sub: 'staat altijd aan', cost: hasSb ? sb.cost : null, color: '#F87171' },
      { label: hasSb ? 'Overige stroom' : 'Stroom', cost: r.elec_cost != null ? r.elec_cost - (hasSb ? sb.cost : 0) : null },
      { label: 'Gas', cost: r.gas_cost, color: '#F97316' }
    ]);
    var phaseColors = { L1: '#8DB255', L2: '#38BDF8', L3: '#F97316' };
    shareBars('kost-phases', phases.map(function(p) { return { label: p.label, sub: num(p.kwh, 1) + ' kWh', cost: p.cost, color: phaseColors[p.label] }; }));
    shareBars('kost-parts', r.parts.map(function(p) {
      return { label: p.label, sub: ('0' + p.from).slice(-2) + '–' + ('0' + p.to).slice(-2) + ' u · ' + num(p.kwh, 1) + ' kWh', cost: p.cost };
    }));

    var nights = r.nights.filter(function(n) { return n.kw != null; });
    var lastNight = nights[nights.length - 1];
    setEl('kost-night-last', lastNight ? (lastNight.day === o.today ? 'afgelopen nacht' : nlDate(lastNight.day, {weekday:'short', day:'numeric'})) + ': ' + (lastNight.kw * 1000).toFixed(0) + ' W' + (lastNight.cost != null ? ' · ' + eur(lastNight.cost) : '') : '');
    if (chartStandbyNights) chartStandbyNights.destroy();
    chartStandbyNights = new Chart(document.getElementById('chart-standby-nights'), {
      type: 'bar',
      data: { labels: nights.map(function(n) { return nlDate(n.day, {weekday:'short', day:'numeric'}); }), datasets: [
        { label: 'Gem. vermogen (W)', data: nights.map(function(n) { return (n.kw * 1000).toFixed(0); }), backgroundColor: 'rgba(248,113,113,0.45)', borderColor: '#F87171', borderWidth: 1, borderRadius: 3 }
      ]},
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: function(c) { return c.parsed.y + ' W gemiddeld'; }, afterLabel: function(c) { var n = nights[c.dataIndex]; return num(n.kwh, 2) + ' kWh' + (n.cost != null ? ' · ' + eur(n.cost) : ''); } } } }, scales: { x: { ticks: { color: CHART_TICK, maxRotation: 45, font: { size: 11 } }, grid: { color: CHART_GRID } }, y: { ticks: { color: CHART_TICK, font: { size: 11 } }, grid: { color: CHART_GRID }, beginAtZero: true } } }
    });

    var partial = o.months.length && o.months[0].first_day.slice(8) !== '01';
    setEl('kost-monthly-note', partial ? '* gemeten vanaf ' + nlDate(o.months[0].first_day, {day:'numeric', month:'long'}) : '');
    if (chartCostsMonthly) chartCostsMonthly.destroy();
    chartCostsMonthly = new Chart(document.getElementById('chart-costs-monthly'), {
      type: 'bar',
      data: { labels: o.months.map(function(m, i) { return nlDate(m.month + '-01', {month:'short'}) + (i === 0 && partial ? '*' : ''); }), datasets: [
        { label: 'Stroom (€)', data: o.months.map(function(m) { return m.elec_cost != null ? m.elec_cost.toFixed(2) : 0; }), backgroundColor: 'rgba(141,178,85,0.55)', borderColor: '#8DB255', borderWidth: 1, borderRadius: 3, stack: 'cost' },
        { label: 'Gas (€)',    data: o.months.map(function(m) { return m.gas_cost != null ? m.gas_cost.toFixed(2) : 0; }),  backgroundColor: 'rgba(249,115,22,0.55)', borderColor: '#F97316', borderWidth: 1, borderRadius: 3, stack: 'cost' }
      ].filter(function(ds, i) { return i === 0 || moduleOn('gas'); })},
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: CHART_TEXT, boxWidth: 10, font: { size: 11 } } } }, scales: { x: { ticks: { color: CHART_TICK, font: { size: 11 } }, grid: { color: CHART_GRID }, stacked: true }, y: { ticks: { color: CHART_TICK, font: { size: 11 }, callback: function(v){ return '€'+v; } }, grid: { color: CHART_GRID }, beginAtZero: true, stacked: true } } }
    });
  }).catch(function(){});
}

// ── Gas cijfers ──
function refreshGasStats() {
  Promise.all([
    fetch('/api/day-comparison').then(function(r){return r.json();}),
    fetch('/api/costs').then(function(r){return r.json();}),
    fetch('/api/prices').then(function(r){return r.json();}).catch(function(){return {};})
  ]).then(function(res) {
    var c = res[0], costs = res[1], p = res[2];
    function m3(v) { return (v != null ? num(v, 2) : '—') + '<span class="stat-unit">m³</span>'; }
    setEl('gas-today', m3(c.today && c.today.gas_used));
    setEl('gas-yesterday', m3(c.yesterday && c.yesterday.gas_used));
    setEl('gas-today-cost', costs.day && costs.day.gas_cost != null ? eur(costs.day.gas_cost) : '—');
    setEl('gas-price-now', eur(p.gas_eur_m3) + '<span class="stat-unit">/m³</span>');
  }).catch(function(){});
}

// ── Gas monthly ──
var chartGasMonthly = null;
function loadGasMonthly() {
  fetch('/api/gas-monthly').then(function(r){return r.json();}).then(function(rows) {
    var partial = rows.length && rows[0].first_day && rows[0].first_day.slice(8) !== '01';
    var labels = rows.map(function(r, i){ return r.month + (i === 0 && partial ? '*' : ''); });
    var data   = rows.map(function(r){ return r.gas_used != null ? Number(r.gas_used).toFixed(2) : 0; });
    var noteEl = document.getElementById('gas-monthly-note');
    if (noteEl) noteEl.textContent = partial ? '* gemeten vanaf ' + new Date(rows[0].first_day + 'T12:00:00').toLocaleDateString('nl-NL', {day:'numeric', month:'long'}) : '';
    if (chartGasMonthly) chartGasMonthly.destroy();
    chartGasMonthly = new Chart(document.getElementById('chart-gas-monthly'), {
      type: 'bar',
      data: { labels: labels, datasets: [{ label: 'Gas (m³)', data: data, backgroundColor: 'rgba(249,115,22,0.55)', borderColor: '#F97316', borderWidth: 1, borderRadius: 4 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: CHART_TICK, font: { size: 11 } }, grid: { color: CHART_GRID } }, y: { ticks: { color: CHART_TICK, font: { size: 11 } }, grid: { color: CHART_GRID }, beginAtZero: true } } }
    });
  }).catch(function(){});
}

// ── Periodic refresh for non-active screens ──
setInterval(function() {
  if (currentScreen === 1) { var a = document.querySelector('[data-range].active'); if(a) loadChart(a.dataset.range, a); refreshComparison(); refreshSafety(); }
  if (currentScreen === 2) { refreshGasStats(); loadGasDaily(); }
  if (currentScreen === 4) { refreshVaatwasser(); refreshWasmachine(); refreshEsphome(); refreshTemperature(); var tb = document.querySelector('[data-temprange].active'); if (tb) loadTempChart(tb.dataset.temprange, tb); lampsRefresh(); }
  if (currentScreen === 5) { refreshSettingsNames(); }
}, 60000);
setInterval(function() {
  if (currentScreen === 1) { loadPeaks(); loadWeekdayChart(); loadPhaseChart(); var hb = document.querySelector('[data-hm].active'); loadHeatmap(hb ? hb.dataset.hm : 'alltime', hb || null); }
  if (currentScreen === 2) { loadGasMonthly(); }
  if (currentScreen === 3) { loadCostsDaily(); loadCostsOverview(); refreshCheapHours(); }
  if (currentScreen === 4) { loadWashWeekdayChart(); }
}, 300000);

// ── Chart ──
function accentGradient(c) {
  var area = c.chart.chartArea;
  if (!area) return 'rgba(141,178,85,0.1)';
  var g = c.chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
  g.addColorStop(0, 'rgba(141,178,85,0.35)');
  g.addColorStop(1, 'rgba(141,178,85,0)');
  return g;
}
var homeChart = null;
function loadHomeChart(btn) {
  var range = btn ? btn.dataset.homerange : 'day';
  document.querySelectorAll('[data-homerange]').forEach(function(t) { t.classList.toggle('active', t === btn || (!btn && t.dataset.homerange === 'day')); });
  fetch('/api/history?range=' + range).then(function(r) { return r.json(); }).then(function(rows) {
    var ctx = document.getElementById('blk-chart-elektra');
    if (!ctx) return;
    if (homeChart) homeChart.destroy();
    homeChart = new Chart(ctx, {
      type: 'line',
      data: { labels: rows.map(function(r) { return range === 'day' ? r.period.slice(11,16) : r.period; }), datasets: [
        { label: 'Verbruik (kW)', data: rows.map(function(r) { return r.del != null ? Number(r.del).toFixed(3) : null; }), borderColor: '#8DB255', backgroundColor: accentGradient, borderWidth: 2, tension: 0.3, pointRadius: 0, fill: true }
      ]},
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#3D4D6A', maxRotation: 0, autoSkip: true, maxTicksLimit: 6, font: { size: 9 } }, grid: { display: false } },
          y: { ticks: { color: '#3D4D6A', maxTicksLimit: 4, font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true }
        }
      }
    });
  }).catch(function() {});
}
var chart = null;
function loadChart(range, btn) {
  document.querySelectorAll('[data-range]').forEach(function(t) { t.classList.remove('active'); });
  if (btn) btn.classList.add('active');
  fetch('/api/history?range=' + range).then(function(r) { return r.json(); }).then(function(rows) {
    var labels = rows.map(function(r) { return r.period; });
    var del    = rows.map(function(r) { return r.del != null ? Number(r.del).toFixed(3) : null; });
    if (chart) chart.destroy();
    chart = new Chart(document.getElementById('chart'), {
      type: 'line',
      data: { labels: labels, datasets: [
        { label: 'Verbruik (kW)', data: del, borderColor: '#8DB255', backgroundColor: accentGradient, tension: 0.3, pointRadius: 2, fill: true }
      ]},
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: '#94A3B8', boxWidth: 12, font: { size: 10 } } } },
        scales: {
          x: { ticks: { color: '#3D4D6A', maxRotation: 45, font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
          y: { ticks: { color: '#3D4D6A', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true }
        }
      }
    });
  }).catch(function() {});
}

function eur(v) { return v != null ? '€' + Number(v).toFixed(2) : '—'; }
function num(v, d) { return v != null ? Number(v).toFixed(d != null ? d : 3) : '—'; }

// ── Costs ──
function refreshCosts() {
  fetch('/api/costs').then(function(r) { return r.json(); }).then(function(c) {
    var rows = [['Laatste uur','hour'],['Vandaag','day'],['7 dagen','week'],['30 dagen','month']];
    setEl('cost-rows', rows.map(function(r) {
      var d = c[r[1]];
      return '<tr><td>' + r[0] + '</td><td class="num">' + num(d.elec_kwh) + '</td><td class="num">' + eur(d.elec_cost) + '</td><td class="num" data-module="gas">' + num(d.gas_m3) + '</td><td class="num" data-module="gas">' + eur(d.gas_cost) + '</td></tr>';
    }).join(''));
    var day = c.day;
    if (day && (day.elec_cost != null || day.gas_cost != null)) {
      var total = (day.elec_cost || 0) + (day.gas_cost || 0);
      setEl('hero-cost-today', '€' + total.toFixed(2) + '<span class="card-unit">/dag</span>');
    }
  }).catch(function() {});
}
refreshCosts();
setInterval(refreshCosts, 60000);

// ── Prices ──
function refreshPrices() {
  fetch('/api/prices').then(function(r) { return r.json(); }).then(function(p) {
    if (p.electricity_eur_kwh != null)
      setEl('price-elec', Number(p.electricity_eur_kwh).toFixed(4) + '<span class="card-unit">€/kWh</span>');
    if (p.gas_eur_m3 != null)
      setEl('price-gas', Number(p.gas_eur_m3).toFixed(4) + '<span class="card-unit">€/m³</span>');
  }).catch(function() {});
}
refreshPrices();
setInterval(refreshPrices, 900000);

// ── Weather ──
// Lijn-iconen per weertype, in dezelfde stijl als de navigatie
var WEATHER_ICONS = {
  "sun": "<circle cx=\"12\" cy=\"12\" r=\"5\"/><path d=\"M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42\"/>",
  "cloud-sun": "<circle cx=\"7\" cy=\"7\" r=\"2.6\"/><path d=\"M7 1.4v1.4M1.4 7h1.4M3 3l1 1M11 3l-1 1\"/><g transform=\"translate(6.8 8.2) scale(.68)\"><path d=\"M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z\"/></g>",
  "cloud": "<path d=\"M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z\"/>",
  "smog": "<path d=\"M4 7h16M7 11h13M4 15h14M8 19h12\"/>",
  "cloud-rain": "<path d=\"M8 19v2M8 13v2M16 19v2M16 13v2M12 21v2M12 15v2M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25\"/>",
  "cloud-showers-heavy": "<path d=\"M16 13v8M8 13v8M12 15v8M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25\"/>",
  "snowflake": "<path d=\"M20 17.58A5 5 0 0 0 18 8h-1.26A8 8 0 1 0 4 16.25M8 16h.01M8 20h.01M12 18h.01M12 22h.01M16 16h.01M16 20h.01\"/>",
  "icicles": "<path d=\"M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25M8 14v3M12 15v5M16 14v3\"/>",
  "cloud-bolt": "<path d=\"M19 16.9A5 5 0 0 0 18 7h-1.26a8 8 0 1 0-11.62 9M13 11l-4 6h6l-4 6\"/>"
};
function weatherIconSvg(name) { return '<svg class="line-icon" viewBox="0 0 24 24" aria-hidden="true">' + (WEATHER_ICONS[name] || WEATHER_ICONS['cloud']) + '</svg>'; }
function refreshWeather() { fetch('/api/weather').then(function(r){return r.json();}).then(function(w) { if (!w || w.temp == null) return; setEl('weather-icon', weatherIconSvg(w.icon)); setEl('weather-desc', w.condition); var wCard = document.querySelector('.weather-card'); if (wCard) wCard.dataset.weather = w.icon; var wTemp = document.getElementById('weather-temp'); if (wTemp) wTemp.style.color = w.temp <= 0 ? '#BAE6FD' : w.temp < 10 ? '#7DD3FC' : w.temp < 18 ? '#F1F5F9' : w.temp < 25 ? '#FDE68A' : '#FDBA74'; setEl('weather-temp', Math.round(w.temp) + '°'); setEl('weather-feels', Math.round(w.feels_like) + '°C'); setEl('weather-precip', (w.precipitation_probability != null ? w.precipitation_probability : '—') + '%'); setEl('weather-humidity', w.humidity + '%'); setEl('weather-wind', Math.round(w.wind_speed) + ' km/h'); }).catch(function(){}); }
refreshWeather();
setInterval(refreshWeather, 900000);
function refreshHomeTemp() { fetch('/api/temperature/latest').then(function(r){return r.json();}).then(function(rows) { var vals = rows.map(function(r){ return r.temp_c; }).filter(function(v){ return v != null; }); if (!vals.length) return; var avg = vals.reduce(function(a,b){ return a+b; }, 0) / vals.length; setCard('home-temp', avg, 1, '°C'); }).catch(function(){}); }
refreshHomeTemp();
setInterval(refreshHomeTemp, 60000);

// ── Stats ──
function refreshStats() {
  fetch('/api/stats').then(function(r) { return r.json(); }).then(function(s) {
    if (!s || s.avg_del == null) return;
    setEl('stat-avg-del', num(s.avg_del, 3) + '<span class="stat-unit">kW</span>');
    setEl('stat-max-del', num(s.max_del, 3) + '<span class="stat-unit">kW</span>');
    var phases = [['L1', s.avg_l1], ['L2', s.avg_l2], ['L3', s.avg_l3]];
    var top = phases.filter(function(p) { return p[1] != null; }).sort(function(a,b) { return b[1]-a[1]; })[0];
    var topEl = document.getElementById('stat-top-phase'); if (topEl) topEl.textContent = top ? top[0] : '—';
    if (s.avg_v != null) {
      setEl('stat-voltage', num(s.avg_v,1) + '<span class="stat-unit">V · ' + num(s.min_v,1) + '–' + num(s.max_v,1) + '</span>');
    }
    var rd = s.total_readings != null ? s.total_readings : '—';
    var rdEl = document.getElementById('stat-readings'); if (rdEl) rdEl.textContent = rd;
    var h = new Date().getHours() + new Date().getMinutes()/60;
    setEl('saf-co2', num(s.avg_del * h * 0.4, 2) + '<span class="stat-unit">kg</span>');
  }).catch(function() {});
}
refreshStats();
setInterval(refreshStats, 30000);

// ── Peaks ──
var chartPeaks = null;
function loadPeaks() {
  fetch('/api/peaks').then(function(r) { return r.json(); }).then(function(rows) {
    var byHour = {};
    rows.forEach(function(r) { byHour[parseInt(r.hour,10)] = r; });
    var labels = [], delData = [], counts = [];
    for (var h = 0; h < 24; h++) {
      labels.push(h + ':00');
      var d = byHour[h];
      delData.push(d && d.avg_del != null ? Number(d.avg_del).toFixed(3) : 0);
      counts.push(d ? d.n : 0);
    }
    if (chartPeaks) chartPeaks.destroy();
    chartPeaks = new Chart(document.getElementById('chart-peaks'), {
      type: 'bar',
      data: { labels: labels, datasets: [
        { label: 'Gem. verbruik (kW)', data: delData, backgroundColor: 'rgba(141,178,85,0.55)', borderColor: '#8DB255', borderWidth: 1, borderRadius: 3 }
      ]},
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#94A3B8', boxWidth: 10, font: { size: 10 } } }, tooltip: { callbacks: { afterLabel: function(ctx) { return 'Metingen: ' + counts[ctx.dataIndex]; } } } },
        scales: { x: { ticks: { color: '#3D4D6A', maxRotation: 45, font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' } }, y: { ticks: { color: '#3D4D6A', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true } }
      }
    });
  }).catch(function() {});
}

// ── Phase chart ──
var chartPhases = null;
function loadPhaseChart() {
  fetch('/api/phase-stats').then(function(r) { return r.json(); }).then(function(s) {
    if (!s || s.avg_l1 == null) return;
    if (chartPhases) chartPhases.destroy();
    chartPhases = new Chart(document.getElementById('chart-phases'), {
      type: 'bar',
      data: { labels: ['L1','L2','L3'], datasets: [
        { label: 'Gemiddeld (kW)', data: [s.avg_l1,s.avg_l2,s.avg_l3].map(function(v){return v!=null?Number(v).toFixed(3):0;}), backgroundColor: ['rgba(141,178,85,0.6)','rgba(56,189,248,0.6)','rgba(251,146,60,0.6)'], borderColor: ['#8DB255','#38BDF8','#F97316'], borderWidth: 1, borderRadius: 4 },
        { label: 'Piek (kW)', data: [s.max_l1,s.max_l2,s.max_l3].map(function(v){return v!=null?Number(v).toFixed(3):0;}), backgroundColor: ['rgba(141,178,85,0.2)','rgba(56,189,248,0.2)','rgba(251,146,60,0.2)'], borderColor: ['#8DB255','#38BDF8','#F97316'], borderWidth: 1, borderRadius: 4 }
      ]},
      options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { labels: { color: '#94A3B8', boxWidth: 10, font: { size: 10 } } } }, scales: { x: { ticks: { color: '#3D4D6A', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true }, y: { ticks: { color: '#94A3B8', font: { size: 11, weight: '600' } }, grid: { color: 'rgba(255,255,255,0.04)' } } } }
    });
  }).catch(function() {});
}

// ── Gas daily ──
var chartGas = null;
function loadGasDaily() {
  fetch('/api/gas-daily').then(function(r) { return r.json(); }).then(function(rows) {
    var labels = rows.map(function(r) { return r.day.slice(5); });
    var data   = rows.map(function(r) { return r.gas_used != null ? Number(r.gas_used).toFixed(3) : 0; });
    if (chartGas) chartGas.destroy();
    chartGas = new Chart(document.getElementById('chart-gas'), {
      type: 'bar',
      data: { labels: labels, datasets: [{ label: 'Gas (m³)', data: data, backgroundColor: 'rgba(249,115,22,0.55)', borderColor: '#F97316', borderWidth: 1, borderRadius: 3 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#94A3B8', boxWidth: 10, font: { size: 10 } } } }, scales: { x: { ticks: { color: '#3D4D6A', maxRotation: 45, font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' } }, y: { ticks: { color: '#3D4D6A', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true } } }
    });
  }).catch(function() {});
}

// ── Day comparison ──
function refreshComparison() {
  fetch('/api/day-comparison').then(function(r){return r.json();}).then(function(c) {
    var t = c.today, y = c.yesterday, w = c.lastweek;
    function kwh(v) { return v != null ? num(v,2)+' kWh' : '—'; }
    function m3(v)  { return v != null ? num(v,3)+' m³' : '—'; }
    function delta(now, ref) {
      if (now == null || ref == null || ref === 0) return '';
      var pct = ((now - ref) / ref * 100);
      var cls = pct > 5 ? 'delta-up' : pct < -5 ? 'delta-down' : 'delta-same';
      return '<span class="'+cls+'">'+(pct>0?'+':'')+pct.toFixed(0)+'%</span>';
    }
    setEl('cmp-today-elec', kwh(t && t.elec_kwh) + delta(t && t.elec_kwh, y && y.elec_kwh_sofar));
    setEl('cmp-today-gas',  m3(t && t.gas_used)  + delta(t && t.gas_used,  y && y.gas_used_sofar));
    setEl('cmp-yest-elec',  kwh(y && y.elec_kwh));
    setEl('cmp-yest-gas',   m3(y && y.gas_used));
    setEl('cmp-week-elec',  kwh(w && w.elec_kwh));
    setEl('cmp-week-gas',   m3(w && w.gas_used));
    if (t && t.elec_kwh != null) {
      var h = new Date().getHours() + new Date().getMinutes()/60;
      if (h > 0) setEl('cmp-today-exp', '~' + num(t.elec_kwh/h*24,2) + ' kWh/dag');
    }
  }).catch(function(){});
}

// ── Safety ──
function refreshSafety() {
  fetch('/api/voltage-dips').then(function(r){return r.json();}).then(function(s) {
    if (!s) return;
    var dipsEl = document.getElementById('saf-dips');
    var vdTotal = (s.dips || 0) + (s.peaks || 0);
    if (dipsEl) { dipsEl.innerHTML = vdTotal + (vdTotal ? '<span class="stat-unit"> ' + (s.dips || 0) + ' te laag · ' + (s.peaks || 0) + ' te hoog</span>' : ''); dipsEl.style.color = vdTotal > 0 ? '#F87171' : '#4ADE80'; }
    if (s.max_a1 != null) setEl('saf-max-amp', num(s.max_a1,0)+'A / '+num(s.max_a2,0)+'A / '+num(s.max_a3,0)+'A<span class="stat-unit"> max</span>');
  }).catch(function(){});
  fetch('/api/night-usage').then(function(r){return r.json();}).then(function(s) {
    if (!s) return;
    if (s.night_avg != null) setEl('saf-night', num(s.night_avg,3)+'<span class="stat-unit">kW</span>');
  }).catch(function(){});
}


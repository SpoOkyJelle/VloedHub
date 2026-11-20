// ── Animaties ──
// Verplaatst een blok door een wijziging, dan schuift het vanaf zijn oude plek naar de nieuwe.
var noMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
var EASE = 'cubic-bezier(0.4,0,0.2,1)';
function flipAnimate(els, change) {
  if (noMotion || !document.body.animate) { change(); return; }
  var before = els.map(function(el) { return el.getBoundingClientRect(); });
  change();
  els.forEach(function(el, n) {
    if (!el.isConnected || !before[n].width) return;
    var after = el.getBoundingClientRect();
    if (!after.width) return;
    var dx = before[n].left - after.left, dy = before[n].top - after.top;
    if (!dx && !dy) return;
    el.animate([{ transform: 'translate(' + dx + 'px,' + dy + 'px)' }, { transform: 'none' }], { duration: 280, easing: EASE });
  });
}
function homeBlocks() { return Array.prototype.slice.call(document.querySelectorAll('#screen-0 > *')); }
// Het uitklappaneel van een lamp bestaat maar één keer. Op Home lenen we het van de Thuis-pagina:
// het komt als eigen rij onder de rij van de lampkaart en gaat bij inklappen weer terug.
var ledPanelOrigin = {};
// Het paneel hangt als één geheel onder zijn lampkaart. Staat die kaart helemaal links of rechts, dan loopt de rand
// daar recht door in plaats van met een ronde hoek.
function joinLedPanel(panel, card) {
  if (!card) return;
  var p = panel.getBoundingClientRect(), c = card.getBoundingClientRect();
  // waar de kaart op het paneel staat: daar laat het paneel zijn bovenrand weg
  panel.style.setProperty('--tab-left', (c.left - p.left) + 'px');
  panel.style.setProperty('--tab-width', c.width + 'px');
  panel.classList.toggle('join-left', Math.abs(c.left - p.left) < 2);
  panel.classList.toggle('join-right', Math.abs(c.right - p.right) < 2);
}
function openLedPanelCard(panel) {
  var holder = panel._homeBlock || (panel.style.display !== 'none' ? panel.previousElementSibling : null);
  return holder && holder.classList.contains('open') ? holder.querySelector('.lamp-card, .home-lamp') : null;
}
window.addEventListener('resize', function() {
  Array.prototype.forEach.call(document.querySelectorAll('.lamp-panel'), function(panel) { joinLedPanel(panel, openLedPanelCard(panel)); });
});
// De sluitknop in het paneel doet hetzelfde als nog eens op "Aanpassen" tikken, op Home of op Thuis
function closeLedPanel(id) {
  var panel = document.getElementById('led-panel-' + id);
  if (!panel) return;
  if (panel._homeBlock) toggleHomeLedPanel(id, panel._homeBlock.querySelector('.lamp-more'));
  else if (panel.style.display !== 'none') toggleLedPanel(id, panel.previousElementSibling.querySelector('.lamp-more'));
}
// Er staat er maar één open: een andere lamp aanpassen klapt de vorige dicht, anders schuiven de panelen over elkaar
function closeOtherLedPanels(keep) {
  Array.prototype.forEach.call(document.querySelectorAll('.lamp-panel'), function(panel) {
    if (panel === keep || panel.style.display === 'none') return;
    if (panel._homeBlock) { returnLedPanel(panel); return; }
    panel.style.display = 'none';
    var blk = panel.previousElementSibling, more = blk && blk.querySelector('.lamp-more');
    if (blk) blk.classList.remove('open');
    if (more) more.setAttribute('aria-expanded', 'false');
  });
}
function returnLedPanel(panel) {
  var card = panel._homeBlock;
  if (card) { card.classList.remove('open'); var arrow = card.querySelector('.lamp-more'); if (arrow) arrow.setAttribute('aria-expanded', 'false'); }
  panel.style.display = 'none';
  panel.classList.remove('home-open');
  panel._homeBlock = null;
  var origin = ledPanelOrigin[panel.id];
  if (origin) origin.parentNode.insertBefore(panel, origin.nextSibling);
}
function closeHomeLedPanels() {
  Array.prototype.slice.call(document.querySelectorAll('#screen-0 > .lamp-panel')).forEach(returnLedPanel);
}
function toggleHomeLedPanel(id, btn) {
  var panel = document.getElementById('led-panel-' + id);
  var block = btn.closest('.layout-block');
  if (!panel || !block) return;
  var open = panel._homeBlock === block;
  if (open) {
    if (noMotion || !panel.animate) { returnLedPanel(panel); return; }
    panel.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: 'ease-out' }).onfinish = function() {
      flipAnimate(homeBlocks(), function() { returnLedPanel(panel); });
    };
    return;
  }
  if (!ledPanelOrigin[panel.id]) ledPanelOrigin[panel.id] = panel.previousElementSibling;
  // stond het nog open op de Thuis-pagina, zet die dan terug
  var origin = ledPanelOrigin[panel.id];
  origin.classList.remove('open');
  var thuisArrow = origin.querySelector('button[onclick^="toggleLedPanel"]');
  if (thuisArrow) thuisArrow.setAttribute('aria-expanded', 'false');
  ledRender(id);
  // laatste blok in dezelfde rij: daarachter komt het paneel, zodat de rij zelf blijft staan
  var last = block;
  for (var sib = block.nextElementSibling; sib; sib = sib.nextElementSibling) {
    if (!sib.classList.contains('layout-block') || sib.style.display === 'none') continue;
    if (Math.abs(sib.offsetTop - block.offsetTop) > 2) break;
    last = sib;
  }
  flipAnimate(homeBlocks(), function() {
    closeOtherLedPanels(panel);
    last.parentNode.insertBefore(panel, last.nextSibling);
    panel.classList.add('home-open');
    panel.style.display = 'block';
    panel._homeBlock = block;
    block.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');
    joinLedPanel(panel, block.querySelector('.home-lamp'));
  });
  if (!noMotion && panel.animate) panel.animate([{ opacity: 0, clipPath: 'inset(0 0 100% 0)' }, { opacity: 1, clipPath: 'inset(0 0 0 0)' }], { duration: 280, easing: EASE });
}
function toggleLedPanel(id, btn) {
  var panel = document.getElementById('led-panel-' + id);
  var open = panel.style.display !== 'none';
  var blk = panel.previousElementSibling;
  // de lampen blijven staan; het paneel komt als eigen rij eronder en de rest schuift mee
  var els = [];
  if (blk) {
    els = Array.prototype.slice.call(blk.parentNode.children);
    for (var sib = blk.parentNode.nextElementSibling; sib; sib = sib.nextElementSibling) els.push(sib);
  }
  function apply() {
    if (!open) closeOtherLedPanels(panel);
    panel.style.display = open ? 'none' : 'block';
    btn.setAttribute('aria-expanded', !open);
    if (blk) blk.classList.toggle('open', !open);
    if (blk && !open) joinLedPanel(panel, blk.querySelector('.lamp-card'));
  }
  if (noMotion || !panel.animate) { apply(); return; }
  if (open) {
    panel.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: 'ease-out' }).onfinish = function() { flipAnimate(els, apply); };
  } else {
    flipAnimate(els, apply);
    panel.animate([{ opacity: 0, clipPath: 'inset(0 0 100% 0)' }, { opacity: 1, clipPath: 'inset(0 0 0 0)' }], { duration: 280, easing: EASE });
  }
}
function deviceRename(key, defaultName, iconEl) { inlineRename(iconEl.previousElementSibling, function(name) { saveDeviceName(key, name); }); }
function esphomeRename(deviceEnc, sensorEnc, iconEl) {
  var card = iconEl.closest ? iconEl.closest('.sensor-card') : null;
  var span = card ? card.querySelector('.sensor-name-text') : iconEl.previousElementSibling;
  inlineRename(span, function(name) { saveEsphomeName(decodeURIComponent(deviceEnc), decodeURIComponent(sensorEnc), name); });
}
function shortWhen(v) {
  var d = new Date(v);
  if (isNaN(d.getTime())) return '—';
  var time = d.toLocaleTimeString('nl-NL', {hour:'2-digit', minute:'2-digit', hour12:false});
  return d.toDateString() === new Date().toDateString() ? time : d.toLocaleDateString('nl-NL', {day:'numeric', month:'short'}) + ' ' + time;
}
// ── Uniform sensor-kaart component ──────────────────────────────────────────
// Eén kaart-opbouw voor ALLE losse sensoren (klimaat/ESP32, ESPHome, Tapo badkamer, tado). Elke kaart
// toont huidige waarde(n) + een statusbadge (douchen/verwarmen/leeftijd) en is uitklapbaar naar een
// eigen grafiek met tijd-tabs (Uur/Dag/Week/Maand). De grafiek wordt pas getekend bij openen.
var SENSOR_CFG = {};     // sid -> grafiekconfig {url, key, val, series:[{field,unit,color,decimals,label,axis}]}
var SENSOR_OPEN = {};    // sid -> actieve range van een uitgeklapte kaart
var SENSOR_CHARTS = {};  // sid -> Chart-instantie
var SENSOR_DEFAULT = {}; // sid -> standaard-range (eerste 'day', anders eerste tab)
var SENSOR_RANGES_ALL = [['hour', 'Uur'], ['day', 'Dag'], ['week', 'Week'], ['month', 'Maand']];

function sensorSlug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'x'; }
function sensorAge(ts) {
  if (ts == null) return '';
  var t = typeof ts === 'number' ? ts : new Date(ts).getTime();
  var age = Math.round((Date.now() - t) / 60000);
  return isNaN(age) ? '' : age < 1 ? 'zojuist' : age < 60 ? age + ' min geleden' : Math.round(age / 60) + ' uur geleden';
}
function sensorPeriodLabel(p, range) {
  p = String(p);
  if (range === 'hour' || range === 'day') return p.slice(11, 16);
  return p.slice(8, 10) + '-' + p.slice(5, 7);
}
function sensorCard(cfg) {
  var sid = cfg.id;
  if (cfg.chart) SENSOR_CFG[sid] = cfg.chart; else delete SENSOR_CFG[sid];
  var status = '';
  if (cfg.badge) status = '<span class="wash-status-pill sensor-badge ' + (cfg.badge.cls || '') + '">' + (cfg.badge.icon ? '<i class="fa-solid ' + cfg.badge.icon + '"></i> ' : '') + escHtml(cfg.badge.text) + '</span>';
  else if (cfg.meta) status = '<span class="sensor-meta">' + escHtml(cfg.meta) + '</span>';
  var expand = cfg.chart ? '<button class="sensor-expand" aria-label="Grafiek tonen" onclick="toggleSensorCard(\'' + sid + '\')"><i class="fa-solid fa-chevron-down" id="scv-' + sid + '"></i></button>' : '';
  var sub = cfg.sub ? '<small class="sensor-sub">' + escHtml(cfg.sub) + '</small>' : '';
  var values = (cfg.values || []).map(function(v) { return '<span class="sensor-value">' + v + '</span>'; }).join('<span class="sensor-sep">·</span>');
  var chartBlock = '';
  if (cfg.chart) {
    var ranges = cfg.ranges || SENSOR_RANGES_ALL;
    var defRange = null;
    ranges.forEach(function(r) { if (r[0] === 'day') defRange = 'day'; });
    if (!defRange) defRange = ranges[0][0];
    SENSOR_DEFAULT[sid] = defRange;
    chartBlock = '<div class="sensor-collapse" id="scol-' + sid + '"><div>' +
      '<div class="tab-bar sensor-ranges">' + ranges.map(function(r) { return '<button class="tab' + (r[0] === defRange ? ' active' : '') + '" data-r="' + r[0] + '" onclick="sensorRange(\'' + sid + '\',\'' + r[0] + '\',this)">' + r[1] + '</button>'; }).join('') + '</div>' +
      '<div class="chart-wrap h-150"><canvas id="sc-' + sid + '"></canvas></div>' +
      '</div></div>';
  }
  return '<div class="esp-card sensor-card" id="scard-' + sid + '">' +
    '<div class="sensor-head"><i class="fa-solid ' + cfg.icon + '"></i>' +
    '<span class="sensor-name"><span class="sensor-name-text">' + escHtml(cfg.name) + '</span>' + sub + '</span>' +
    '<span class="sensor-status">' + status + '</span>' + (cfg.headExtra || '') + expand + '</div>' +
    '<div class="sensor-values">' + values + '</div>' + (cfg.controls || '') + chartBlock + '</div>';
}
function toggleSensorCard(sid) {
  var col = document.getElementById('scol-' + sid); if (!col) return;
  var open = col.classList.toggle('open');
  var chev = document.getElementById('scv-' + sid); if (chev) chev.style.transform = open ? 'rotate(180deg)' : '';
  if (open) { if (!SENSOR_OPEN[sid]) SENSOR_OPEN[sid] = SENSOR_DEFAULT[sid] || 'day'; drawSensorChart(sid, SENSOR_OPEN[sid]); }
  else { delete SENSOR_OPEN[sid]; if (SENSOR_CHARTS[sid]) { SENSOR_CHARTS[sid].destroy(); delete SENSOR_CHARTS[sid]; } }
}
function sensorRange(sid, range, btn) {
  if (btn && btn.parentNode) { btn.parentNode.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); }); btn.classList.add('active'); }
  SENSOR_OPEN[sid] = range;
  drawSensorChart(sid, range);
}
function drawSensorChart(sid, range) {
  var cfg = SENSOR_CFG[sid]; if (!cfg) return;
  var canvas = document.getElementById('sc-' + sid); if (!canvas) return;
  fetch(cfg.url + (cfg.url.indexOf('?') !== -1 ? '&' : '?') + 'range=' + range).then(function(r) { return r.json(); }).then(function(rows) {
    var mine = cfg.key ? (rows || []).filter(function(r) { return String(r[cfg.key]) === String(cfg.val); }) : (rows || []);
    var periods = []; mine.forEach(function(r) { if (periods.indexOf(r.period) === -1) periods.push(r.period); });
    periods.sort();
    var twoAxis = cfg.series.length > 1;
    var datasets = cfg.series.map(function(s) {
      var byP = {}; mine.forEach(function(r) { if (r[s.field] != null) byP[r.period] = r[s.field]; });
      var dec = s.decimals != null ? s.decimals : 1;
      return { label: s.label, data: periods.map(function(p) { var v = byP[p]; return v != null ? Number(Number(v).toFixed(dec)) : null; }), borderColor: s.color, backgroundColor: s.color + '33', borderWidth: 2, tension: 0.3, pointRadius: 0, fill: false, spanGaps: true, yAxisID: s.axis || 'y' };
    });
    var labels = periods.map(function(p) { return sensorPeriodLabel(p, range); });
    if (SENSOR_CHARTS[sid]) SENSOR_CHARTS[sid].destroy();
    var scales = {
      x: { ticks: { color: CHART_TICK, maxRotation: 0, autoSkip: true, maxTicksLimit: 7, font: { size: 10 } }, grid: { display: false } },
      y: { position: 'left', ticks: { color: CHART_TICK, font: { size: 10 }, callback: function(v) { return v + ' ' + (cfg.series[0].unit || ''); } }, grid: { color: CHART_GRID } }
    };
    if (twoAxis) scales.y1 = { position: 'right', ticks: { color: CHART_TICK, font: { size: 10 }, callback: function(v) { return v + ' ' + (cfg.series[1].unit || ''); } }, grid: { display: false } };
    SENSOR_CHARTS[sid] = new Chart(canvas, {
      type: 'line', data: { labels: labels, datasets: datasets },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: twoAxis, labels: { color: CHART_TEXT, boxWidth: 10, font: { size: 10 } } }, tooltip: { callbacks: { label: function(c) { var s = cfg.series[c.datasetIndex]; return c.dataset.label + ': ' + c.parsed.y + ' ' + (s ? s.unit : ''); } } } },
        scales: scales
      }
    });
  }).catch(function() {});
}
// Vervangt de inhoud van een grid alleen als er wezenlijk iets veranderde (op basis van cfg.sig), zodat
// een uitgeklapte grafiek niet elke refresh (3s) wegklapt. Herstelt open kaarten na een herbouw.
function paintSensorGrid(grid, cards) {
  if (!grid) return;
  if (!cards.length) { grid._sig = '__empty__'; if (grid.innerHTML.indexOf('sensor-card') !== -1 || !grid.innerHTML) grid.innerHTML = '<div class="esp-card"><div class="esp-head">Nog geen data</div></div>'; return; }
  var sig = cards.map(function(c) { return c.id + '=' + (c.sig != null ? c.sig : (c.values || []).join(',') + '|' + (c.badge ? c.badge.text : '')); }).join(';');
  if (grid._sig === sig) return;
  grid._sig = sig;
  grid.innerHTML = cards.map(sensorCard).join('');
  cards.forEach(function(c) {
    if (!c.chart || !SENSOR_OPEN[c.id]) return;
    var col = document.getElementById('scol-' + c.id); if (!col) return;
    col.classList.add('open');
    var chev = document.getElementById('scv-' + c.id); if (chev) chev.style.transform = 'rotate(180deg)';
    var bar = col.querySelector('.sensor-ranges');
    if (bar) { bar.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); }); var a = bar.querySelector('[data-r="' + SENSOR_OPEN[c.id] + '"]'); if (a) a.classList.add('active'); }
    drawSensorChart(c.id, SENSOR_OPEN[c.id]);
  });
}
// Bouwt een kaart-config uit één temperature_readings-rij (klimaatsensor). extra = {badge, icon}.
function climateCardCfg(r, icon, extra) {
  var values = [(r.temp_c != null ? nlNum(r.temp_c, 1) + ' °C' : '—')];
  if (r.humidity != null) values.push(r.humidity + ' %');
  var series = [{ field: 'avg_temp', unit: '°C', color: '#38BDF8', decimals: 1, label: 'Temp', axis: 'y' }];
  if (r.humidity != null) series.push({ field: 'avg_humidity', unit: '%', color: '#2DD4BF', decimals: 0, label: 'Vocht', axis: 'y1' });
  var cfg = {
    id: 'clim-' + sensorSlug(r.room), icon: icon || 'fa-temperature-half', name: r.room, values: values,
    meta: sensorAge(r.received_at),
    chart: { url: '/api/temperature/history', key: 'room', val: r.room, series: series }
  };
  if (extra && extra.icon) cfg.icon = extra.icon;
  if (extra && extra.badge) { cfg.badge = extra.badge; cfg.meta = null; }
  cfg.sig = values.join(',') + '|' + (cfg.badge ? cfg.badge.text : '');
  return cfg;
}

function refreshTemperature() { fetch('/api/temperature/latest').then(function(r){return r.json();}).then(function(rows) {
  var grid = document.getElementById('temp-grid');
  if (!grid) return;
  // Alleen de ESP32-klimaatsensoren hier; tado en Tapo krijgen hun eigen sectie (anders dubbel).
  var cards = (rows || []).filter(function(r) { return r.device !== 'tado' && r.device !== 'tapo-t310'; })
    .map(function(r) { return climateCardCfg(r, 'fa-temperature-half'); });
  paintSensorGrid(grid, cards);
}).catch(function(){}); }
// (De gedeelde temp/vocht-grafieken zijn vervangen door een eigen uitklapbare grafiek per sensorkaart,
//  zie het "Uniform sensor-kaart component" hierboven en drawSensorChart.)
var chartWashPower = null;
function loadWashPowerChart(range, btn) {
  if (!document.getElementById('chart-wash-power')) return;
  document.querySelectorAll('[data-washpowerrange]').forEach(function(t){ t.classList.remove('active'); });
  if (btn) btn.classList.add('active');
  fetch('/api/tapo/power-history?range=' + range).then(function(r){return r.json();}).then(function(rows) {
    var labels = rows.map(function(r) {
      var p = r.period || '';
      return range === 'day' ? p.slice(11, 16) : range === 'week' ? (p.slice(8, 10) + '/' + p.slice(5, 7) + ' ' + p.slice(11, 13) + 'u') : (p.slice(8, 10) + '-' + p.slice(5, 7));
    });
    var data = rows.map(function(r){ return r.watts != null ? Number(r.watts).toFixed(1) : null; });
    if (chartWashPower) chartWashPower.destroy();
    chartWashPower = new Chart(document.getElementById('chart-wash-power'), {
      type: 'line',
      data: { labels: labels, datasets: [{ label: 'Vermogen (W)', data: data, borderColor: '#8DB255', backgroundColor: '#8DB25533', borderWidth: 2, tension: 0.2, pointRadius: 0, fill: true }] },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: CHART_TICK, maxRotation: 0, autoSkip: true, maxTicksLimit: 7, font: { size: 11 } }, grid: { display: false } }, y: { beginAtZero: true, ticks: { color: CHART_TICK, font: { size: 11 }, callback: function(v){ return v + ' W'; } }, grid: { color: CHART_GRID } } } }
    });
  }).catch(function(){});
}
function refreshTapoCard() {
  var grid = document.getElementById('tapo-grid');
  if (!grid && !document.getElementById('wash-power')) return;
  fetch('/api/tapo').then(function(r){return r.json();}).then(function(d) {
    var el;
    if ((el = document.getElementById('wash-power'))) el.textContent = d.plug && d.plug.watts != null ? nlNum(d.plug.watts, 1) + ' W' : '—';
    if (!grid) return;
    if (!d.linked) { grid._sig = 'nolink'; grid.innerHTML = '<div class="esp-card"><div class="esp-head">Niet gekoppeld — koppel bij Instellingen</div></div>'; return; }
    var t = d.t310 || null;
    var showering = !!d.showerActive;
    var room = d.roomName || 'Badkamer';
    var r = { room: room, temp_c: t ? t.temp : null, humidity: t ? t.humidity : null, received_at: d.updated || null };
    var badge = !t ? { cls: 'off', icon: 'fa-plug-circle-xmark', text: 'Geen data' }
      : showering ? { cls: 'cool', icon: 'fa-shower', text: 'Doucht' }
      : { cls: 'idle', icon: 'fa-droplet', text: 'Rustig' };
    var cfg = climateCardCfg(r, 'fa-shower', { badge: badge });
    cfg.id = 'tapo-' + sensorSlug(room);
    cfg.sig = cfg.values.join(',') + '|' + badge.text;
    paintSensorGrid(grid, [cfg]);
  }).catch(function(){});
}
function refreshWashStatus() { fetch('/api/wasmachine/status').then(function(r){return r.json();}).then(function(s) { var pill = document.getElementById('wash-status-pill'); var icon = document.getElementById('wash-status-icon'); var text = document.getElementById('wash-status-text'); if (!pill) return; var state = s.state || 'idle'; pill.className = 'wash-status-pill ' + state; var since = s.since ? shortWhen(s.since) : null; if (state === 'running') { icon.className = 'fa-solid fa-rotate'; text.textContent = 'In gebruik' + (since ? ' sinds ' + since : ''); } else if (state === 'done') { icon.className = 'fa-solid fa-circle-check'; text.textContent = 'Klaar, nog leeghalen' + (since ? ' (' + since + ')' : ''); } else { icon.className = 'fa-solid fa-moon'; text.textContent = 'Inactief'; } }).catch(function(){}); }


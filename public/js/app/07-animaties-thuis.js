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
var LED_PANEL_SETUP = {
  'default': function() { buildLedGrid(); updateLedUI(); },
  'keuken':  function() { buildLed2Grid(); updateLed2UI(); },
  'gang':    function() { buildLed3Grid(); updateLed3UI(); }
};
function returnLedPanel(panel) {
  var card = panel._homeBlock;
  if (card) { card.classList.remove('open'); var arrow = card.querySelector('.home-lamp-arrow'); if (arrow) arrow.textContent = '▾'; }
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
  if (thuisArrow) thuisArrow.textContent = '▾';
  if (LED_PANEL_SETUP[id]) LED_PANEL_SETUP[id]();
  // laatste blok in dezelfde rij: daarachter komt het paneel, zodat de rij zelf blijft staan
  var last = block;
  for (var sib = block.nextElementSibling; sib; sib = sib.nextElementSibling) {
    if (!sib.classList.contains('layout-block') || sib.style.display === 'none') continue;
    if (Math.abs(sib.offsetTop - block.offsetTop) > 2) break;
    last = sib;
  }
  flipAnimate(homeBlocks(), function() {
    last.parentNode.insertBefore(panel, last.nextSibling);
    panel.classList.add('home-open');
    panel.style.display = 'block';
    panel._homeBlock = block;
    block.classList.add('open');
    btn.textContent = '▴';
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
    panel.style.display = open ? 'none' : 'block';
    btn.textContent = open ? '▾' : '▴';
    if (blk) blk.classList.toggle('open', !open);
  }
  if (noMotion || !panel.animate) { apply(); return; }
  if (open) {
    panel.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: 'ease-out' }).onfinish = function() { flipAnimate(els, apply); };
  } else {
    flipAnimate(els, apply);
    panel.animate([{ opacity: 0, clipPath: 'inset(0 0 100% 0)' }, { opacity: 1, clipPath: 'inset(0 0 0 0)' }], { duration: 280, easing: EASE });
  }
}
function deviceRename(key, defaultName, iconEl) { var spanEl = iconEl.previousElementSibling; var current = deviceNamesCache[key] || defaultName; var input = document.createElement('input'); input.value = current; input.style.cssText = 'font-size:0.85rem;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:6px;color:inherit;padding:0.1rem 0.4rem;width:10rem;font-family:inherit;font-weight:700'; spanEl.replaceWith(input); input.focus(); input.select(); function commit() { var val = input.value.trim(); fetch('/api/device-names', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({key:key, name:val}) }).then(function(){ loadDeviceNames(); }); } input.addEventListener('keydown', function(e){ if (e.key==='Enter') { input.blur(); } if (e.key==='Escape') loadDeviceNames(); }); input.addEventListener('blur', commit); }
loadDeviceNames();
loadLayout();
function esphomeRename(deviceEnc, sensorEnc, iconEl) { var device = decodeURIComponent(deviceEnc); var sensor = decodeURIComponent(sensorEnc); var nameEl = iconEl.parentElement; var current = nameEl.childNodes[0].textContent.trim(); var input = document.createElement('input'); input.value = current; input.style.cssText = 'font-size:0.75rem;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:6px;color:inherit;padding:0.1rem 0.3rem;width:8rem;font-family:inherit'; nameEl.replaceWith(input); input.focus(); input.select(); function commit() { var val = input.value.trim(); fetch('/api/esphome/rename', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({device:device, sensor_name:sensor, display_name:val}) }).then(function(){ refreshEsphome(); }); } input.addEventListener('keydown', function(e) { if (e.key === 'Enter') commit(); if (e.key === 'Escape') refreshEsphome(); }); input.addEventListener('blur', commit); }
function shortWhen(v) {
  var d = new Date(v);
  if (isNaN(d.getTime())) return '—';
  var time = d.toLocaleTimeString('nl-NL', {hour:'2-digit', minute:'2-digit', hour12:false});
  return d.toDateString() === new Date().toDateString() ? time : d.toLocaleDateString('nl-NL', {day:'numeric', month:'short'}) + ' ' + time;
}
function refreshTemperature() { fetch('/api/temperature/latest').then(function(r){return r.json();}).then(function(rows) {
  var grid = document.getElementById('temp-grid');
  if (!grid) return;
  if (!rows.length) { grid.innerHTML = '<div class="esp-card"><div class="esp-head">Nog geen data</div></div>'; return; }
  grid.innerHTML = '<div class="esp-card">' + rows.map(function(r) {
    var age = Math.round((Date.now() - new Date(r.received_at).getTime()) / 60000);
    var ageText = isNaN(age) ? '' : age < 60 ? age + ' min geleden' : Math.round(age/60) + ' uur geleden';
    return '<div class="esp-row"><span class="esp-name"><span class="esp-room">' + r.room + '</span><span class="esp-sub">' + ageText + '</span></span>' +
      '<span class="esp-val">' + (r.temp_c != null ? nlNum(r.temp_c, 1) : '—') + ' °C</span></div>';
  }).join('') + '</div>';
}).catch(function(){}); }
var chartTemp = null;
function loadTempChart(range, btn) { document.querySelectorAll('[data-temprange]').forEach(function(t) { t.classList.remove('active'); }); if (btn) btn.classList.add('active'); fetch('/api/temperature/history?range=' + range).then(function(r){return r.json();}).then(function(rows) { var periods = []; var byRoom = {}; rows.forEach(function(r) { if (periods.indexOf(r.period) === -1) periods.push(r.period); if (!byRoom[r.room]) byRoom[r.room] = {}; byRoom[r.room][r.period] = r.avg_temp; }); periods.sort(); var palette = ['#8DB255','#38BDF8','#F97316','#22C55E','#FBBF24','#F87171']; var rooms = Object.keys(byRoom); var datasets = rooms.map(function(room, i) { var color = palette[i % palette.length]; return { label: room, data: periods.map(function(p) { var v = byRoom[room][p]; return v != null ? Number(v).toFixed(1) : null; }), borderColor: color, backgroundColor: color + '33', borderWidth: 2, tension: 0.3, pointRadius: 0, fill: false }; }); if (chartTemp) chartTemp.destroy(); chartTemp = new Chart(document.getElementById('chart-temp'), { type: 'line', data: { labels: periods.map(function(p) { return range === 'day' ? p.slice(11, 16) : p.slice(8, 10) + '-' + p.slice(5, 7); }), datasets: datasets }, options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { labels: { color: '#94A3B8', boxWidth: 12, font: { size: 10 } } } }, scales: { x: { ticks: { color: '#3D4D6A', maxRotation: 0, autoSkip: true, maxTicksLimit: 7, font: { size: 9 } }, grid: { display: false } }, y: { ticks: { color: '#3D4D6A', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' } } } } }); }).catch(function(){}); }
function refreshWashStatus() { fetch('/api/wasmachine/status').then(function(r){return r.json();}).then(function(s) { var pill = document.getElementById('wash-status-pill'); var icon = document.getElementById('wash-status-icon'); var text = document.getElementById('wash-status-text'); if (!pill) return; var state = s.state || 'idle'; pill.className = 'wash-status-pill ' + state; var since = s.since ? shortWhen(s.since) : null; if (state === 'running') { icon.className = 'fa-solid fa-rotate'; text.textContent = 'In gebruik' + (since ? ' sinds ' + since : ''); } else if (state === 'done') { icon.className = 'fa-solid fa-circle-check'; text.textContent = 'Klaar, nog leeghalen' + (since ? ' (' + since + ')' : ''); } else { icon.className = 'fa-solid fa-moon'; text.textContent = 'Inactief'; } }).catch(function(){}); }


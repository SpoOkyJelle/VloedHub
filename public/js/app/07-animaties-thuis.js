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
function esphomeRename(deviceEnc, sensorEnc, iconEl) { inlineRename(iconEl.previousElementSibling, function(name) { saveEsphomeName(decodeURIComponent(deviceEnc), decodeURIComponent(sensorEnc), name); }); }
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
function loadTempChart(range, btn) { document.querySelectorAll('[data-temprange]').forEach(function(t) { t.classList.remove('active'); }); if (btn) btn.classList.add('active'); fetch('/api/temperature/history?range=' + range).then(function(r){return r.json();}).then(function(rows) { var periods = []; var byRoom = {}; rows.forEach(function(r) { if (periods.indexOf(r.period) === -1) periods.push(r.period); if (!byRoom[r.room]) byRoom[r.room] = {}; byRoom[r.room][r.period] = r.avg_temp; }); periods.sort(); var palette = ['#8DB255','#38BDF8','#F97316','#22C55E','#FBBF24','#F87171']; var rooms = Object.keys(byRoom); var datasets = rooms.map(function(room, i) { var color = palette[i % palette.length]; return { label: room, data: periods.map(function(p) { var v = byRoom[room][p]; return v != null ? Number(v).toFixed(1) : null; }), borderColor: color, backgroundColor: color + '33', borderWidth: 2, tension: 0.3, pointRadius: 0, fill: false }; }); if (chartTemp) chartTemp.destroy(); chartTemp = new Chart(document.getElementById('chart-temp'), { type: 'line', data: { labels: periods.map(function(p) { return range === 'day' ? p.slice(11, 16) : p.slice(8, 10) + '-' + p.slice(5, 7); }), datasets: datasets }, options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { labels: { color: CHART_TEXT, boxWidth: 12, font: { size: 11 } } } }, scales: { x: { ticks: { color: CHART_TICK, maxRotation: 0, autoSkip: true, maxTicksLimit: 7, font: { size: 11 } }, grid: { display: false } }, y: { ticks: { color: CHART_TICK, font: { size: 11 } }, grid: { color: CHART_GRID } } } } }); }).catch(function(){}); }
function refreshWashStatus() { fetch('/api/wasmachine/status').then(function(r){return r.json();}).then(function(s) { var pill = document.getElementById('wash-status-pill'); var icon = document.getElementById('wash-status-icon'); var text = document.getElementById('wash-status-text'); if (!pill) return; var state = s.state || 'idle'; pill.className = 'wash-status-pill ' + state; var since = s.since ? shortWhen(s.since) : null; if (state === 'running') { icon.className = 'fa-solid fa-rotate'; text.textContent = 'In gebruik' + (since ? ' sinds ' + since : ''); } else if (state === 'done') { icon.className = 'fa-solid fa-circle-check'; text.textContent = 'Klaar, nog leeghalen' + (since ? ' (' + since + ')' : ''); } else { icon.className = 'fa-solid fa-moon'; text.textContent = 'Inactief'; } }).catch(function(){}); }


// ── Skeleton loading ──
// Alles wat nog op "—" staat krijgt een skeleton tot de eerste data binnenkomt.
(function() {
  var track = document.getElementById('screens-track');
  function markCharts(root) {
    root.querySelectorAll('.chart-wrap > canvas').forEach(function(c) {
      if (!c.dataset.skelDone) c.parentNode.classList.add('skel-block');
    });
  }
  function mark(root) {
    root.querySelectorAll('div,span').forEach(function(el) {
      var t = el.firstChild;
      if (t && t.nodeType === 3 && /^(—|…|Laden…)/.test(t.nodeValue.trim()) && !el.closest('button,a')) el.classList.add('skel');
    });
    root.querySelectorAll('tbody').forEach(function(tb) {
      if (tb.children.length) return;
      var cols = tb.parentNode.querySelectorAll('thead th').length || 1;
      var html = '';
      for (var i = 0; i < 4; i++) html += '<tr class="skel-row"><td colspan="' + cols + '"><span class="skel-line"></span></td></tr>';
      tb.innerHTML = html;
    });
    markCharts(root);
  }
  new MutationObserver(function(list) {
    list.forEach(function(m) {
      var t = m.target;
      if (m.type === 'attributes') {
        // Chart.js zet een style op het canvas zodra de grafiek getekend wordt
        if (t.tagName === 'CANVAS') { t.dataset.skelDone = '1'; t.parentNode.classList.remove('skel-block'); }
        return;
      }
      if (t.nodeType === 3) t = t.parentNode;
      if (t && t.classList) t.classList.remove('skel');
      m.addedNodes.forEach(function(n) { if (n.nodeType === 1 && !n.classList.contains('skel-row')) markCharts(n); });
    });
  }).observe(track, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['style'] });
  // Blijft data uit (fout of geen sensor), dan na 10 s terug naar de gewone "—"
  function clearAfter(n) {
    setTimeout(function() {
      var s = document.getElementById('screen-' + n);
      if (!s) return;
      s.querySelectorAll('.skel').forEach(function(e) { e.classList.remove('skel'); });
      s.querySelectorAll('.skel-block').forEach(function(e) { e.classList.remove('skel-block'); });
      s.querySelectorAll('.skel-row').forEach(function(r) { r.parentNode.removeChild(r); });
    }, 10000);
  }
  mark(track);
  clearAfter(0);
  var origShowScreen = window.showScreen;
  window.showScreen = function(n) { clearAfter(n); return origShowScreen.apply(this, arguments); };
})();
// ── Screen navigation ──
var currentScreen = 0;
var screenTrack = document.getElementById('screens-track');
var screenLoaded = [true, false, false, false, false, false];

function showScreen(n, btn, fromSwipe) {
  currentScreen = n;
  screenTrack.style.transition = fromSwipe
    ? 'transform 0.3s cubic-bezier(0.4,0,0.2,1)'
    : 'transform 0.38s cubic-bezier(0.4,0,0.2,1)';
  screenTrack.style.transform = 'translateX(calc(-' + (100/6) + '% * ' + n + '))';
  document.querySelectorAll('.nav-item').forEach(function(b) { b.classList.remove('active'); });
  if (btn) {
    btn.classList.add('active');
  } else {
    var nb = document.querySelector('.nav-item[data-screen="' + n + '"]');
    if (nb) nb.classList.add('active');
  }
  var screenEl = document.getElementById('screen-' + n);
  if (screenEl) {
    screenEl.classList.add('screen-entering');
    setTimeout(function() { screenEl.classList.remove('screen-entering'); }, 450);
  }
  if (n === 5) { loadDeviceStatus(); loadModules(); loadDiscordStatus(); loadHcStatus(); }
  if (n === 4) { loadFridge(); closeHomeLedPanels(); buildLedGrid(); buildLed2Grid(); buildLed3Grid(); }
  if (n === 0) { var eb = document.getElementById('layout-edit-btn'); if (eb) eb.style.display='flex'; } else { var eb2 = document.getElementById('layout-edit-btn'); if (eb2) eb2.style.display='none'; if (layoutEditMode) { layoutEditMode=false; removeEditBars(0); saveLayout(); var lb=document.getElementById('layout-edit-btn'); if(lb) lb.style.background='rgba(141,178,85,0.85)'; } }
  if (!screenLoaded[n]) {
    screenLoaded[n] = true;
    if (n === 1) { loadChart('day', document.querySelector('[data-range="day"]')); loadPeaks(); loadWeekdayChart(); loadPhaseChart(); refreshComparison(); refreshStats(); refreshSafety(); loadHeatmap('alltime', document.querySelector('[data-hm="alltime"]')); }
    if (n === 2) { refreshGasStats(); loadGasDaily(); loadGasMonthly(); }
    if (n === 3) { refreshCosts(); loadCostsDaily(); loadCostsOverview(); refreshCheapHours(); }
    if (n === 4) { refreshVaatwasser(); refreshWasmachine(); loadWashWeekdayChart(); refreshEsphome(); refreshTemperature(); loadTempChart('day', document.querySelector('[data-temprange="day"]')); refreshLedState(); refreshLed2State(); refreshLed3State(); refreshRelayGangState(); }
    if (n === 5) { refreshSettingsNames(); }
  }
}

// Schermen van uitgezette modules worden overgeslagen
function screenHidden(n) { return (n === 2 && !moduleOn('gas')) || (n === 4 && document.body.classList.contains('mod-off-thuis')); }
function nextScreen(dir) {
  for (var n = currentScreen + dir; n >= 0 && n <= 5; n += dir) { if (!screenHidden(n)) return n; }
  return currentScreen;
}

// ── Touch swipe ──
var touchX0 = 0, touchY0 = 0, isSwiping = false;
var outerEl = document.getElementById('screens-outer');
outerEl.addEventListener('touchstart', function(e) {
  touchX0 = e.touches[0].clientX;
  touchY0 = e.touches[0].clientY;
  isSwiping = false;
}, {passive: true});
outerEl.addEventListener('touchmove', function(e) {
  if (KIOSK) return;
  var dx = e.touches[0].clientX - touchX0;
  var dy = e.touches[0].clientY - touchY0;
  if (!isSwiping && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) { isSwiping = true; }
  if (isSwiping) {
    var pct = (currentScreen * (100/6)) - (dx / window.innerWidth * (100/6));
    pct = Math.max(0, Math.min(500/6, pct));
    screenTrack.style.transition = 'none';
    screenTrack.style.transform = 'translateX(-' + pct + '%)';
  }
}, {passive: true});
outerEl.addEventListener('touchend', function(e) {
  var dx = e.changedTouches[0].clientX - touchX0;
  if (isSwiping) {
    var target = dx < -50 ? nextScreen(1) : dx > 50 ? nextScreen(-1) : currentScreen;
    if (target !== currentScreen) showScreen(target, null, true);
    else showScreen(currentScreen, null, true);
  }
  isSwiping = false;
}, {passive: true});

// ── Ripple on nav ──
function addRipple(btn, e) {
  var rect = btn.getBoundingClientRect();
  var x = (e.clientX !== undefined ? e.clientX : rect.left + rect.width / 2) - rect.left;
  var y = (e.clientY !== undefined ? e.clientY : rect.top + rect.height / 2) - rect.top;
  var r = document.createElement('div');
  r.className = 'ripple-circle';
  r.style.left = x + 'px';
  r.style.top = y + 'px';
  btn.appendChild(r);
  setTimeout(function() { if (r.parentNode) r.parentNode.removeChild(r); }, 500);
}
document.querySelectorAll('.nav-item').forEach(function(btn) {
  btn.addEventListener('click', function(e) { addRipple(btn, e); });
});

// ── Value flash ──
function flashEl(id) {
  var el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
  setTimeout(function() { el.classList.remove('flash'); }, 500);
}

// ── WAN IP ──
fetch('/api/network-info').then(function(r) { return r.json(); }).then(function(d) {
  var el = document.getElementById('wan-ip-badge');
  if (el) el.innerHTML = '<i class="fa-solid fa-globe"></i> ' + d.wan;
}).catch(function() {});

// ── Helpers ──
function val(v, dec) { return v != null ? Number(v).toFixed(dec != null ? dec : 3) : '—'; }
function setEl(id, html) { var el = document.getElementById(id); if (el) el.innerHTML = html; }
function setCard(id, v, dec, unit) {
  setEl(id, val(v, dec) + '<span class="card-unit">' + unit + '</span>');
}

// ── Live refresh ──
var lastPowerVal = null;
function refresh() {
  fetch('/api/latest').then(function(r) {
    if (r.status === 401) { location.href = '/pin'; return Promise.reject(new Error('niet ingelogd')); }
    connOk();
    return r.json();
  }, function(e) { connFail(); throw e; }).then(function(d) {
    var l = d.latest;
    if (!l) return;
    updatePhaseLoad(l);
    if (lastPowerVal !== null && Math.abs(l.power_delivered_total_kw - lastPowerVal) > 0.01) flashEl('del-total');
    lastPowerVal = l.power_delivered_total_kw;
    setCard('del-total', l.power_delivered_total_kw, 3, 'kW');
    setCard('gas',       l.gas_m3,                  3, 'm³');
    setCard('del-l1', l.power_delivered_l1_kw, 3, 'kW');
    setCard('del-l2', l.power_delivered_l2_kw, 3, 'kW');
    setCard('del-l3', l.power_delivered_l3_kw, 3, 'kW');
    setCard('v-l1', l.voltage_l1, 1, 'V');
    setCard('v-l2', l.voltage_l2, 1, 'V');
    setCard('v-l3', l.voltage_l3, 1, 'V');
    setCard('a-l1', l.current_l1, 0, 'A');
    setCard('a-l2', l.current_l2, 0, 'A');
    setCard('a-l3', l.current_l3, 0, 'A');
    var p1 = l.power_delivered_l1_kw || 0;
    var p2 = l.power_delivered_l2_kw || 0;
    var p3 = l.power_delivered_l3_kw || 0;
    var pMax = Math.max(p1, p2, p3, 0.001);
    var b1 = document.getElementById('bar-l1'); if (b1) b1.style.width = Math.round(p1/pMax*100) + '%';
    var b2 = document.getElementById('bar-l2'); if (b2) b2.style.width = Math.round(p2/pMax*100) + '%';
    var b3 = document.getElementById('bar-l3'); if (b3) b3.style.width = Math.round(p3/pMax*100) + '%';
    var updEl = document.getElementById('updated');
    if (updEl) {
      var age = Math.round((Date.now() - new Date(l.received_at).getTime()) / 1000);
      updEl.textContent = new Date(l.received_at).toLocaleTimeString('nl-NL', {hour12:false}) + ' (' + age + 's)';
      updEl.style.color = age > 60 ? '#F87171' : age > 30 ? '#FBBF24' : '#3D4D6A';
    }
    var html = '';
    for (var i = 0; i < d.recent.length; i++) {
      var rec = d.recent[i];
      html += '<tr><td>' + new Date(rec.received_at).toLocaleTimeString('nl-NL', {hour12:false}) + '</td>' +
        '<td>' + val(rec.power_delivered_total_kw) + '</td>' +
        '<td data-module="gas">' + val(rec.gas_m3) + '</td></tr>';
    }
    setEl('rows', html);
  }).catch(function(e) { console.error('[refresh]', e); });
  updateHomeLedStatus();
  updateHomeLed2Status();
  updateHomeLed3Status();
  updateRelayGangUI();
}
refresh();
setInterval(refresh, 3000);
// Pre-load LED/relay states
fetch('/api/led/state').then(function(r){return r.json();}).then(function(s){ledClientState=s;updateLedUI();updateHomeLedStatus();}).catch(function(){});
fetch('/api/led/state?device=keuken').then(function(r){return r.json();}).then(function(s){ledClientState2=s;updateLed2UI();updateHomeLed2Status();}).catch(function(){});
fetch('/api/led/state?device=gang').then(function(r){return r.json();}).then(function(s){ledClientState3=s;updateLed3UI();updateHomeLed3Status();}).catch(function(){});
fetch('/api/relay/state?device=gang').then(function(r){return r.json();}).then(function(s){relayGangState=s;updateRelayGangUI();}).catch(function(){});


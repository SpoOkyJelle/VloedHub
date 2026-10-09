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
  var changed = n !== currentScreen;
  currentScreen = n;
  screenTrack.style.transition = noMotion ? 'none' : fromSwipe
    ? 'transform 0.3s cubic-bezier(0.4,0,0.2,1)'
    : 'transform 0.38s cubic-bezier(0.4,0,0.2,1)';
  screenTrack.style.transform = 'translateX(calc(-' + (100/6) + '% * ' + n + '))';
  document.querySelectorAll('.nav-item[data-screen]').forEach(function(b) {
    var on = b.dataset.screen === String(n);
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  // Instellingen heeft op de telefoon geen plek in de onderbalk: daar licht het icoon in de kop op
  var hs = document.getElementById('header-settings');
  if (hs) hs.classList.toggle('active', n === 5);
  // Na een veeg stond het scherm al in beeld; alleen bij een tik op het menu komt de inhoud binnenschuiven
  var screenEl = document.getElementById('screen-' + n);
  if (screenEl && changed && !fromSwipe) {
    screenEl.classList.add('screen-entering');
    setTimeout(function() { screenEl.classList.remove('screen-entering'); }, 400);
  }
  if (n === 5) { loadDeviceStatus(); loadModules(); loadDiscordStatus(); loadHcStatus(); loadCameraStatus(); loadPresence(); }
  if (n === 4) { loadFridge(); closeHomeLedPanels(); ledRenderAll(); }
  var eb = document.getElementById('layout-edit-btn');
  if (eb) eb.classList.toggle('show', n === 0);
  if (n !== 0 && layoutEditMode) toggleLayoutEdit();
  if (!screenLoaded[n]) {
    screenLoaded[n] = true;
    if (n === 1) { loadChart('day', document.querySelector('[data-range="day"]')); loadPeaks(); loadWeekdayChart(); loadPhaseChart(); refreshComparison(); refreshStats(); refreshSafety(); loadHeatmap('alltime', document.querySelector('[data-hm="alltime"]')); }
    if (n === 2) { refreshGasStats(); loadGasDaily(); loadGasMonthly(); }
    if (n === 3) { refreshCosts(); loadCostsDaily(); loadCostsOverview(); refreshCheapHours(); }
    if (n === 4) { refreshVaatwasser(); refreshWasmachine(); loadWashWeekdayChart(); refreshEsphome(); refreshTemperature(); loadTempChart('day', document.querySelector('[data-temprange="day"]')); lampsRefresh(); }
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
// Getallen staan overal op z'n Nederlands: komma als decimaalteken, punt voor duizendtallen
function val(v, dec) { return v != null ? nlNum(v, dec != null ? dec : 3) : '—'; }
function setEl(id, html) { var el = document.getElementById(id); if (el) el.innerHTML = html; }
function setCard(id, v, dec, unit) {
  setEl(id, val(v, dec) + '<span class="card-unit">' + unit + '</span>');
}
// Vermogen: onder de kilowatt in hele watts, daarboven in kW met twee decimalen
function powerParts(kw) {
  if (kw == null) return ['—', 'kW'];
  return Math.abs(kw) < 1 ? [nlNum(kw * 1000, 0), 'W'] : [nlNum(kw, 2), 'kW'];
}
function powerHtml(kw, unitClass) { var p = powerParts(kw); return p[0] + '<span class="' + (unitClass || 'card-unit') + '">' + p[1] + '</span>'; }
function powerText(kw) { var p = powerParts(kw); return p[0] + ' ' + p[1]; }
// Assen, bijschriften en rasterlijnen van grafieken nemen de kleuren van het thema over
var CHART_TICK, CHART_TEXT, CHART_GRID;
function cssVar(name, fallback) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback; }
function chartColors() {
  CHART_TICK = cssVar('--dim', '#7C8AA8');
  CHART_TEXT = cssVar('--muted', '#94A3B8');
  CHART_GRID = cssVar('--chart-grid', 'rgba(255,255,255,0.04)');
  if (window.Chart) Chart.defaults.color = CHART_TEXT;
}
chartColors();
// Ander thema: de grafieken worden opnieuw getekend zodra hun scherm weer in beeld komt, die op Home meteen
document.addEventListener('vh-theme', function() {
  chartColors();
  for (var n = 1; n <= 4; n++) if (n !== currentScreen) screenLoaded[n] = false;
  applyLayout(0);
});

// ── Meldingen onderin ──
// Kort bericht na iets wat je zelf deed: een fout die anders onzichtbaar blijft, of een bevestiging
function toast(msg, kind) {
  var stack = document.getElementById('toast-stack');
  if (!stack) return;
  // dezelfde melding niet stapelen als iemand blijft tikken
  for (var i = 0; i < stack.children.length; i++) if (stack.children[i].dataset.msg === msg) return;
  var el = document.createElement('div');
  el.className = 'toast' + (kind ? ' toast-' + kind : '');
  el.dataset.msg = msg;
  el.innerHTML = '<i class="fa-solid ' + (kind === 'error' ? 'fa-circle-exclamation' : kind === 'ok' ? 'fa-circle-check' : 'fa-circle-info') + '"></i><span></span>';
  el.lastChild.textContent = msg;
  stack.appendChild(el);
  el.offsetWidth;
  el.classList.add('show');
  setTimeout(function() { el.classList.remove('show'); setTimeout(function() { el.remove(); }, 250); }, kind === 'error' ? 4500 : 2500);
}
// Mislukt iets wat je zelf deed, dan staat dat onderin in plaats van dat er niets gebeurt
function actionFailed(msg) { return function() { toast(msg || 'Dat lukte niet, probeer het opnieuw', 'error'); }; }

// ── Naam wijzigen op de plek zelf ──
// De tekst wordt een invulveld; Enter of ergens anders tikken slaat op, Escape breekt af
function inlineRename(spanEl, save) {
  if (!spanEl || !spanEl.isConnected) return;
  var input = document.createElement('input');
  input.className = 'field rename-input';
  input.value = spanEl.textContent.trim();
  input.maxLength = 40;
  input.setAttribute('aria-label', 'Nieuwe naam');
  var done = false;
  function finish(keep) {
    if (done) return;
    done = true;
    var name = input.value.trim();
    var changed = keep && name !== spanEl.textContent.trim();
    if (changed && name) spanEl.textContent = name;
    input.replaceWith(spanEl);
    if (changed) save(name);
  }
  input.addEventListener('keydown', function(e) { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); e.stopPropagation(); });
  input.addEventListener('blur', function() { finish(true); });
  input.addEventListener('click', function(e) { e.stopPropagation(); });
  spanEl.replaceWith(input);
  input.focus();
  input.select();
}

// ── Vensters ──
// Openen onthoudt waar de focus stond en zet hem in het venster; Tab blijft erbinnen en Escape sluit het bovenste
var modalStack = [];
function modalFocusable(el) { return Array.prototype.filter.call(el.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])'), function(x) { return !x.disabled && x.offsetParent !== null; }); }
function openModal(id, onClose) {
  var el = document.getElementById(id);
  if (!el || el.classList.contains('open')) return;
  modalStack.push({ el: el, back: document.activeElement, close: onClose });
  el.classList.add('open');
  var first = el.querySelector('input,select,textarea') || modalFocusable(el)[0];
  if (first) first.focus();
}
function closeModal(id) {
  var el = document.getElementById(id);
  if (!el || !el.classList.contains('open')) return;
  el.classList.remove('open');
  for (var i = modalStack.length - 1; i >= 0; i--) {
    if (modalStack[i].el !== el) continue;
    var back = modalStack[i].back;
    modalStack.splice(i, 1);
    if (back && back.isConnected && back.focus) back.focus();
  }
}
function modalDismiss(top) { if (top.close) top.close(); else closeModal(top.el.id); }
document.addEventListener('keydown', function(e) {
  var top = modalStack[modalStack.length - 1];
  if (top) {
    if (e.key === 'Escape') { e.preventDefault(); modalDismiss(top); return; }
    if (e.key === 'Tab') {
      var items = modalFocusable(top.el);
      if (!items.length) return;
      var first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!top.el.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    }
    return;
  }
  // kaarten waar je op kunt tikken werken ook met Enter en spatie
  if ((e.key === 'Enter' || e.key === ' ') && e.target.getAttribute && e.target.getAttribute('role') === 'button' && e.target.tagName !== 'BUTTON') { e.preventDefault(); e.target.click(); }
});
// een tik naast het venster sluit het
document.addEventListener('click', function(e) {
  var top = modalStack[modalStack.length - 1];
  if (top && e.target === top.el) modalDismiss(top);
});

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
    // alleen een sprong laat het getal oplichten, niet elke kleine schommeling
    if (lastPowerVal !== null && Math.abs(l.power_delivered_total_kw - lastPowerVal) > Math.max(0.15, lastPowerVal * 0.2)) flashEl('del-total');
    lastPowerVal = l.power_delivered_total_kw;
    setEl('del-total', powerHtml(l.power_delivered_total_kw, 'unit'));
    setCard('gas',       l.gas_m3,                  3, 'm³');
    setEl('del-l1', powerHtml(l.power_delivered_l1_kw));
    setEl('del-l2', powerHtml(l.power_delivered_l2_kw));
    setEl('del-l3', powerHtml(l.power_delivered_l3_kw));
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
    // Zolang de meter binnenkomt zegt het groene bolletje genoeg; pas bij vertraging staat erbij sinds wanneer
    var updEl = document.getElementById('updated'), dot = document.getElementById('live-dot');
    var age = Math.round((Date.now() - new Date(l.received_at).getTime()) / 1000);
    var stale = age > 60 ? 'off' : age > 30 ? 'slow' : '';
    if (updEl) {
      updEl.textContent = stale ? 'Laatste meting ' + new Date(l.received_at).toLocaleTimeString('nl-NL', {hour:'2-digit', minute:'2-digit', hour12:false}) : '';
      updEl.className = 'updated-text' + (stale ? ' ' + stale : '');
    }
    if (dot) { dot.className = 'dot' + (stale ? ' ' + stale : ''); dot.title = stale ? 'Geen recente meting' : 'Live'; }
    var html = '';
    for (var i = 0; i < d.recent.length; i++) {
      var rec = d.recent[i];
      html += '<tr><td>' + new Date(rec.received_at).toLocaleTimeString('nl-NL', {hour12:false}) + '</td>' +
        '<td>' + powerText(rec.power_delivered_total_kw) + '</td>' +
        '<td data-module="gas">' + val(rec.gas_m3) + '</td></tr>';
    }
    setEl('rows', html);
  }).catch(function(e) { console.error('[refresh]', e); });
}
refresh();
setInterval(refresh, 3000);

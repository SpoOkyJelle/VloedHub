// Deel van het voormalige 03-home-blokken.js — afgesplitst voor overzicht.
// Thuis-pagina onderdelen: inzichten, internetsnelheid, deurbelcamera, bezoekers, aanbellen,
// verbindingsstatus en wandtablet-weergave. Draait in dezelfde bundle-scope.

// ── Inzichten en scènes ──
var FUSE_AMPS = 25; // hoofdzekering per fase
function nlNum(v, d) { return Number(v).toLocaleString('nl-NL', {minimumFractionDigits: d, maximumFractionDigits: d}); }
function updatePhaseLoad(l) {
  for (var i = 1; i <= 3; i++) {
    var fill = document.getElementById('blk-pl-fill-' + i);
    var valEl = document.getElementById('blk-pl-val-' + i);
    if (!fill || !valEl) return;
    var a = l['current_l' + i];
    if (a == null) { valEl.textContent = '—'; continue; }
    var pct = Math.min(100, a / FUSE_AMPS * 100);
    fill.style.width = pct + '%';
    fill.className = 'pl-fill' + (pct >= 80 ? ' high' : pct >= 60 ? ' mid' : '');
    valEl.textContent = nlNum(a, 0) + ' A';
  }
}
function loadForecast() {
  fetch('/api/insights/forecast').then(function(r){return r.json();}).then(function(f) {
    var sub = 'Tot nu toe €' + nlNum(f.cost || 0, 2) + ' · ' + nlNum(f.elec_kwh || 0, 0) + ' kWh · ' + nlNum(f.gas_m3 || 0, 0) + ' m³';
    if (f.forecast_cost == null) { setEl('blk-forecast-value', '—'); setEl('blk-forecast-sub', f.days_measured ? sub : 'Nog geen volledige dag gemeten deze maand'); return; }
    setEl('blk-forecast-value', '€' + nlNum(f.forecast_cost, 0));
    setEl('blk-forecast-sub', sub);
  }).catch(function() { setEl('blk-forecast-value', '—'); });
}
function loadStandby() {
  Promise.all([
    fetch('/api/night-usage').then(function(r){return r.json();}),
    fetch('/api/prices').then(function(r){return r.json();}).catch(function(){return {};})
  ]).then(function(res) {
    var kw = res[0].night_avg, price = res[1].electricity_eur_kwh;
    if (kw == null) { setEl('blk-standby-value', '—'); setEl('blk-standby-sub', 'Nog geen nachtmetingen'); return; }
    var yearKwh = kw * 8760;
    setEl('blk-standby-value', nlNum(kw * 1000, 0) + '<span class="unit">W</span>');
    setEl('blk-standby-sub', "'s Nachts gemiddeld · ≈ " + nlNum(yearKwh, 0) + ' kWh' + (price != null ? ' of €' + nlNum(yearKwh * price, 0) : '') + ' per jaar');
  }).catch(function() { setEl('blk-standby-value', '—'); });
}
function loadTodayVsNormal() {
  fetch('/api/insights/today-vs-normal').then(function(r){return r.json();}).then(function(d) {
    var fill = document.getElementById('blk-tvn-fill'), mark = document.getElementById('blk-tvn-mark');
    if (!fill) return;
    if (d.today_kwh == null) { setEl('blk-tvn-value', '—'); setEl('blk-tvn-sub', 'Nog geen metingen vandaag'); return; }
    if (d.normal_kwh == null) { setEl('blk-tvn-value', nlNum(d.today_kwh, 2) + '<span class="card-unit">kWh</span>'); setEl('blk-tvn-sub', 'Nog geen eerdere dagen om mee te vergelijken'); return; }
    var diff = (d.today_kwh - d.normal_kwh) / d.normal_kwh * 100;
    var color = diff > 10 ? 'var(--red)' : diff < -5 ? 'var(--green)' : 'var(--yellow)';
    var max = Math.max(d.today_kwh, d.normal_kwh) * 1.25;
    fill.style.width = (d.today_kwh / max * 100) + '%';
    fill.style.background = color;
    mark.style.left = (d.normal_kwh / max * 100) + '%';
    mark.style.display = 'block';
    setEl('blk-tvn-value', nlNum(d.today_kwh, 2) + '<span class="card-unit">kWh</span><span class="tvn-diff" style="color:' + color + '">' + (diff >= 0 ? '+' : '−') + nlNum(Math.abs(diff), 0) + '%</span>');
    var dayNames = ['zondagen','maandagen','dinsdagen','woensdagen','donderdagen','vrijdagen','zaterdagen'];
    setEl('blk-tvn-sub', 'Normaal ' + nlNum(d.normal_kwh, 2) + ' kWh op dit tijdstip · gemiddelde van ' + d.samples + ' ' + (d.basis === 'weekday' ? dayNames[new Date().getDay()] : 'dagen'));
  }).catch(function() { setEl('blk-tvn-value', '—'); });
}
// ── Internetsnelheid ──
var inetPoll = null;
function loadInternet() {
  Promise.all([
    fetch('/api/internet').then(function(r){return r.json();}),
    fetch('/api/internet/history?days=7').then(function(r){return r.json();}).catch(function(){return [];})
  ]).then(function(res) {
    var s = res[0], rows = res[1], l = s.latest;
    var btn = document.getElementById('blk-inet-run');
    if (!btn) return;
    btn.disabled = s.running;
    btn.textContent = s.running ? 'Bezig…' : 'Nu meten';
    // een test duurt een halve minuut; tot die klaar is blijven kijken
    clearTimeout(inetPoll);
    if (s.running) inetPoll = setTimeout(loadInternet, 5000);
    function val(label, v, d, unit, color) {
      return '<div><div class="info-label">' + label + '</div><div class="info-value" style="color:' + color + '">' + (v != null ? nlNum(v, d) : '—') + '<span class="card-unit">' + unit + '</span></div></div>';
    }
    setEl('blk-inet-values', val('Download', l && l.download_mbps, 0, 'Mbit/s', 'var(--accent-l)') + val('Upload', l && l.upload_mbps, 0, 'Mbit/s', 'var(--blue)') + val('Ping', l && l.ping_ms, 0, 'ms', 'var(--text)'));
    var sub = l ? 'Gemeten ' + shortWhen(l.measured_at) + (l.isp ? ' · ' + escHtml(l.isp) : '') : 'Nog geen meting';
    setEl('blk-inet-sub', s.error ? '<span class="c-red">' + escHtml(s.error) + '</span>' + (l ? ' · laatste meting ' + shortWhen(l.measured_at) : '') : sub);
    var ctx = document.getElementById('blk-chart-inet');
    if (!ctx) return;
    if (window._blkChartInet) window._blkChartInet.destroy();
    window._blkChartInet = new Chart(ctx, {type:'line', data:{labels:rows.map(function(r){return shortWhen(r.measured_at);}), datasets:[
      {label:'Download (Mbit/s)', data:rows.map(function(r){return r.download_mbps;}), borderColor:'#8DB255', backgroundColor:accentGradient, borderWidth:1.5, pointRadius:0, tension:0.3, fill:true},
      {label:'Upload (Mbit/s)', data:rows.map(function(r){return r.upload_mbps;}), borderColor:'#38BDF8', borderWidth:1.5, pointRadius:0, tension:0.3, fill:false}
    ]}, options:{responsive:true, maintainAspectRatio:false, interaction:{mode:'index', intersect:false}, plugins:{legend:{display:false}}, scales:{x:{display:false}, y:{display:false, beginAtZero:true}}}});
  }).catch(function(){});
}
function runInternetTest() {
  var btn = document.getElementById('blk-inet-run');
  if (btn) { btn.disabled = true; btn.textContent = 'Bezig…'; }
  fetch('/api/internet/run', {method:'POST'}).then(loadInternet).catch(function() { toast('Meting starten lukte niet', 'error'); loadInternet(); });
}
// ── Deurbelcamera ──
// Het beeld is een momentopname die om de paar seconden ververst, alleen zolang Home open staat.
var CAM_INTERVAL = 3000, CAM_RETRY = 15000;
var camTimer = null, camBusy = false;
function camNext(ms) { clearTimeout(camTimer); camTimer = setTimeout(loadCamera, ms); }
function camMessage(text) {
  var img = document.getElementById('blk-cam-img'), msg = document.getElementById('blk-cam-msg');
  if (!img || !msg) return;
  img.hidden = true; msg.hidden = false;
  msg.innerHTML = '<i class="fa-solid fa-video-slash"></i><span>' + escHtml(text) + '</span>';
  setEl('blk-cam-time', '');
  camState('off', 'Geen beeld');
}
function camState(cls, label) {
  var pill = document.getElementById('blk-cam-pill');
  if (pill) { pill.className = 'cam-pill ' + cls; pill.lastChild.textContent = label; }
}
// Tik op het beeld voor een schermvullende weergave; bij aanbellen opent die vanzelf, op elk scherm.
// Een eigen laag in plaats van de Fullscreen-API, want die bestaat op de iPhone niet voor gewone elementen.
// De laag haalt zelf zijn beeld op, zodat hij ook werkt als het blok niet op Home staat.
var CAM_OVERLAY_INTERVAL = 1500, CAM_RING_OPEN = 60000;
var camOvTimer = null, camOvClose = null, camOvUrl = null;
// Het grote beeld groeit vanuit het blok en krimpt daar bij het sluiten weer naartoe: dit zet het op de plek van het blok
function camShrink(big) {
  var frame = document.getElementById('blk-cam-frame');
  var r = frame && currentScreen === 0 ? frame.getBoundingClientRect() : null;
  if (!r || !r.width) { big.style.transform = 'scale(0.9)'; return; }
  var w = window.innerWidth, h = window.innerHeight;
  big.style.transform = 'translate(' + (r.left + r.width / 2 - w / 2) + 'px,' + (r.top + r.height / 2 - h / 2) + 'px) scale(' + Math.max(r.width / w, r.height / h) + ')';
}
function camOverlayTick() {
  var ov = document.getElementById('cam-overlay');
  if (!ov || !ov.classList.contains('open')) return;
  function next() { clearTimeout(camOvTimer); camOvTimer = setTimeout(camOverlayTick, CAM_OVERLAY_INTERVAL); }
  fetch('/api/camera/snapshot?t=' + Date.now()).then(function(r) {
    if (!r.ok) throw new Error('Geen beeld');
    return r.blob();
  }).then(function(blob) {
    var old = camOvUrl;
    camOvUrl = URL.createObjectURL(blob);
    ov.firstChild.src = camOvUrl;
    ov.firstChild.hidden = false;
    if (old) URL.revokeObjectURL(old);
    next();
  }).catch(next);
}
// ring: geopend doordat er wordt aangebeld; dan staat dat erbij en sluit de laag na een minuut vanzelf
function openCamOverlay(ring) {
  var ov = document.getElementById('cam-overlay'), img = document.getElementById('blk-cam-img');
  // stond er een foto van een eerder bezoek open, dan maakt die plaats voor het beeld van nu
  if (ov && ov.dataset.still) { ov.remove(); ov = null; }
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'cam-overlay';
    ov.className = 'cam-overlay';
    ov.onclick = closeCamOverlay;
    ov.innerHTML = '<img alt="Beeld van de deurbel" hidden><span class="cam-close"><i class="fa-solid fa-xmark"></i></span>';
    // het beeld van het blok als begin, tot de eerste eigen opname binnen is
    if (img && !img.hidden) { ov.firstChild.src = img.src; ov.firstChild.hidden = false; }
    camShrink(ov.firstChild);
    document.body.appendChild(ov);
    ov.offsetWidth; // beginstand vastleggen, anders slaat de browser de overgang over
    ov.classList.add('open');
    ov.firstChild.style.transform = '';
    camOverlayTick();
  }
  if (!ring) return;
  if (!ov.querySelector('.cam-ring')) ov.insertAdjacentHTML('beforeend', '<div class="cam-ring"><i class="fa-solid fa-bell"></i>' + (typeof partyState !== 'undefined' && partyState.on ? 'Nieuwe gast!' : 'Er wordt aangebeld') + '</div>');
  clearTimeout(camOvClose);
  camOvClose = setTimeout(closeCamOverlay, CAM_RING_OPEN);
}
function closeCamOverlay() {
  var ov = document.getElementById('cam-overlay');
  if (!ov || !ov.classList.contains('open')) return;
  var ringsOv = document.getElementById('rings-overlay');
  if (ringsOv) ringsOv.style.pointerEvents = 'none';
  clearTimeout(camOvTimer);
  clearTimeout(camOvClose);
  ov.classList.remove('open');
  camShrink(ov.firstChild);
  setTimeout(function() {
    ov.remove();
    if (camOvUrl) { URL.revokeObjectURL(camOvUrl); camOvUrl = null; }
    if (ringsOv) ringsOv.style.pointerEvents = '';
  }, 280);
}
// ── Bezoekers ──
// Bij elke keer aanbellen bewaart de server een foto; de laatste staan onder het beeld en zijn groot te bekijken
var CAM_VISITS = 4;
function loadRings() {
  var el = document.getElementById('blk-cam-visits');
  if (!el) return;
  fetch('/api/camera/rings').then(function(r){return r.json();}).then(function(list) {
    var show = list.slice(0, list.length > CAM_VISITS ? CAM_VISITS - 1 : CAM_VISITS);
    var html = show.map(function(at) {
      return '<button class="cam-visit" onclick="openCamStill(' + at + ')" aria-label="Foto van ' + shortWhen(at) + '"><img loading="lazy" alt="" src="/api/camera/rings/' + at + '.jpg"><span>' + shortWhen(at) + '</span></button>';
    }).join('');
    if (list.length > CAM_VISITS) {
      html += '<button class="cam-visit cam-visit-more" onclick="openRingsHistory()" aria-label="Alle foto\'s bekijken"><i class="fa-solid fa-images"></i><span>+' + (list.length - (CAM_VISITS - 1)) + ' meer</span></button>';
    }
    el.innerHTML = html;
  }).catch(function(){});
}
function deleteRing(at, cb) {
  fetch('/api/camera/rings/' + at + '.jpg', { method: 'DELETE' }).then(function(r){return r.json();}).then(function(d) {
    if (d.ok) { loadRings(); if (cb) cb(); }
  }).catch(function(){});
}
function openRingsHistory() {
  if (document.getElementById('rings-overlay')) return;
  var ov = document.createElement('div');
  ov.id = 'rings-overlay';
  ov.className = 'rings-overlay';
  ov.innerHTML = '<div class="rings-overlay-inner" onclick="event.stopPropagation()">' +
    '<div class="rings-overlay-header"><span>Bezoekersgeschiedenis</span><button class="rings-close" onclick="closeRingsHistory()"><i class="fa-solid fa-xmark"></i></button></div>' +
    '<div class="rings-grid" id="rings-grid"><div class="rings-loading"><i class="fa-solid fa-circle-notch fa-spin"></i></div></div>' +
    '</div>';
  ov.onclick = closeRingsHistory;
  document.body.appendChild(ov);
  ov.offsetWidth;
  ov.classList.add('open');
  fetch('/api/camera/rings').then(function(r){return r.json();}).then(function(list) {
    var grid = document.getElementById('rings-grid');
    if (!grid) return;
    if (!list.length) { grid.innerHTML = '<p class="rings-empty">Geen foto\'s bewaard</p>'; return; }
    grid.innerHTML = list.map(function(at) {
      return '<div class="rings-item"><button class="cam-visit" onclick="openCamStill(' + at + ')" aria-label="Foto van ' + shortWhen(at) + '"><img loading="lazy" alt="" src="/api/camera/rings/' + at + '.jpg"><span>' + shortWhen(at) + '</span></button>' +
        '<button class="rings-delete" onclick="deleteRingFromHistory(' + at + ',this)" aria-label="Verwijder foto"><i class="fa-solid fa-trash"></i></button></div>';
    }).join('');
  }).catch(function(){});
}
function closeRingsHistory() {
  var ov = document.getElementById('rings-overlay');
  if (!ov) return;
  ov.classList.remove('open');
  setTimeout(function() { ov.remove(); }, 250);
}
function deleteRingFromHistory(at, btn) {
  var item = btn.closest('.rings-item');
  if (item) item.style.opacity = '0.4';
  deleteRing(at, function() {
    if (item) item.remove();
    var grid = document.getElementById('rings-grid');
    if (grid && !grid.querySelector('.rings-item')) grid.innerHTML = '<p class="rings-empty">Geen foto\'s bewaard</p>';
  });
}
function openCamStill(at) {
  if (layoutEditMode || document.getElementById('cam-overlay')) return;
  var ov = document.createElement('div');
  ov.id = 'cam-overlay';
  ov.className = 'cam-overlay';
  ov.dataset.still = '1';
  ov.onclick = closeCamOverlay;
  ov.innerHTML = '<img alt="Foto van de deurbel" src="/api/camera/rings/' + at + '.jpg"><span class="cam-close"><i class="fa-solid fa-xmark"></i></span>' +
    '<div class="cam-ring still"><i class="fa-solid fa-bell"></i>Aangebeld ' + shortWhen(at) + '</div>' +
    '<button class="cam-delete" onclick="event.stopPropagation();deleteRing(' + at + ',closeCamOverlay)" aria-label="Foto verwijderen"><i class="fa-solid fa-trash"></i></button>';
  camShrink(ov.firstChild);
  document.body.appendChild(ov);
  ov.offsetWidth;
  ov.classList.add('open');
  ov.firstChild.style.transform = '';
}
function toggleCamFull() {
  var img = document.getElementById('blk-cam-img');
  if (img && !img.hidden && !layoutEditMode) openCamOverlay(false);
}
document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeCamOverlay(); });
// ── Aanbellen ──
// De server houdt bij wanneer er is aangebeld; hier wordt dat om de paar seconden nagevraagd. Een bel van
// minder dan drie kwart minuut geleden opent het beeld, ook als de app net pas is geopend.
var BELL_POLL = 2000, BELL_FRESH = 45000;
var bellSeen = null;
function checkBell() {
  if (document.hidden || !moduleOn('camera')) return;
  fetch('/api/camera/bell').then(function(r){return r.json();}).then(function(d) {
    if (!d.ring_at || d.ring_at === bellSeen) return;
    bellSeen = d.ring_at;
    if (d.age_ms > BELL_FRESH) return;
    openCamStill(d.ring_at);
    setTimeout(closeCamOverlay, 5000);
    loadMeldingen();
    loadRings();
  }).catch(function(){});
}
setInterval(checkBell, BELL_POLL);
function loadCamera() {
  var img = document.getElementById('blk-cam-img');
  if (!img || !blockEnabled('camera') || img.closest('.layout-block').style.display === 'none') { clearTimeout(camTimer); return; }
  if (camBusy) return;
  if (document.hidden || currentScreen !== 0 || layoutEditMode) return camNext(CAM_INTERVAL);
  camBusy = true;
  // eerst ophalen en dan pas tonen, zodat het beeld niet knippert
  fetch('/api/camera/snapshot?t=' + Date.now()).then(function(r) {
    if (r.ok) return r.blob();
    return r.json().then(function(d) { throw new Error(d.error || 'Geen beeld'); });
  }).then(function(blob) {
    var old = img.src, msg = document.getElementById('blk-cam-msg');
    img.src = URL.createObjectURL(blob);
    if (old && old.indexOf('blob:') === 0) URL.revokeObjectURL(old);
    img.hidden = false;
    if (msg) msg.hidden = true;
    camState('live', 'Live');
    setEl('blk-cam-time', new Date().toLocaleTimeString('nl-NL', {hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false}));
    camBusy = false;
    camNext(CAM_INTERVAL);
  }).catch(function(e) {
    camBusy = false;
    camMessage(e && e.message && !/fetch|network/i.test(e.message) ? e.message : 'Geen verbinding');
    camNext(CAM_RETRY);
  });
}
// ── Verbinding ──
// Twee mislukte verzoeken achter elkaar (ruim 6 s) tonen een balkje; het eerste dat weer lukt haalt het weg.
var connFails = 0, lastConnOk = null;
function connOk() {
  connFails = 0;
  lastConnOk = new Date();
  var b = document.getElementById('conn-banner');
  if (b) b.hidden = true;
}
function connFail() {
  connFails++;
  var b = document.getElementById('conn-banner');
  if (!b || connFails < 2) return;
  document.getElementById('conn-text').textContent = 'Geen verbinding met VloedHub' +
    (lastConnOk ? ' · laatste update ' + lastConnOk.toLocaleTimeString('nl-NL', {hour:'2-digit', minute:'2-digit', hour12:false}) : '');
  b.hidden = false;
}

// ── Wandtablet-weergave ──
function kioskTick() {
  var now = new Date();
  var c = document.getElementById('kiosk-clock'), d = document.getElementById('kiosk-date');
  if (c) c.textContent = now.toLocaleTimeString('nl-NL', {hour:'2-digit', minute:'2-digit', hour12:false});
  if (d) d.textContent = now.toLocaleDateString('nl-NL', {weekday:'long', day:'numeric', month:'long'});
}
// Instellingen > Algemeen > Weergave
function loadDisplaySettings() {
  var pref = window.vhTheme ? vhTheme.get() : 'dark';
  document.querySelectorAll('[data-theme-pref]').forEach(function(b) {
    var on = b.dataset.themePref === pref;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on);
  });
  moveTabIndicators();
}
function setTheme(pref) { if (window.vhTheme) vhTheme.set(pref); loadDisplaySettings(); }
loadDisplaySettings();

function exitKiosk() {
  try { localStorage.removeItem('vh-kiosk'); } catch (e) {}
  location.href = '/';
}
if (KIOSK) {
  kioskTick();
  setInterval(kioskTick, 10000);
  // scherm aan houden waar de browser dat toestaat (alleen via https)
  var keepAwake = function() { if (navigator.wakeLock && document.visibilityState === 'visible') navigator.wakeLock.request('screen').catch(function(){}); };
  keepAwake();
  document.addEventListener('visibilitychange', keepAwake);
  // twee keer per dag vers laden, zodat een tablet die altijd aan staat updates meekrijgt
  setTimeout(function() { location.reload(); }, 12 * 3600 * 1000);
}


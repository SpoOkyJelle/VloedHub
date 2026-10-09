// ── Koelkast ──
function fridgeSkeleton() {
  return '<div class="chart-title">Koelkast</div><div class="fridge-row"><span class="skel-line grow tall"></span><span class="skel-line grow tall"></span></div><div class="power-sub">&nbsp;</div>';
}
function fridgeHtml(d) {
  var head = '<div class="chart-header"><span class="chart-title"><i class="fa-solid fa-snowflake title-icon c-blue"></i>Koelkast</span>';
  if (!d.configured) return head + '</div><div class="fridge-msg">Nog niet gekoppeld. Zet de databasegegevens op de server (zie <code>services/fridge.js</code>).</div>';
  if (!d.ok) return head + '</div><div class="fridge-msg">' + (d.error || 'Niet bereikbaar') + '</div>';
  if (!d.compartments.length) return head + '</div><div class="fridge-msg">Nog geen metingen</div>';
  var age = d.updated ? Math.round((Date.now() - new Date(d.updated).getTime()) / 60000) : null;
  var ageText = age == null ? '' : age < 1 ? 'zojuist' : age < 60 ? age + ' min geleden' : age < 2880 ? Math.round(age / 60) + ' uur geleden' : Math.round(age / 1440) + ' dagen geleden';
  head += '<span class="power-sub">' + ageText + '</span></div>';
  function deg(v) { return v != null ? nlNum(v, v % 1 ? 1 : 0) + '°' : '—'; }
  var cells = d.compartments.map(function(c) {
    // warmer dan ingesteld valt op: 3 graden of meer boven de ingestelde temperatuur
    var warm = c.temp != null && c.setpoint != null && c.temp - c.setpoint >= 3;
    return '<div class="fridge-cell"><div class="fridge-label">' + c.label + '</div>' +
      '<div class="fridge-temp' + (warm ? ' warm' : '') + '">' + deg(c.temp) + '</div>' +
      '<div class="fridge-set">' + (c.setpoint != null ? 'ingesteld ' + deg(c.setpoint) : '&nbsp;') + '</div></div>';
  }).join('');
  var env = [];
  if (d.environment && d.environment.temp != null) env.push('Omgeving ' + deg(d.environment.temp));
  if (d.environment && d.environment.humidity != null) env.push('vocht ' + nlNum(d.environment.humidity, 0) + '%');
  return head + '<div class="fridge-row">' + cells + '</div>' + (env.length ? '<div class="power-sub">' + env.join(' · ') + '</div>' : '');
}
function loadFridge() {
  var slots = document.querySelectorAll('.fridge-slot');
  if (!slots.length) return;
  fetch('/api/fridge').then(function(r){return r.json();}).then(function(d) {
    var html = fridgeHtml(d);
    Array.prototype.forEach.call(document.querySelectorAll('.fridge-slot'), function(el) { el.innerHTML = html; });
  }).catch(function() {
    Array.prototype.forEach.call(document.querySelectorAll('.fridge-slot'), function(el) { el.innerHTML = fridgeHtml({ configured: true, ok: false }); });
  });
}
Array.prototype.forEach.call(document.querySelectorAll('.fridge-slot'), function(el) { el.innerHTML = fridgeSkeleton(); });
setInterval(loadFridge, 5 * 60 * 1000);

// ── Discord ──
function showDiscordStatus(d, note) {
  var el = document.getElementById('discord-status');
  if (!el) return;
  el.style.color = '';
  var text = d.configured ? 'Ingesteld (eindigt op …' + d.hint + ')' : 'Nog niet ingesteld: er worden geen meldingen verstuurd';
  if (d.fromEnv) text += ' · vast ingesteld op de server';
  if (d.configured && d.enabled === false) text += ' · meldingen staan uit bij Modules';
  el.textContent = note ? note + ' · ' + text : text;
}
function loadDiscordStatus() {
  fetch('/api/discord').then(function(r){return r.json();}).then(function(d) { showDiscordStatus(d); }).catch(function(){});
}
function discordError(msg) {
  var el = document.getElementById('discord-status');
  el.style.color = 'var(--red)';
  el.textContent = msg;
}
function saveDiscordWebhook() {
  var input = document.getElementById('discord-webhook');
  fetch('/api/discord', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({webhook: input.value})})
    .then(function(r){return r.json();}).then(function(d) {
      if (!d.ok) { discordError(d.error || 'Opslaan mislukt'); return; }
      input.value = '';
      showDiscordStatus(d, 'Opgeslagen');
    }).catch(function() { discordError('Verbindingsfout'); });
}
function testDiscordWebhook(btn) {
  btn.disabled = true;
  fetch('/api/discord/test', {method:'POST'}).then(function(r){return r.json();}).then(function(d) {
    btn.disabled = false;
    if (!d.ok) { discordError(d.error || 'Test mislukt'); return; }
    var el = document.getElementById('discord-status');
    el.style.color = 'var(--green)';
    el.textContent = 'Testbericht verstuurd';
  }).catch(function() { btn.disabled = false; discordError('Verbindingsfout'); });
}

// ── Deurbelcamera ──
function showCameraStatus(d, note, error) {
  var el = document.getElementById('camera-status');
  if (!el) return;
  el.style.color = error ? 'var(--red)' : note ? 'var(--green)' : '';
  var text = d.configured ? 'Ingesteld op ' + d.host + ' (gebruiker ' + d.user + ')' : 'Nog niet ingesteld. Zet HTTP aan op de camera en maak daar een gebruiker met alleen kijkrechten.';
  if (d.configured && d.bell === false) text += ' · deze camera meldt het aanbellen niet aan VloedHub';
  el.textContent = error || (note ? note + ' · ' + text : text);
  if (d.configured) { document.getElementById('camera-host').value = d.host; document.getElementById('camera-user').value = d.user; document.getElementById('camera-password').placeholder = 'Wachtwoord (ongewijzigd)'; }
}
function loadCameraStatus() {
  fetch('/api/camera').then(function(r){return r.json();}).then(function(d) { showCameraStatus(d); }).catch(function(){});
}
function saveCameraConfig(btn) {
  btn.disabled = true;
  fetch('/api/camera', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({
    host: document.getElementById('camera-host').value,
    user: document.getElementById('camera-user').value,
    password: document.getElementById('camera-password').value
  })}).then(function(r){return r.json();}).then(function(d) {
    btn.disabled = false;
    if (!d.ok) { showCameraStatus({}, null, d.error || 'Opslaan mislukt'); return; }
    document.getElementById('camera-password').value = '';
    if (d.test_error) showCameraStatus(d, null, 'Opgeslagen, maar: ' + d.test_error);
    else showCameraStatus(d, d.configured ? 'Opgeslagen, beeld ontvangen' : 'Gewist');
    loadCamera();
  }).catch(function() { btn.disabled = false; showCameraStatus({}, null, 'Verbindingsfout'); });
}

// ── Vaatwasser (Home Connect) ──
var DISH_PROGRAMS = { Eco50:'Eco 50°', Auto2:'Auto 45–65°', Auto1:'Auto 35–45°', Auto3:'Auto 65–75°', Intensiv70:'Intensief 70°', Quick45:'Snel 45°', Quick65:'Snel 65°', Kurz60:'Express 60°', Glas40:'Glas 40°', NightWash:'Stil 50', PreRinse:'Voorspoelen', MachineCare:'Machinereiniging', Super60:'Super 60°' };
var DISH_STATES = { Run:['running','fa-rotate','Bezig'], Finished:['done','fa-circle-check','Klaar, nog uitruimen'], Pause:['running','fa-pause','Gepauzeerd'], DelayedStart:['idle','fa-clock','Uitgestelde start'], ActionRequired:['running','fa-triangle-exclamation','Actie nodig'], Error:['idle','fa-triangle-exclamation','Storing'], Aborting:['idle','fa-xmark','Wordt afgebroken'], Ready:['idle','fa-moon','Stand-by'], Inactive:['idle','fa-moon','Uit'] };
function dishProgram(p) { return p ? (DISH_PROGRAMS[p] || p) : '—'; }
function dishDuration(m) { if (m == null) return '—'; m = Math.round(m); return m >= 60 ? Math.floor(m / 60) + ' u ' + (m % 60) + ' min' : m + ' min'; }
function refreshVaatwasserStats() {
  fetch('/api/vaatwasser/stats').then(function(r){return r.json();}).then(function(s) {
    setEl('dish-week', s.this_week || 0);
    setEl('dish-month', s.this_month || 0);
    setEl('dish-avg-duration', dishDuration(s.avg_duration));
    setEl('dish-top-program', s.programs.length ? dishProgram(s.programs[0].program) : '—');
    setEl('dish-avg-forecast', (s.avg_energy != null ? 'gem. energie ' + Math.round(s.avg_energy) + '% · water ' + Math.round(s.avg_water) + '%' : '') +
      (s.avg_kwh != null ? ' · ±' + num(s.avg_kwh, 2) + ' kWh' + (s.avg_cost != null ? ' (' + eur(s.avg_cost) + ')' : '') + ' per beurt' : ''));
    function pct(v) { return v != null ? Math.round(v) + '%' : '—'; }
    setEl('dish-rows', s.recent.length ? s.recent.map(function(r) {
      var extras = (r.options || '').split(',').filter(Boolean).map(function(x) { return s.extras[x] || x; }).join(', ');
      return '<tr><td>' + shortWhen(r.finished_at) + '</td><td>' + dishProgram(r.program) + (extras ? '<span class="esp-sub"> · ' + extras + '</span>' : '') + '</td><td>' + dishDuration(r.duration_min) + '</td><td>' + pct(r.energy_pct) + '</td><td>' + pct(r.water_pct) + '</td><td>' + (r.est_kwh != null ? '±' + num(r.est_kwh, 2) + ' kWh' + (r.est_cost != null ? ' · ' + eur(r.est_cost) : '') : '—') + '</td></tr>';
    }).join('') : '<tr><td colspan="6" class="table-empty">Nog geen beurten gelogd — vanaf nu wordt elke beurt bijgehouden</td></tr>');
  }).catch(function(){});
}
// Goedkoopste moment om te starten, op basis van de uurprijzen en de duur van je meest gedraaide programma
function refreshVaatwasserAdvies(busy) {
  if (busy) { setEl('dish-best', ''); return; }
  fetch('/api/vaatwasser/advies').then(function(r){return r.json();}).then(function(a) {
    if (a.best_price == null) { setEl('dish-best', ''); return; }
    var basis = dishDuration(a.duration_min) + (a.measured ? ' ' + dishProgram(a.program) : ', aanname');
    function cost(p) { return a.kwh != null ? ' ≈ ' + eur(a.kwh * p) : ''; }
    if (a.best_start === 'now') { setEl('dish-best', '<i class="fa-solid fa-bolt"></i> Nu starten is het goedkoopst · €' + nlNum(a.best_price, 2) + '/kWh' + cost(a.best_price) + ' <span>(' + basis + ')</span>'); return; }
    var save = a.now_price ? Math.round((a.now_price - a.best_price) / a.now_price * 100) : null;
    setEl('dish-best', '<i class="fa-solid fa-clock"></i> Goedkoopst starten om <strong>' + shortWhen(a.best_start) + '</strong> · €' + nlNum(a.best_price, 2) + '/kWh' + cost(a.best_price) +
      (a.now_price != null ? ' · nu €' + nlNum(a.now_price, 2) + (save > 0 ? ', scheelt ' + save + '%' : '') : '') + ' <span>(' + basis + ')</span>');
  }).catch(function(){});
}
function toggleDishStats() {
  var open = false;
  document.querySelectorAll('.dish-collapse').forEach(function(el) { open = el.classList.toggle('open'); });
  var card = document.querySelector('.dish-card');
  if (card) card.setAttribute('aria-expanded', open);
}
function refreshVaatwasser() {
  refreshVaatwasserStats();
  fetch('/api/vaatwasser').then(function(r){return r.json();}).then(function(d) {
    var pill = document.getElementById('dish-status-pill');
    if (!pill) return;
    var s = d.state || {};
    var view = !d.linked ? ['idle','fa-link-slash','Niet gekoppeld'] : s.reachable === false ? ['idle','fa-plug-circle-xmark','Offline'] : DISH_STATES[s.operation] || ['idle','fa-moon', s.operation || 'Onbekend'];
    pill.className = 'wash-status-pill ' + view[0];
    document.getElementById('dish-status-icon').className = 'fa-solid ' + view[1];
    document.getElementById('dish-status-text').textContent = view[2];
    setEl('dish-last', !d.linked ? 'Koppel bij Instellingen' : d.lastFinished ? 'Laatste: ' + shortWhen(d.lastFinished) : '');
    var alertsEl = document.getElementById('dish-alerts');
    alertsEl.textContent = '';
    (d.alerts || []).forEach(function(a) { var el = document.createElement('span'); el.className = 'hour-exp'; el.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> '; el.appendChild(document.createTextNode(a)); alertsEl.appendChild(el); });
    if ((d.alerts || []).length > 0) {
      var btn = document.createElement('button');
      btn.className = 'btn btn-quiet btn-sm';
      btn.title = 'Meldingen wissen (probleem is verholpen)';
      btn.innerHTML = '<i class="fa-solid fa-check"></i> Wissen';
      btn.onclick = function(e) {
        e.stopPropagation();
        fetch('/api/vaatwasser/alerts/clear', { method: 'POST' }).then(function() { refreshVaatwasser(); }).catch(actionFailed('Wissen lukte niet'));
      };
      alertsEl.appendChild(btn);
    }
    var mins = s.finishAt ? Math.max(0, Math.round((s.finishAt - Date.now()) / 60000)) : null;
    refreshVaatwasserAdvies(!d.linked || s.operation === 'Run' || s.operation === 'Pause');
    setEl('dish-program', dishProgram(s.program));
    setEl('dish-remaining', dishDuration(mins));
    setEl('dish-finish', s.finishAt ? shortWhen(s.finishAt) : '—');
    setEl('dish-door', { Open:'Open', Closed:'Dicht', Locked:'Vergrendeld' }[s.door] || '—');
    var bar = document.getElementById('dish-progress');
    bar.style.width = (s.operation === 'Finished' ? 100 : s.progress || 0) + '%';
  }).catch(function(){});
}
var hcPollTimer = null;
function showHcStatus(d, note) {
  var el = document.getElementById('hc-status'), pend = document.getElementById('hc-pending');
  el.style.color = d.error ? 'var(--red)' : d.linked ? 'var(--green)' : '';
  el.textContent = d.error ? d.error
    : d.linked ? 'Gekoppeld' + (d.name ? ' met ' + d.name : '')
    : d.pending ? 'Wacht op goedkeuring…'
    : d.configured ? (note ? note + ' · ' : '') + 'Client-ID eindigt op …' + d.clientHint + ', nog niet gekoppeld'
    : 'Vul het client-ID van je Home Connect-applicatie in';
  pend.textContent = '';
  if (d.pending) {
    var a = document.createElement('a');
    a.href = d.pending.url; a.target = '_blank'; a.rel = 'noopener'; a.className = 'btn btn-primary';
    a.textContent = 'Open Home Connect';
    var code = document.createElement('span');
    code.className = 'power-sub';
    code.textContent = 'Log in en keur de koppeling goed. Code: ' + d.pending.user_code;
    pend.appendChild(a); pend.appendChild(code);
  }
  var btn = document.getElementById('hc-link-btn');
  btn.textContent = d.linked ? 'Ontkoppelen' : 'Koppelen';
  btn.onclick = d.linked ? unlinkHc : linkHc;
  btn.disabled = !d.configured || !!d.pending;
  clearTimeout(hcPollTimer);
  if (d.pending) hcPollTimer = setTimeout(loadHcStatus, 3000);
}
function loadHcStatus() {
  fetch('/api/vaatwasser').then(function(r){return r.json();}).then(function(d) { showHcStatus(d); }).catch(function(){});
}
function hcPost(path, body, note) {
  fetch('/api/vaatwasser/' + path, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body || {})})
    .then(function(r){return r.json();}).then(function(d) { showHcStatus(d, d.ok ? note : null); refreshVaatwasser(); })
    .catch(function() { showHcStatus({ error: 'Verbindingsfout', configured: true }); });
}
function saveHcConfig() {
  var id = document.getElementById('hc-client-id'), secret = document.getElementById('hc-client-secret');
  hcPost('config', { clientId: id.value, clientSecret: secret.value }, 'Opgeslagen');
  id.value = ''; secret.value = '';
}
function linkHc() { hcPost('link'); }
function unlinkHc() { hcPost('unlink'); }

// ── Tabbladen van Instellingen ──
// Het gekozen tabblad blijft op dit apparaat bewaard
// Het groene vlak achter het gekozen tabblad is één los element dat naar zijn nieuwe plek schuift
function moveTabIndicator(bar) {
  if (!bar) return;
  var active = bar.querySelector('.tab.active'), ind = bar.querySelector('.tab-indicator');
  if (!ind) {
    ind = document.createElement('span');
    ind.className = 'tab-indicator';
    ind.setAttribute('aria-hidden', 'true');
    bar.insertBefore(ind, bar.firstChild);
  }
  // staat de balk niet in beeld (ander tabblad), dan valt er niets te meten
  if (!active || !active.offsetWidth) { ind.style.opacity = 0; bar.classList.remove('ready'); return; }
  ind.style.width = active.offsetWidth + 'px';
  ind.style.height = active.offsetHeight + 'px';
  ind.style.transform = 'translate(' + active.offsetLeft + 'px,' + active.offsetTop + 'px)';
  ind.style.opacity = 1;
  // de eerste keer staat het er meteen; pas daarna schuift het
  if (!bar.classList.contains('ready')) { ind.offsetWidth; bar.classList.add('ready'); }
  // op een smal scherm schuift de rij mee, zodat het gekozen tabblad in beeld blijft
  var left = active.offsetLeft - 12, right = active.offsetLeft + active.offsetWidth + 12;
  if (left < bar.scrollLeft) bar.scrollTo({ left: left, behavior: noMotion ? 'auto' : 'smooth' });
  else if (right > bar.scrollLeft + bar.clientWidth) bar.scrollTo({ left: right - bar.clientWidth, behavior: noMotion ? 'auto' : 'smooth' });
}
function moveTabIndicators() { Array.prototype.forEach.call(document.querySelectorAll('.tab-slide'), moveTabIndicator); }
function showSettingsTab(name) {
  if (!document.querySelector('.set-group[data-set="' + name + '"]')) name = 'algemeen';
  // de inhoud komt binnen vanaf de kant waar je naartoe gaat
  var order = Array.prototype.map.call(document.querySelectorAll('#settings-tabs .tab'), function(t) { return t.dataset.set; });
  var current = document.querySelector('#settings-tabs .tab.active');
  var from = current ? order.indexOf(current.dataset.set) : -1, to = order.indexOf(name);
  document.getElementById('screen-5').style.setProperty('--set-dir', to < from ? -1 : 1);
  document.querySelectorAll('#screen-5 [data-set]').forEach(function(el) { el.classList.toggle('active', el.dataset.set === name); });
  document.querySelectorAll('#settings-tabs .tab').forEach(function(t) { t.setAttribute('aria-selected', t.dataset.set === name); });
  moveTabIndicators();
  try { localStorage.setItem('vh-settings-tab', name); } catch (e) {}
}
window.addEventListener('resize', moveTabIndicators);
// het lettertype komt soms later binnen dan deze code; de tabbladen zijn dan net iets breder geworden
if (document.fonts && document.fonts.ready) document.fonts.ready.then(moveTabIndicators);
try { showSettingsTab(localStorage.getItem('vh-settings-tab') || 'algemeen'); } catch (e) {}

// ── Modules ──
function loadModules() {
  fetch('/api/modules').then(function(r){return r.json();}).then(function(list) {
    var el = document.getElementById('settings-modules');
    if (!el) return;
    function row(label, hint, sw) { return '<div class="setting-row"><div class="setting-text"><div class="setting-title">' + label + '</div><div class="setting-desc">' + hint + '</div></div>' + sw + '</div>'; }
    el.innerHTML = '<div class="setting-card">' +
      row('Stroom (P1-meter)', 'De basis van de app, staat altijd aan', '<span class="mod-switch on locked"></span>') +
      list.map(function(m) {
        return row(m.label, m.hint, '<button class="mod-switch' + (m.enabled ? ' on' : '') + '" role="switch" aria-checked="' + m.enabled + '" aria-label="' + m.label + '" data-key="' + m.key + '" onclick="toggleModule(this)"></button>');
      }).join('') + '</div>';
  }).catch(function(){});
}
// Past de modules toe op de open pagina: klassen op body, Home-blokken en de kostengrafiek
function applyModules() {
  Object.keys(MODULES).forEach(function(k) { document.body.classList.toggle('mod-off-' + k, !moduleOn(k)); });
  document.body.classList.toggle('mod-off-thuis', !['lights','fridge','esphome','temperature','wasmachine','vaatwasser'].some(moduleOn));
  applyLayout(0);
  moveTabIndicators();
  if (screenLoaded[1]) loadCostsDaily();
}
function toggleModule(btn) {
  var enabled = !btn.classList.contains('on');
  function show(on) { btn.classList.toggle('on', on); btn.setAttribute('aria-checked', on); }
  show(enabled); // meteen omzetten; bij een fout gaat hij terug
  btn.disabled = true;
  fetch('/api/modules', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({key: btn.dataset.key, enabled: enabled})})
    .then(function(r){return r.json();}).then(function(d) {
      btn.disabled = false;
      if (!d.ok) { show(!enabled); toast(d.error || 'Module omzetten lukte niet', 'error'); return; }
      MODULES = d.modules;
      applyModules();
    }).catch(function() { btn.disabled = false; show(!enabled); toast('Module omzetten lukte niet', 'error'); });
}

// ── Apparaatstatus ──
function loadDeviceStatus() {
  fetch('/api/monitor').then(function(r){return r.json();}).then(function(list) {
    var el = document.getElementById('settings-device-status');
    if (!el) return;
    if (!list.length) { el.innerHTML = '<div class="setting-card"><div class="empty-note">Nog geen apparaten gezien</div></div>'; return; }
    el.innerHTML = '<div class="setting-card">' + list.map(function(d) {
      var when = d.last_seen ? d.last_seen.slice(8, 10) + '-' + d.last_seen.slice(5, 7) + ' ' + d.last_seen.slice(11, 16) : 'nog niet gezien';
      return '<div class="setting-row"><span class="status-dot ' + (d.online ? 'on' : 'off') + '"></span>' +
        '<div class="setting-text"><div class="setting-title">' + escHtml(d.name) + '</div>' +
        '<div class="setting-desc">Laatste bericht: ' + when + ' · ' + (d.notify ? 'melding na ' + d.limit_min + ' min stilte' : 'geen melding') + '</div></div>' +
        '<span class="status-word ' + (d.online ? 'on' : 'off') + '">' + (d.online ? 'Online' : 'Offline') + '</span>' +
        '<button class="mod-switch' + (d.notify ? ' on' : '') + '" role="switch" aria-checked="' + d.notify + '" aria-label="Melding als ' + escHtml(d.name) + ' offline gaat" title="Melding bij offline" data-key="' + escHtml(d.key) + '" onclick="toggleDeviceNotify(this)"></button></div>';
    }).join('') + '</div>';
  }).catch(function(){});
}
function toggleDeviceNotify(btn) {
  var on = !btn.classList.contains('on');
  btn.disabled = true;
  fetch('/api/monitor/notify', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({key: btn.dataset.key, notify: on})})
    .then(loadDeviceStatus).catch(function() { toast('Instelling opslaan lukte niet', 'error'); loadDeviceStatus(); });
}

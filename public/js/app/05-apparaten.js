// Apparaat- en koppeling-UI (Instellingen). Opgesplitst in 05 / 05b / 05c voor overzicht;
// alle delen komen in dezelfde app.js-bundle (zie routes/pages.js), dus functies zijn gedeeld.
// ── Koelkast ──
function fridgeSkeleton() {
  return '<div class="chart-title">Koelkast</div><div class="fridge-row"><span class="skel-line grow tall"></span><span class="skel-line grow tall"></span></div><div class="power-sub">&nbsp;</div>';
}
function fridgeHtml(d) {
  // Uniforme sensorkaart-opmaak (binnen de bestaande .card.fridge-card container)
  function head(status) { return '<div class="sensor-head"><i class="fa-solid fa-snowflake"></i><span class="sensor-name"><span class="sensor-name-text">Koelkast</span></span><span class="sensor-status">' + status + '</span></div>'; }
  if (!d.configured) return head('') + '<div class="fridge-msg">Nog niet gekoppeld. Zet de databasegegevens op de server (zie <code>services/fridge.js</code>).</div>';
  if (!d.ok) return head('') + '<div class="fridge-msg">' + escHtml(d.error || 'Niet bereikbaar') + '</div>';
  if (!d.compartments.length) return head('') + '<div class="fridge-msg">Nog geen metingen</div>';
  var age = d.updated ? Math.round((Date.now() - new Date(d.updated).getTime()) / 60000) : null;
  var ageText = age == null ? '' : age < 1 ? 'zojuist' : age < 60 ? age + ' min geleden' : age < 2880 ? Math.round(age / 60) + ' uur geleden' : Math.round(age / 1440) + ' dagen geleden';
  function deg(v) { return v != null ? nlNum(v, v % 1 ? 1 : 0) + '°' : '—'; }
  // warmer dan ingesteld valt op: 3 graden of meer boven de ingestelde temperatuur
  function isWarm(c) { return c.temp != null && c.setpoint != null && c.temp - c.setpoint >= 3; }
  var anyWarm = d.compartments.some(isWarm);
  var badge = anyWarm
    ? '<span class="wash-status-pill sensor-badge warm"><i class="fa-solid fa-triangle-exclamation"></i> Te warm</span>'
    : '<span class="wash-status-pill sensor-badge cool"><i class="fa-solid fa-snowflake"></i> Koud</span>';
  var values = d.compartments.map(function(c) {
    return '<span class="sensor-value' + (isWarm(c) ? ' warm' : '') + '">' + escHtml(c.label) + ' ' + deg(c.temp) + '</span>';
  }).join('<span class="sensor-sep">·</span>');
  var sub = [];
  if (ageText) sub.push(ageText);
  if (d.environment && d.environment.temp != null) sub.push('omgeving ' + deg(d.environment.temp));
  if (d.environment && d.environment.humidity != null) sub.push('vocht ' + nlNum(d.environment.humidity, 0) + '%');
  return head(badge) + '<div class="sensor-values">' + values + '</div>' + (sub.length ? '<div class="sensor-subline">' + escHtml(sub.join(' · ')) + '</div>' : '');
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
// Vaatwasser als minimale uniforme kaart: statusbadge + programma/resterend. Geen tijdreeks → geen
// grafiek. Waarschuwingen (deur open, zout, enz.) blijven zichtbaar als los regeltje met wis-knop.
function dishClearAlerts(btn) {
  if (btn) btn.disabled = true;
  fetch('/api/vaatwasser/alerts/clear', { method: 'POST' }).then(function() { refreshVaatwasser(); }).catch(actionFailed('Wissen lukte niet'));
}
// Statistiek-inhoud voor het uitklapmenu van de vaatwasserkaart (week/maand/duur + recente beurten).
function dishStatsHtml(s) {
  if (!s) return '';
  function pct(v) { return v != null ? Math.round(v) + '%' : '—'; }
  var grid = '<div class="fridge-row">' +
    '<div class="fridge-cell"><div class="fridge-label">Week</div><div class="fridge-temp">' + (s.this_week || 0) + '</div></div>' +
    '<div class="fridge-cell"><div class="fridge-label">Maand</div><div class="fridge-temp">' + (s.this_month || 0) + '</div></div>' +
    '<div class="fridge-cell"><div class="fridge-label">Gem. duur</div><div class="fridge-temp">' + dishDuration(s.avg_duration) + '</div></div>' +
    '<div class="fridge-cell"><div class="fridge-label">Meest gebruikt</div><div class="fridge-temp">' + (s.programs && s.programs.length ? dishProgram(s.programs[0].program) : '—') + '</div></div></div>';
  var forecast = (s.avg_energy != null ? 'gem. energie ' + Math.round(s.avg_energy) + '% · water ' + Math.round(s.avg_water) + '%' : '') +
    (s.avg_kwh != null ? ' · ±' + num(s.avg_kwh, 2) + ' kWh' + (s.avg_cost != null ? ' (' + eur(s.avg_cost) + ')' : '') + ' per beurt' : '');
  var rowsHtml = (s.recent && s.recent.length) ? s.recent.map(function(r) {
    var extras = (r.options || '').split(',').filter(Boolean).map(function(x) { return (s.extras && s.extras[x]) || x; }).join(', ');
    return '<tr><td>' + shortWhen(r.finished_at) + '</td><td>' + dishProgram(r.program) + (extras ? '<span class="esp-sub"> · ' + escHtml(extras) + '</span>' : '') + '</td><td>' + dishDuration(r.duration_min) + '</td><td>' + pct(r.energy_pct) + '</td><td>' + pct(r.water_pct) + '</td><td>' + (r.est_kwh != null ? '±' + num(r.est_kwh, 2) + ' kWh' + (r.est_cost != null ? ' · ' + eur(r.est_cost) : '') : '—') + '</td></tr>';
  }).join('') : '<tr><td colspan="6" class="table-empty">Nog geen beurten gelogd</td></tr>';
  return grid + '<div class="log-card"><div class="log-header"><span class="section-title">Recente vaatwasbeurten</span>' + (forecast ? '<span class="power-sub">' + forecast + '</span>' : '') + '</div>' +
    '<div class="log-table-wrap"><table class="log-table"><thead><tr><th>Klaar</th><th>Programma</th><th>Duur</th><th>Energie</th><th>Water</th><th>Stroom</th></tr></thead><tbody>' + rowsHtml + '</tbody></table></div></div>';
}
function refreshVaatwasser() {
  var grid = document.getElementById('dish-grid');
  Promise.all([
    fetch('/api/vaatwasser').then(function(r){return r.json();}).catch(function(){return {};}),
    fetch('/api/vaatwasser/stats').then(function(r){return r.json();}).catch(function(){return {};})
  ]).then(function(res) {
    var d = res[0] || {}, stats = res[1] || {};
    if (!grid) return;
    var s = d.state || {};
    var view = !d.linked ? ['idle','fa-link-slash','Niet gekoppeld'] : s.reachable === false ? ['idle','fa-plug-circle-xmark','Offline'] : DISH_STATES[s.operation] || ['idle','fa-moon', s.operation || 'Onbekend'];
    var running = s.operation === 'Run' || s.operation === 'Pause';
    var badge = { cls: running || s.operation === 'Finished' ? 'busy' : 'idle', icon: view[1], text: view[2] };
    var mins = s.finishAt ? Math.max(0, Math.round((s.finishAt - Date.now()) / 60000)) : null;
    var values = [];
    if (running && mins != null) values.push(dishDuration(mins) + ' resterend');
    values.push(dishProgram(s.program));
    var sub = !d.linked ? 'Koppel bij Instellingen'
      : running && s.finishAt ? 'klaar om ' + shortWhen(s.finishAt)
      : d.lastFinished ? 'Laatste: ' + shortWhen(d.lastFinished) : '';
    var alerts = d.alerts || [];
    var controls = alerts.length
      ? '<div class="sensor-alerts">' + alerts.map(function(a) { return '<span class="hour-exp"><i class="fa-solid fa-triangle-exclamation"></i> ' + escHtml(a) + '</span>'; }).join('') +
        '<button class="btn btn-quiet btn-sm" title="Meldingen wissen" onclick="dishClearAlerts(this)"><i class="fa-solid fa-check"></i> Wissen</button></div>'
      : '';
    var cfg = {
      id: 'dish', icon: 'fa-soap', name: 'Vaatwasser', badge: badge, values: values, sub: sub, controls: controls,
      expand: dishStatsHtml(stats),
      sig: values.join(',') + '|' + badge.text + '|' + alerts.join('~') + '|' + (stats.this_week || 0) + '/' + (stats.this_month || 0) + '/' + ((stats.recent && stats.recent.length) || 0)
    };
    paintSensorGrid(grid, [cfg]);
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


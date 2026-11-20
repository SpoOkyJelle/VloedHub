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

// ── Verwarming (tado) ──
var tadoData = null;          // laatste status, zodat de knoppen de huidige ingestelde temp weten
var tadoBusy = {};            // zones met een lopende opdracht; dan niet verversen zodat de stand niet terugspringt
var tadoLinkTimer = null;
function tadoFindZone(id) { return (tadoData && tadoData.zones || []).filter(function(z) { return z.id === id; })[0]; }
function tadoDeg(v) { return v != null ? nlNum(v, v % 1 ? 1 : 0) + '°' : '—'; }
// tado-zone als uniforme sensorkaart: verwarm-badge + huidige temp/vocht + uitklapbare grafiek, met de
// bestaande +/- / aan-uit / schema-bediening behouden als kaart-controls.
function tadoZoneCfg(z) {
  var off = z.power === 'OFF';
  var dis = z.online ? '' : ' disabled';
  var badge = !z.online ? { cls: 'off', icon: 'fa-plug-circle-xmark', text: 'Offline' }
    : z.heatingPower > 0 ? { cls: 'warm', icon: 'fa-fire', text: 'Verwarmt ' + Math.round(z.heatingPower) + '%' }
    : { cls: 'idle', icon: 'fa-snowflake', text: 'Uit' };
  var values = [tadoDeg(z.temperature)];
  if (z.humidity != null) values.push(Math.round(z.humidity) + ' %');
  var sub = [];
  if (z.openWindow) sub.push('<i class="fa-solid fa-window-maximize"></i> raam open');
  sub.push(z.overlay ? 'handmatig' : 'schema');
  var controls = '<div class="tado-sub">' + sub.join(' · ') + '</div>' +
    '<div class="tado-controls">' +
      '<button class="tado-step" aria-label="Lager" onclick="tadoStep(' + z.id + ',-0.5)"' + dis + '>−</button>' +
      '<span class="tado-setpoint' + (off ? ' off' : '') + '">' + (off ? 'Uit' : tadoDeg(z.setpoint)) + '</span>' +
      '<button class="tado-step" aria-label="Hoger" onclick="tadoStep(' + z.id + ',0.5)"' + dis + '>+</button>' +
      '<button class="btn btn-quiet btn-sm tado-mode" onclick="' + (off ? 'tadoStep(' + z.id + ',0.5)' : 'tadoOff(' + z.id + ')') + '"' + dis + '>' + (off ? 'Aan' : 'Uit') + '</button>' +
      (z.overlay ? '<button class="btn btn-quiet btn-sm" onclick="tadoAuto(' + z.id + ')"' + dis + '>Schema</button>' : '') +
    '</div>';
  var series = [{ field: 'avg_temp', unit: '°C', color: '#F97316', decimals: 1, label: 'Temp', axis: 'y' }];
  if (z.humidity != null) series.push({ field: 'avg_humidity', unit: '%', color: '#2DD4BF', decimals: 0, label: 'Vocht', axis: 'y1' });
  return {
    id: 'tado-zone-' + z.id, icon: 'fa-temperature-arrow-up', name: z.name,
    badge: badge, values: values, controls: controls,
    sig: values.join(',') + '|' + badge.text + '|' + (off ? 'off' : tadoDeg(z.setpoint)) + '|' + z.overlay + '|' + dis,
    chart: { url: '/api/temperature/history', key: 'room', val: z.name, series: series }
  };
}
function tadoAgo(ms) {
  if (!ms) return '';
  var min = Math.round((Date.now() - ms) / 60000);
  return min < 1 ? 'zojuist bijgewerkt' : min < 60 ? 'bijgewerkt ' + min + ' min geleden' : 'bijgewerkt ' + Math.round(min / 60) + ' uur geleden';
}
function renderTado(d) {
  tadoData = d;
  var grid = document.getElementById('tado-zones');
  if (grid) {
    if (!d.linked) { grid._sig = 'nolink'; grid.innerHTML = '<div class="card fridge-card"><div class="fridge-msg">Nog niet gekoppeld — koppel bij Instellingen → Koppelingen</div></div>'; }
    else if (!d.zones || !d.zones.length) { grid._sig = 'nozones'; grid.innerHTML = '<div class="card fridge-card"><div class="fridge-msg">' + escHtml(d.error || 'Nog geen kamers ontvangen…') + '</div></div>'; }
    else {
      var shown = d.zones.filter(function(z) { return z.view !== 'home' && z.view !== 'hidden'; });
      if (!shown.length) { grid._sig = 'nohidden'; grid.innerHTML = '<div class="card fridge-card"><div class="fridge-msg">Alle kamers staan ingesteld om hier niet te tonen (zie Instellingen).</div></div>'; }
      else paintSensorGrid(grid, shown.map(tadoZoneCfg));
    }
  }
  buildTadoExtra(d);
  var meta = document.getElementById('tado-meta');
  if (meta) {
    if (d.linked && d.zones && d.zones.length) {
      meta.innerHTML = '<span>' + escHtml(tadoAgo(d.updated)) + '</span>';
    } else meta.innerHTML = '';
  }
  showTadoStatus(d);
}
function refreshTado() {
  if (!document.getElementById('tado-zones') && !document.getElementById('tado-status')) return;
  if (Object.keys(tadoBusy).length) return; // niet verversen terwijl een opdracht loopt
  fetch('/api/tado').then(function(r){return r.json();}).then(renderTado).catch(function(){});
}
function tadoStep(id, delta) {
  var z = tadoFindZone(id);
  var cur = z && z.setpoint != null ? z.setpoint : 20; // uit of onbekend: aanzetten op een redelijke standaard
  var min = (tadoData && tadoData.minSet) || 5, max = (tadoData && tadoData.maxSet) || 25;
  var next = Math.max(min, Math.min(max, Math.round((cur + delta) * 2) / 2));
  tadoPost('zone/set', { zoneId: id, temperature: next });
}
function tadoOff(id) { tadoPost('zone/set', { zoneId: id, power: 'OFF' }); }
function tadoAuto(id) { tadoPost('zone/auto', { zoneId: id }); }
function tadoPost(pathPart, body) {
  tadoBusy[body.zoneId] = true;
  fetch('/api/tado/' + pathPart, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)})
    .then(function(r){return r.json();}).then(function(d) {
      delete tadoBusy[body.zoneId];
      if (!d.ok) toast(d.error || 'tado: instellen mislukt', 'error');
      renderTado(d);
    }).catch(function() { delete tadoBusy[body.zoneId]; toast('tado: verbindingsfout', 'error'); refreshTado(); });
}
function showTadoStatus(d) {
  var el = document.getElementById('tado-status');
  if (!el) return;
  el.style.color = d.error ? 'var(--red)' : d.linked ? 'var(--green)' : '';
  el.textContent = d.error ? d.error
    : d.linked ? 'Gekoppeld' + (d.homeName ? ' met ' + d.homeName : '') + (d.zones && d.zones.length ? ' · ' + d.zones.length + ' zone(s)' : '')
    : d.pending ? 'Wacht op goedkeuring…'
    : 'Nog niet gekoppeld. Klik op Koppelen en keur VloedHub goed op de tado-pagina.';
  var pend = document.getElementById('tado-pending');
  if (pend) {
    pend.textContent = '';
    if (d.pending) {
      var a = document.createElement('a');
      a.href = d.pending.url; a.target = '_blank'; a.rel = 'noopener'; a.className = 'btn btn-primary';
      a.textContent = 'Open tado';
      var code = document.createElement('span');
      code.className = 'power-sub';
      code.textContent = 'Log in en keur de koppeling goed. Code: ' + d.pending.user_code;
      pend.appendChild(a); pend.appendChild(code);
    }
  }
  var btn = document.getElementById('tado-link-btn');
  if (btn) {
    btn.textContent = d.linked ? 'Ontkoppelen' : 'Koppelen';
    btn.onclick = d.linked ? unlinkTado : linkTado;
    btn.disabled = !!d.pending;
  }
  var frost = document.getElementById('tado-frost');
  if (frost && document.activeElement !== frost && d.frostThreshold != null) frost.value = d.frostThreshold;
  var pollEl = document.getElementById('tado-poll');
  if (pollEl && document.activeElement !== pollEl && d.pollMinutes != null) pollEl.value = d.pollMinutes;
  var presEl = document.getElementById('tado-presence');
  if (presEl && document.activeElement !== presEl && d.presenceSeconds != null) presEl.value = d.presenceSeconds;
  var budget = document.getElementById('tado-budget');
  if (budget) {
    // ruwe schatting: één verzoek per kamer-poll + één per locatie-poll, over een hele dag
    var perDay = (d.pollMinutes ? Math.round(1440 / d.pollMinutes) : 0) + (d.presenceSeconds ? Math.round(86400 / d.presenceSeconds) : 0);
    budget.textContent = perDay ? '±' + perDay + ' verzoeken/dag — gratis plan geeft ±100/dag, Auto-Assist/AI Assist ±20.000/dag.' : '';
  }
  clearTimeout(tadoLinkTimer);
  if (d.pending) tadoLinkTimer = setTimeout(refreshTado, 3000);
}
function buildTadoExtra(d) {
  var el = document.getElementById('tado-extra');
  if (!el) return;
  if (!d.linked) { el.innerHTML = ''; return; }
  var html = '';
  if (d.homes && d.homes.length > 1) {
    html += '<div class="setting-row"><div class="setting-text"><div class="setting-title">Huis</div><div class="setting-desc">Je account heeft meerdere huizen</div></div>' +
      '<select class="field" aria-label="Huis" onchange="setTadoHome(this)">' +
      d.homes.map(function(h) { return '<option value="' + escHtml(String(h.id)) + '"' + (h.id === d.homeId ? ' selected' : '') + '>' + escHtml(h.name) + '</option>'; }).join('') +
      '</select></div>';
  }
  if (d.zones && d.zones.length) {
    var opts = [['both', 'Overal'], ['thuis', 'Alleen Thuis'], ['home', 'Alleen Home-blok'], ['hidden', 'Verbergen']];
    html += '<div class="setting-row setting-row-wrap"><div class="setting-text"><div class="setting-title">Kamers tonen</div><div class="setting-desc">Kies per kamer waar hij verschijnt op het dashboard</div></div></div>' +
      '<div class="tado-rooms">' + d.zones.map(function(z) {
        return '<div class="tado-room-row"><span>' + escHtml(z.name) + '</span>' +
          '<select class="field" data-zone="' + escHtml(String(z.id)) + '" aria-label="Zichtbaarheid ' + escHtml(z.name) + '" onchange="setTadoRoomView(this)">' +
          opts.map(function(o) { return '<option value="' + o[0] + '"' + ((z.view || 'both') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') +
          '</select></div>';
      }).join('') + '</div>';
  }
  el.innerHTML = html;
}
function setTadoHome(sel) {
  sel.disabled = true;
  fetch('/api/tado/home', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({id: sel.value})})
    .then(function(r){return r.json();}).then(function(d) {
      if (!d.ok) toast(d.error || 'Huis wisselen mislukt', 'error');
      renderTado(d);
      setTimeout(refreshTado, 2500); // het nieuwe huis wordt op de achtergrond opgehaald
    }).catch(function() { sel.disabled = false; toast('tado: verbindingsfout', 'error'); });
}
function setTadoRoomView(sel) {
  fetch('/api/tado/room-view', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({zoneId: sel.dataset.zone, view: sel.value})})
    .then(function(r){return r.json();}).then(function(d) {
      if (!d.ok) toast(d.error || 'Opslaan mislukt', 'error');
      renderTado(d);
    }).catch(function() { toast('tado: verbindingsfout', 'error'); });
}
function loadTadoStatus() { refreshTado(); }
function refreshTadoNow(btn) {
  if (btn) btn.disabled = true;
  fetch('/api/tado/refresh', {method:'POST'}).then(function(r){return r.json();}).then(function(d) {
    if (!d.ok && d.error) toast(d.error, 'error');
    renderTado(d);
  }).catch(function() { if (btn) btn.disabled = false; toast('tado: verbindingsfout', 'error'); });
}
function saveTadoPoll(btn) {
  var input = document.getElementById('tado-poll');
  btn.disabled = true;
  fetch('/api/tado/poll-interval', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({minutes: input.value})})
    .then(function(r){return r.json();}).then(function(d) {
      btn.disabled = false;
      if (!d.ok) { toast(d.error || 'Opslaan mislukt', 'error'); return; }
      toast('Ververssnelheid opgeslagen', 'ok');
      renderTado(d);
    }).catch(function() { btn.disabled = false; toast('tado: verbindingsfout', 'error'); });
}
function saveTadoPresence(btn) {
  var input = document.getElementById('tado-presence');
  btn.disabled = true;
  fetch('/api/tado/presence-interval', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({seconds: input.value})})
    .then(function(r){return r.json();}).then(function(d) {
      btn.disabled = false;
      if (!d.ok) { toast(d.error || 'Opslaan mislukt', 'error'); return; }
      toast('Ververssnelheid locatie opgeslagen', 'ok');
      renderTado(d);
    }).catch(function() { btn.disabled = false; toast('tado: verbindingsfout', 'error'); });
}
function linkTado() {
  var btn = document.getElementById('tado-link-btn'); if (btn) btn.disabled = true;
  fetch('/api/tado/link', {method:'POST'}).then(function(r){return r.json();}).then(function(d) {
    if (!d.ok && d.error) toast(d.error, 'error');
    renderTado(d);
  }).catch(function() { if (btn) btn.disabled = false; toast('tado: verbindingsfout', 'error'); });
}
function unlinkTado() {
  fetch('/api/tado/unlink', {method:'POST'}).then(function(r){return r.json();}).then(renderTado).catch(function(){});
}
function saveTadoFrost(btn) {
  var input = document.getElementById('tado-frost');
  btn.disabled = true;
  fetch('/api/tado/frost', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({threshold: input.value})})
    .then(function(r){return r.json();}).then(function(d) {
      btn.disabled = false;
      if (!d.ok) { toast(d.error || 'Opslaan mislukt', 'error'); return; }
      toast('Vorstgrens opgeslagen', 'ok');
      renderTado(d);
    }).catch(function() { btn.disabled = false; toast('tado: verbindingsfout', 'error'); });
}

// ── Tapo (TP-Link) ──
var tapoData = null;
function tapoAgo(ms) {
  if (!ms) return 'nog niet opgehaald';
  var s = Math.round((Date.now() - ms) / 1000);
  return s < 60 ? 'zojuist' : s < 3600 ? Math.round(s / 60) + ' min geleden' : Math.round(s / 3600) + ' uur geleden';
}
function renderTapo(d) {
  if (!d) return;
  tapoData = d;
  var st = document.getElementById('tapo-status');
  if (st) st.textContent = !d.linked ? 'Nog niet gekoppeld. Vul je Tapo e-mail en wachtwoord in en klik op Koppelen.'
    : !d.configured ? 'Gekoppeld — vul nog de IP-adressen van de hub en/of stekker in.'
    : 'Gekoppeld.';
  var btn = document.getElementById('tapo-link-btn');
  if (btn) { btn.disabled = false; btn.textContent = d.linked ? 'Opnieuw koppelen' : 'Koppelen'; }
  var hubIp = document.getElementById('tapo-hub-ip');
  if (hubIp && document.activeElement !== hubIp) hubIp.value = d.hubIp || '';
  var plugIp = document.getElementById('tapo-plug-ip');
  if (plugIp && document.activeElement !== plugIp) plugIp.value = d.plugIp || '';
  var room = document.getElementById('tapo-room');
  if (room && document.activeElement !== room) room.value = d.roomName || '';
  var poll = document.getElementById('tapo-poll');
  if (poll && document.activeElement !== poll) poll.value = d.pollMinutes || '';
  var sh = d.shower || {};
  function setShV(id, v) { var el = document.getElementById(id); if (el && document.activeElement !== el && v != null) el.value = v; }
  setShV('tapo-shower-high', sh.high); setShV('tapo-shower-rise', sh.rise);
  setShV('tapo-shower-release', sh.release); setShV('tapo-shower-cooldown', sh.cooldownMin);
  var shNow = document.getElementById('tapo-shower-now');
  if (shNow && sh.high != null) shNow.textContent = 'Nu: melden bij ≥' + sh.high + '% of een stijging van +' + sh.rise + 'pp, weer rustig onder ' + sh.release + '%, meld-pauze ' + sh.cooldownMin + ' min.';
  var ex = document.getElementById('tapo-extra');
  if (!ex) return;
  if (!d.linked) { ex.innerHTML = ''; return; }
  var rows = [];
  if (d.plug) rows.push('<div class="setting-desc">Stekker <b>' + escHtml(d.plug.name || '') + '</b>: ' + nlNum(d.plug.watts, 1) + ' W · wasmachine: ' + escHtml(d.washState || 'idle') + '</div>');
  if (d.t310) rows.push('<div class="setting-desc">Sensor <b>' + escHtml(d.t310.name || '') + '</b>: ' + (d.t310.temp != null ? nlNum(d.t310.temp, 1) + '°' : '—') + ' · ' + (d.t310.humidity != null ? d.t310.humidity + '%' : '—') + (d.showerActive ? ' · 🚿 doucht' : '') + '</div>');
  if (d.devices && d.devices.length) rows.push('<div class="setting-desc">Gevonden: ' + d.devices.map(function(x) { return escHtml(x.name || x.model || '?') + ' (' + escHtml(x.model || x.type || '') + ')'; }).join(', ') + '</div>');
  if (d.error) rows.push('<div class="setting-desc">⚠️ ' + escHtml(String(d.error)) + '</div>');
  if (d.raw && Object.keys(d.raw).length) rows.push('<div class="setting-desc">Ruwe uitlezing — ' + Object.keys(d.raw).map(function(k) { return escHtml(k) + ': ' + escHtml(String(d.raw[k])); }).join(' · ') + '</div>');
  rows.push('<div class="tado-meta"><span>' + escHtml(tapoAgo(d.updated)) + '</span>' +
    '<button class="btn btn-quiet btn-sm" onclick="refreshTapoNow(this)"><i class="fa-solid fa-rotate"></i> Ververs nu</button>' +
    '<button class="btn btn-ghost btn-sm" onclick="unlinkTapo()">Ontkoppelen</button></div>');
  ex.innerHTML = rows.join('');
}
function refreshTapo() {
  if (!document.getElementById('tapo-status')) return;
  fetch('/api/tapo').then(function(r){return r.json();}).then(renderTapo).catch(function(){});
}
function loadTapoStatus() { refreshTapo(); }
function exportTapoData() {
  var sel = document.getElementById('tapo-export-days');
  var days = sel ? sel.value : '7';
  window.location.href = '/api/tapo/export?days=' + encodeURIComponent(days);
}
function testTapoBell(btn) {
  var tone = (document.getElementById('tapo-bell-tone') || {}).value || '';
  var volume = (document.getElementById('tapo-bell-volume') || {}).value || 'normal';
  var duration = parseInt((document.getElementById('tapo-bell-duration') || {}).value, 10) || 5;
  var orig = btn ? btn.textContent : '';
  if (btn) btn.disabled = true;
  fetch('/api/tapo/alarm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tone: tone, volume: volume, duration: duration }) })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (btn) { btn.disabled = false; if (!d.ok) { btn.textContent = 'Mislukt'; setTimeout(function() { btn.textContent = orig; }, 2000); } }
    })
    .catch(function() { if (btn) { btn.disabled = false; btn.textContent = 'Mislukt'; setTimeout(function() { btn.textContent = orig; }, 2000); } });
}
function stopTapoBell(btn) {
  if (btn) btn.disabled = true;
  fetch('/api/tapo/alarm/stop', { method: 'POST' })
    .then(function(r) { return r.json(); })
    .then(function() { if (btn) btn.disabled = false; })
    .catch(function() { if (btn) btn.disabled = false; });
}
function saveTapoCreds(btn) {
  var email = document.getElementById('tapo-email'), pw = document.getElementById('tapo-password');
  if (!email.value || !pw.value) { toast('Vul je Tapo e-mail en wachtwoord in', 'error'); return; }
  if (btn) btn.disabled = true;
  fetch('/api/tapo/credentials', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({email: email.value, password: pw.value})})
    .then(function(r){return r.json();}).then(function(d) {
      if (btn) btn.disabled = false;
      if (!d.ok) { toast(d.error || 'Koppelen mislukt', 'error'); return; }
      pw.value = '';
      toast('Gekoppeld — gegevens worden opgehaald…', 'ok');
      renderTapo(d);
      setTimeout(refreshTapo, 4000); // even wachten tot de eerste uitlezing binnen is
    }).catch(function() { if (btn) btn.disabled = false; toast('Tapo: verbindingsfout', 'error'); });
}
function refreshTapoNow(btn) {
  if (btn) btn.disabled = true;
  fetch('/api/tapo/refresh', {method:'POST'}).then(function(r){return r.json();}).then(function(d) {
    if (!d.ok && d.error) toast(d.error, 'error');
    renderTapo(d);
  }).catch(function() { if (btn) btn.disabled = false; toast('Tapo: verbindingsfout', 'error'); });
}
function unlinkTapo() {
  fetch('/api/tapo/unlink', {method:'POST'}).then(function(r){return r.json();}).then(renderTapo).catch(function(){});
}
function saveTapoIps(btn) {
  var hub = document.getElementById('tapo-hub-ip'), plug = document.getElementById('tapo-plug-ip');
  btn.disabled = true;
  fetch('/api/tapo/devices', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({hubIp: hub.value.trim(), plugIp: plug.value.trim()})})
    .then(function(r){return r.json();}).then(function(d) {
      btn.disabled = false;
      if (!d.ok) { toast(d.error || 'Opslaan mislukt', 'error'); return; }
      toast('IP-adressen opgeslagen — uitlezen gestart…', 'ok');
      renderTapo(d);
      setTimeout(refreshTapo, 4000);
    }).catch(function() { btn.disabled = false; toast('Tapo: verbindingsfout', 'error'); });
}
function saveTapoShower(btn) {
  var body = {
    high: (document.getElementById('tapo-shower-high') || {}).value,
    rise: (document.getElementById('tapo-shower-rise') || {}).value,
    release: (document.getElementById('tapo-shower-release') || {}).value,
    cooldownMin: (document.getElementById('tapo-shower-cooldown') || {}).value
  };
  btn.disabled = true;
  fetch('/api/tapo/shower', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)})
    .then(function(r){return r.json();}).then(function(d) {
      btn.disabled = false;
      if (!d.ok) { toast(d.error || 'Opslaan mislukt', 'error'); return; }
      toast('Douche-detectie opgeslagen', 'ok');
      renderTapo(d);
    }).catch(function() { btn.disabled = false; toast('Tapo: verbindingsfout', 'error'); });
}
function saveTapoRoom(btn) {
  var input = document.getElementById('tapo-room');
  btn.disabled = true;
  fetch('/api/tapo/room', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({room: input.value})})
    .then(function(r){return r.json();}).then(function(d) {
      btn.disabled = false;
      if (!d.ok) { toast(d.error || 'Opslaan mislukt', 'error'); return; }
      toast('Kamernaam opgeslagen', 'ok');
      renderTapo(d);
    }).catch(function() { btn.disabled = false; toast('Tapo: verbindingsfout', 'error'); });
}
function saveTapoPoll(btn) {
  var input = document.getElementById('tapo-poll');
  btn.disabled = true;
  fetch('/api/tapo/poll-interval', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({minutes: input.value})})
    .then(function(r){return r.json();}).then(function(d) {
      btn.disabled = false;
      if (!d.ok) { toast(d.error || 'Opslaan mislukt', 'error'); return; }
      toast('Ververssnelheid opgeslagen', 'ok');
      renderTapo(d);
    }).catch(function() { btn.disabled = false; toast('Tapo: verbindingsfout', 'error'); });
}

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
  var group = document.querySelector('.set-group[data-set="' + name + '"]');
  if (!group || (group.hasAttribute('data-admin') && document.body.classList.contains('not-admin'))) name = 'algemeen';
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
  document.body.classList.toggle('mod-off-thuis', !['lights','fridge','esphome','temperature','wasmachine','vaatwasser','tado'].some(moduleOn));
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

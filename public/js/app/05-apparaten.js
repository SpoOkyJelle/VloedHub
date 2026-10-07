// ── Koelkast ──
function fridgeSkeleton() {
  return '<div class="chart-title">Koelkast</div><div class="fridge-row"><span class="skel-line" style="flex:1;height:2.6rem"></span><span class="skel-line" style="flex:1;height:2.6rem"></span></div><div class="power-sub">&nbsp;</div>';
}
function fridgeHtml(d) {
  var head = '<div class="chart-header"><span class="chart-title"><i class="fa-solid fa-snowflake" style="color:var(--blue);margin-right:0.4rem"></i>Koelkast</span>';
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
  el.style.color = 'var(--dim)';
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
    setEl('dish-avg-forecast', s.avg_energy != null ? 'gem. energie ' + Math.round(s.avg_energy) + '% · water ' + Math.round(s.avg_water) + '%' : '');
    function pct(v) { return v != null ? Math.round(v) + '%' : '—'; }
    setEl('dish-rows', s.recent.length ? s.recent.map(function(r) {
      var extras = (r.options || '').split(',').filter(Boolean).map(function(x) { return s.extras[x] || x; }).join(', ');
      return '<tr><td>' + shortWhen(r.finished_at) + '</td><td>' + dishProgram(r.program) + (extras ? '<span class="esp-sub"> · ' + extras + '</span>' : '') + '</td><td>' + dishDuration(r.duration_min) + '</td><td>' + pct(r.energy_pct) + '</td><td>' + pct(r.water_pct) + '</td></tr>';
    }).join('') : '<tr><td colspan="5" style="color:var(--dim);padding:0.3rem 0.85rem">Nog geen beurten gelogd — vanaf nu wordt elke beurt bijgehouden</td></tr>');
  }).catch(function(){});
}
function toggleDishStats() {
  var open = false;
  document.querySelectorAll('.dish-collapse').forEach(function(el) { open = el.classList.toggle('open'); });
  document.getElementById('dish-chevron').style.transform = open ? 'rotate(180deg)' : '';
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
    (d.alerts || []).forEach(function(a) { var el = document.createElement('span'); el.className = 'hour-exp'; el.textContent = '⚠ ' + a; alertsEl.appendChild(el); });
    var mins = s.finishAt ? Math.max(0, Math.round((s.finishAt - Date.now()) / 60000)) : null;
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
  el.style.color = d.error ? 'var(--red)' : d.linked ? 'var(--green)' : 'var(--dim)';
  el.textContent = d.error ? d.error
    : d.linked ? 'Gekoppeld' + (d.name ? ' met ' + d.name : '')
    : d.pending ? 'Wacht op goedkeuring…'
    : d.configured ? (note ? note + ' · ' : '') + 'Client-ID eindigt op …' + d.clientHint + ', nog niet gekoppeld'
    : 'Vul het client-ID van je Home Connect-applicatie in';
  pend.textContent = '';
  if (d.pending) {
    var a = document.createElement('a');
    a.href = d.pending.url; a.target = '_blank'; a.rel = 'noopener'; a.className = 'btn btn-primary'; a.style.textDecoration = 'none';
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

// ── Modules ──
function loadModules() {
  fetch('/api/modules').then(function(r){return r.json();}).then(function(list) {
    var el = document.getElementById('settings-modules');
    if (!el) return;
    el.innerHTML = '<div class="power-hero"><div style="display:flex;flex-direction:column;gap:0">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:0.75rem"><div><div style="font-size:0.85rem;font-weight:600">Stroom (P1-meter)</div><div style="font-size:0.65rem;color:var(--dim)">De basis van de app, staat altijd aan</div></div><span class="mod-switch on locked"></span></div>' +
      list.map(function(m) {
        return '<div style="display:flex;justify-content:space-between;align-items:center;gap:0.75rem;border-top:1px solid var(--border);padding-top:0.65rem;margin-top:0.65rem">' +
          '<div><div style="font-size:0.85rem;font-weight:600">' + m.label + '</div><div style="font-size:0.65rem;color:var(--dim)">' + m.hint + '</div></div>' +
          '<button class="mod-switch' + (m.enabled ? ' on' : '') + '" role="switch" aria-checked="' + m.enabled + '" aria-label="' + m.label + '" data-key="' + m.key + '" onclick="toggleModule(this)"></button></div>';
      }).join('') + '</div></div>';
  }).catch(function(){});
}
// Past de modules toe op de open pagina: klassen op body, Home-blokken en de kostengrafiek
function applyModules() {
  Object.keys(MODULES).forEach(function(k) { document.body.classList.toggle('mod-off-' + k, !moduleOn(k)); });
  document.body.classList.toggle('mod-off-thuis', !['lights','fridge','esphome','temperature','wasmachine','vaatwasser'].some(moduleOn));
  applyLayout(0);
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
      if (!d.ok) { show(!enabled); return; }
      MODULES = d.modules;
      applyModules();
    }).catch(function() { btn.disabled = false; show(!enabled); });
}

// ── Apparaatstatus ──
function loadDeviceStatus() {
  fetch('/api/monitor').then(function(r){return r.json();}).then(function(list) {
    var el = document.getElementById('settings-device-status');
    if (!el) return;
    if (!list.length) { el.innerHTML = '<div class="power-hero"><div style="font-size:0.75rem;color:var(--muted)">Nog geen apparaten gezien</div></div>'; return; }
    el.innerHTML = '<div class="power-hero"><div style="display:flex;flex-direction:column;gap:0">' + list.map(function(d, i) {
      var border = i > 0 ? 'border-top:1px solid var(--border);padding-top:0.65rem;margin-top:0.65rem' : '';
      var color = d.online ? 'var(--green)' : 'var(--red)';
      var when = d.last_seen ? d.last_seen.slice(8, 10) + '-' + d.last_seen.slice(5, 7) + ' ' + d.last_seen.slice(11, 16) : 'nog niet gezien';
      return '<div style="display:flex;justify-content:space-between;align-items:center;gap:0.6rem;' + border + '">' +
        '<div style="display:flex;align-items:center;gap:0.6rem;min-width:0"><span style="width:8px;height:8px;border-radius:50%;flex-shrink:0;background:' + color + '"></span>' +
        '<div style="min-width:0"><div style="font-size:0.85rem;font-weight:600">' + d.name + '</div>' +
        '<div style="font-size:0.65rem;color:var(--dim)">Laatste bericht: ' + when + ' · melding na ' + d.limit_min + ' min stilte</div></div></div>' +
        '<span style="font-size:0.72rem;font-weight:600;color:' + color + '">' + (d.online ? 'Online' : 'Offline') + '</span></div>';
    }).join('') + '</div></div>';
  }).catch(function(){});
}


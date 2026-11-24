// Deel van het voormalige 05-apparaten.js — afgesplitst voor overzicht.
// Klimaat-integraties: verwarming (tado) en Tapo (TP-Link). Draait in dezelfde bundle-scope.

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
      meta.innerHTML = '<span>' + escHtml(tadoAgo(d.updated)) + (d.heating ? ' · 🔥 stookt (snel loggen)' : '') + '</span>' +
        '<button class="btn btn-quiet btn-sm" onclick="refreshTadoNow(this)"><i class="fa-solid fa-rotate"></i> Ververs nu</button>';
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


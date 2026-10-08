// ── Wie is thuis ──
// Instellingen > Wie is thuis: de aangemelde telefoons en of ze op het thuisnetwerk zijn gevonden.
var presenceRemoveArmed = null;
function presenceAgo(ms) {
  if (!ms) return 'nog niet gezien';
  var min = Math.round((Date.now() - ms) / 60000);
  return min < 1 ? 'zojuist gezien' : min < 60 ? min + ' min geleden gezien' : 'gezien ' + shortWhen(ms);
}
function showPresence(d, error) {
  var list = document.getElementById('presence-list'), status = document.getElementById('presence-me-status');
  if (!list || !status) return;
  list.innerHTML = d.people.length ? d.people.map(function(p) {
    return '<div class="presence-row' + (p.home ? ' home' : '') + '"><i class="fa-solid ' + (p.home ? 'fa-house-user' : 'fa-person-walking-arrow-right') + '"></i>' +
      '<div><div class="outage-text">' + escHtml(p.name) + (p.type ? '<span class="presence-type">' + p.type + '</span>' : '') + '</div><div class="outage-sub">' + (p.home ? 'Thuis' : 'Weg') + (p.since ? ' sinds ' + shortWhen(p.since) : '') + ' · ' + presenceAgo(p.last_seen) + '</div></div>' +
      '<button class="presence-remove" onclick="removePresence(\'' + p.id + '\',this)" aria-label="' + escHtml(p.name) + ' verwijderen">Verwijderen</button></div>';
  }).join('') : '<div class="outage-sub">Nog geen telefoons aangemeld. Open VloedHub op elke telefoon, thuis op de wifi, en meld hem hieronder aan.</div>';
  var me = d.people.filter(function(p) { return p.id === d.me.id; })[0];
  status.style.color = error ? 'var(--red)' : 'var(--dim)';
  status.textContent = error || (me ? 'Dit apparaat is aangemeld als ' + me.name + '. Met een andere naam opslaan past de naam aan.' :
    d.me.local && !d.me.phone ? 'Dit apparaat is geen telefoon. Aanmelden kan alleen vanaf een iPhone of Android-telefoon, zodat een tablet of computer niet als persoon telt.' :
    d.me.local ? 'Dit apparaat is nog niet aangemeld. Het telt als weg na ' + d.away_after_min + ' minuten niet gevonden te zijn op de wifi.' :
    'Aanmelden kan alleen thuis op de wifi, via ' + d.local_url);
  var name = document.getElementById('presence-name');
  if (me && !name.value) name.value = me.name;
  document.getElementById('presence-claim').disabled = !d.me.local || !d.me.phone;
}
function loadPresence() {
  if (!moduleOn('aanwezigheid')) return;
  fetch('/api/presence').then(function(r){return r.json();}).then(function(d) { showPresence(d); }).catch(function(){});
}
function claimPresence(btn) {
  btn.disabled = true;
  fetch('/api/presence/claim', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name: document.getElementById('presence-name').value })})
    .then(function(r){return r.json();}).then(function(d) {
      btn.disabled = false;
      if (!d.ok) { var s = document.getElementById('presence-me-status'); s.style.color = 'var(--red)'; s.textContent = d.error || 'Aanmelden mislukt'; return; }
      showPresence(d);
    }).catch(function() { btn.disabled = false; });
}
// ── Netwerkscan ──
// Laat zien wat er nu op het thuisnetwerk antwoordt. Elk apparaat is af te vinken: negeren (een bekend apparaat
// zoals een ESP32, komt dan niet meer in de lijst) of bijhouden als persoon (alleen een telefoon). Elk apparaat
// kan ook een eigen naam krijgen en gewoon in de lijst blijven staan.
var presenceDevices = [], presenceShowIgnored = false, presenceForm = null; // presenceForm: { mac, action } van het open invulveld
function presenceTitle(x) {
  return x.name || x.label || (x.router ? 'Modem' : x.camera ? 'Deurbelcamera' : x.hostname || x.visited_as || x.vendor || (x.private_mac ? 'Telefoon, tablet of laptop' : 'Onbekend apparaat'));
}
function renderPresenceScan(error) {
  var out = document.getElementById('presence-scan');
  if (!out) return;
  var hidden = presenceDevices.filter(function(x) { return x.ignored; }).length;
  var shown = presenceDevices.filter(function(x) { return presenceShowIgnored || !x.ignored; });
  var html = '<div class="outage-sub">' + (presenceDevices.length - hidden) + ' apparaten' + (hidden ? ' · ' + hidden + ' genegeerd <button class="presence-remove" onclick="presenceShowIgnored=!presenceShowIgnored;renderPresenceScan()">' + (presenceShowIgnored ? 'Verbergen' : 'Tonen') + '</button>' : '') +
    '. Een telefoon in slaapstand kan ontbreken.</div>' + (error ? '<div class="outage-sub" style="color:var(--red)">' + escHtml(error) + '</div>' : '');
  html += shown.map(function(x) {
    // de beste aanwijzing als titel, de rest eronder
    var title = presenceTitle(x);
    var hints = [x.label && !x.ignored ? presenceTitle(Object.assign({}, x, { label: null })) : '', x.hostname, x.visited_as ? 'opende VloedHub als ' + x.visited_as : '', x.vendor, x.private_mac ? 'privé-wifi-adres' : ''].filter(function(h) { return h && h !== title; });
    var phone = x.visited_as === 'iPhone' || x.visited_as === 'Android-telefoon';
    var icon = x.name ? 'fa-house-user' : x.ignored ? 'fa-check' : x.router ? 'fa-wifi' : x.camera ? 'fa-video' : phone || x.private_mac ? 'fa-mobile-screen' : /ESP|Espressif/.test(title + ' ' + (x.vendor || '')) ? 'fa-microchip' : 'fa-circle-question';
    var form = presenceForm && presenceForm.mac === x.mac ? presenceForm : null;
    var actions = x.name ? '<span class="presence-type">Bijgehouden</span>' :
      x.ignored ? '<button class="presence-remove" onclick="presenceDevice(\'' + x.mac + '\',\'unignore\')">Weer tonen</button>' :
      form ? '' :
      (phone ? '<button class="presence-remove track" onclick="presenceAsk(\'' + x.mac + '\',\'track\')">Bijhouden</button>' : '') +
      '<button class="presence-remove" onclick="presenceAsk(\'' + x.mac + '\',\'name\')">' + (x.label ? 'Naam wijzigen' : 'Naam geven') + '</button>' +
      '<button class="presence-remove" onclick="presenceAsk(\'' + x.mac + '\',\'ignore\')">Negeren</button>';
    return '<div class="presence-row' + (x.name ? ' home' : '') + (x.ignored ? ' ignored' : '') + '"><i class="fa-solid ' + icon + '"></i>' +
      '<div><div class="outage-text">' + escHtml(title) + '</div>' + (hints.length ? '<div class="outage-sub">' + escHtml(hints.join(' · ')) + '</div>' : '') +
      '<div class="outage-sub presence-addr">' + x.ip + ' · ' + x.mac + '</div>' +
      (form ? '<div class="presence-form presence-inline"><input class="field" id="presence-device-name" maxlength="30" autocomplete="off" placeholder="' + (form.action === 'track' ? 'Naam van de persoon' : form.action === 'name' ? 'Naam, bijv. Pc zolder' : 'Naam, bijv. Ledstrip keuken') + '" value="' + escHtml(form.action === 'name' ? x.label || '' : form.action === 'ignore' && title !== 'Onbekend apparaat' ? title.slice(0, 30) : '') + '">' +
        '<button class="btn btn-primary" onclick="presenceDevice(\'' + x.mac + '\',\'' + form.action + '\')">' + (form.action === 'track' ? 'Bijhouden' : form.action === 'name' ? 'Opslaan' : 'Negeren') + '</button></div>' : '') +
      '</div>' + actions + '</div>';
  }).join('');
  out.innerHTML = html;
  var input = document.getElementById('presence-device-name');
  if (input) { input.focus(); input.onkeydown = function(e) { if (e.key === 'Enter') presenceDevice(presenceForm.mac, presenceForm.action); if (e.key === 'Escape') { presenceForm = null; renderPresenceScan(); } }; }
}
// Negeren en bijhouden vragen eerst om een naam, in de regel zelf
function presenceAsk(mac, action) { presenceForm = { mac: mac, action: action }; renderPresenceScan(); }
function presenceDevice(mac, action) {
  var input = document.getElementById('presence-device-name');
  fetch('/api/presence/device', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ mac: mac, action: action, name: input ? input.value : '' })})
    .then(function(r){return r.json();}).then(function(d) {
      if (!d.ok) { renderPresenceScan(d.error || 'Opslaan mislukt'); return; }
      presenceForm = null;
      presenceDevices = d.devices;
      showPresence(d);
      renderPresenceScan();
    }).catch(function() { renderPresenceScan('Verbindingsfout'); });
}
function scanPresence(btn) {
  var out = document.getElementById('presence-scan');
  btn.disabled = true;
  presenceForm = null;
  out.innerHTML = '<div class="outage-sub">Netwerk afzoeken en apparaten opzoeken, dit kan een halve minuut duren…</div>';
  fetch('/api/presence/scan', {method:'POST'}).then(function(r){return r.json();}).then(function(d) {
    btn.disabled = false;
    if (!d.ok) { out.innerHTML = '<div class="outage-sub" style="color:var(--red)">' + escHtml(d.error || 'Scan mislukt') + '</div>'; return; }
    presenceDevices = d.devices;
    showPresence(d);
    renderPresenceScan();
  }).catch(function() { btn.disabled = false; out.innerHTML = '<div class="outage-sub" style="color:var(--red)">Verbindingsfout</div>'; });
}
// Verwijderen vraagt een tweede tik ter bevestiging
function removePresence(id, btn) {
  if (presenceRemoveArmed !== id) {
    presenceRemoveArmed = id;
    btn.textContent = 'Zeker weten?';
    setTimeout(function() { if (presenceRemoveArmed === id) { presenceRemoveArmed = null; btn.textContent = 'Verwijderen'; } }, 4000);
    return;
  }
  presenceRemoveArmed = null;
  fetch('/api/presence/remove', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id: id })})
    .then(function(r){return r.json();}).then(function(d) { if (d.ok) showPresence(d); }).catch(function(){});
}
// alleen bijwerken zolang Instellingen open staat
setInterval(function() { if (currentScreen === 5 && !document.hidden && presenceRemoveArmed === null && !presenceForm) loadPresence(); }, 30000);

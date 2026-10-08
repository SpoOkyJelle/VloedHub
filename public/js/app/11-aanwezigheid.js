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
// Laat zien wat er nu op het thuisnetwerk antwoordt, om te controleren of de server de telefoons kan vinden
function scanPresence(btn) {
  var out = document.getElementById('presence-scan');
  btn.disabled = true;
  out.innerHTML = '<div class="outage-sub">Netwerk afzoeken, dit duurt een seconde of tien…</div>';
  fetch('/api/presence/scan', {method:'POST'}).then(function(r){return r.json();}).then(function(d) {
    btn.disabled = false;
    if (!d.ok) { out.innerHTML = '<div class="outage-sub" style="color:var(--red)">' + escHtml(d.error || 'Scan mislukt') + '</div>'; return; }
    showPresence(d);
    out.innerHTML = '<div class="outage-sub">' + d.devices.length + ' apparaten gevonden. Een telefoon in slaapstand kan ontbreken.</div>' + d.devices.map(function(x) {
      return '<div class="presence-row' + (x.name ? ' home' : '') + '"><i class="fa-solid ' + (x.name ? 'fa-mobile-screen' : x.router ? 'fa-wifi' : 'fa-circle-question') + '"></i>' +
        '<div><div class="outage-text">' + (x.name ? escHtml(x.name) : x.router ? 'Modem' : 'Onbekend apparaat') + '</div><div class="outage-sub presence-addr">' + x.ip + ' · ' + x.mac + '</div></div></div>';
    }).join('');
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
setInterval(function() { if (currentScreen === 5 && !document.hidden && presenceRemoveArmed === null) loadPresence(); }, 30000);

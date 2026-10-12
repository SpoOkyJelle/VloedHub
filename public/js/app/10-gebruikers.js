// ── Gebruikers ──
// Instellingen > Systeem: iedere huisgenoot heeft een eigen naam en PIN. Zolang er nog niemand is aangemaakt logt
// iedereen in met de gedeelde PIN; wie de eerste gebruiker aanmaakt wordt beheerder. Een beheerder kan anderen
// toevoegen, verwijderen, een nieuwe PIN geven of ook beheerder maken. Je eigen naam kun je altijd zelf aanpassen.
var usersData = null, userRemoveArmed = null, userForm = null; // userForm: { id, action } van het open invulveld
function showUsers(d, error) {
  var list = document.getElementById('users-list'), status = document.getElementById('users-status');
  if (!list || !status || !d) return;
  usersData = d;
  var me = d.users.filter(function(u) { return u.id === d.me; })[0];
  var admin = !!me && me.admin;
  list.innerHTML = d.users.map(function(u) {
    var self = u.id === d.me, form = userForm && userForm.id === u.id ? userForm : null;
    var actions = form ? '' :
      (admin || self ? '<button class="presence-remove" onclick="userAsk(\'' + u.id + '\',\'name\')">Naam wijzigen</button>' : '') +
      (admin && !self ? '<button class="presence-remove" onclick="userAsk(\'' + u.id + '\',\'pin\')">Nieuwe PIN</button>' +
        '<button class="presence-remove" onclick="userSave(\'' + u.id + '\',{admin:' + !u.admin + '})">' + (u.admin ? 'Geen beheerder' : 'Beheerder maken') + '</button>' +
        '<button class="presence-remove" onclick="removeUser(\'' + u.id + '\',this)" aria-label="' + escHtml(u.name) + ' verwijderen">Verwijderen</button>' : '');
    return '<div class="presence-row' + (self ? ' home' : '') + '"><i class="fa-solid ' + (u.admin ? 'fa-user-shield' : 'fa-user') + '"></i>' +
      '<div><div class="outage-text">' + escHtml(u.name) + (u.admin ? '<span class="presence-type">Beheerder</span>' : '') + '</div>' +
      (self ? '<div class="outage-sub">Dit ben jij</div>' : '') +
      (form ? '<div class="presence-form presence-inline"><input class="field" id="user-edit" autocomplete="' + (form.action === 'pin' ? 'new-password' : 'off') + '"' +
        (form.action === 'pin' ? ' type="password" inputmode="numeric" maxlength="4" placeholder="Nieuwe PIN (4 cijfers)"' : ' maxlength="30" placeholder="Naam" value="' + escHtml(u.name) + '"') + '>' +
        '<button class="btn btn-primary" onclick="userSubmit()">Opslaan</button></div>' : '') +
      '</div>' + actions + '</div>';
  }).join('');
  status.style.color = error ? 'var(--red)' : '';
  status.textContent = error || (!d.users.length ? 'Nog geen gebruikers: iedereen logt in met dezelfde PIN. Maak hieronder eerst je eigen account aan; dat wordt de beheerder. Daarna vervalt de gedeelde PIN en logt iedereen in met een eigen account.' :
    admin ? 'Voeg hieronder een huisgenoot toe met een eerste PIN; die kan hem daarna zelf wijzigen bij Beveiliging.' :
    'Alleen een beheerder kan gebruikers toevoegen of verwijderen.');
  document.getElementById('users-form').hidden = d.users.length > 0 && !admin;
  var out = document.getElementById('logout-desc');
  if (out) out.textContent = me ? 'Ingelogd als ' + me.name : 'Sessie beëindigen';
  var input = document.getElementById('user-edit');
  if (input) { input.focus(); input.onkeydown = function(e) { if (e.key === 'Enter') userSubmit(); if (e.key === 'Escape') { userForm = null; showUsers(usersData); } }; }
}
function loadUsers() {
  if (userForm || userRemoveArmed !== null) return;
  fetch('/api/auth/users').then(function(r){return r.json();}).then(function(d) { showUsers(d); }).catch(function(){});
}
function userPost(path, body, done) {
  fetch('/api/auth/users/' + path, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)})
    .then(function(r){return r.json();}).then(function(d) {
      if (!d.ok) { showUsers(usersData, d.error || 'Opslaan mislukt'); return; }
      userForm = null;
      showUsers(d);
      if (done) done();
    }).catch(function() { showUsers(usersData, 'Verbindingsfout'); });
}
function addUser(btn) {
  var name = document.getElementById('user-name'), pin = document.getElementById('user-pin');
  btn.disabled = true;
  setTimeout(function() { btn.disabled = false; }, 1000);
  userPost('add', { name: name.value, pin: pin.value }, function() { toast(name.value.trim() + ' toegevoegd', 'ok'); name.value = ''; pin.value = ''; });
}
// Naam wijzigen en een nieuwe PIN vragen eerst om invoer, in de regel zelf
function userAsk(id, action) { userForm = { id: id, action: action }; showUsers(usersData); }
function userSubmit() {
  var input = document.getElementById('user-edit');
  if (!input || !userForm) return;
  var pin = userForm.action === 'pin';
  userSave(userForm.id, pin ? { pin: input.value } : { name: input.value }, pin ? 'Nieuwe PIN ingesteld' : null);
}
function userSave(id, changes, message) {
  changes.id = id;
  userPost('update', changes, message ? function() { toast(message, 'ok'); } : null);
}
// Verwijderen vraagt een tweede tik ter bevestiging
function removeUser(id, btn) {
  if (userRemoveArmed !== id) {
    userRemoveArmed = id;
    btn.textContent = 'Zeker weten?';
    setTimeout(function() { if (userRemoveArmed === id) { userRemoveArmed = null; btn.textContent = 'Verwijderen'; } }, 4000);
    return;
  }
  userRemoveArmed = null;
  userPost('remove', { id: id });
}

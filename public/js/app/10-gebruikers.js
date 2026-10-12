// ── Gebruikers ──
// Instellingen > Systeem: iedere huisgenoot heeft een eigen naam, PIN en profielfoto. Zolang er nog niemand is
// aangemaakt logt iedereen in met de gedeelde PIN; wie de eerste gebruiker aanmaakt wordt beheerder. Er is precies
// één beheerder, de rest is bewoner. De beheerder kan anderen toevoegen, verwijderen, een nieuwe PIN geven en het
// beheer overdragen. Je eigen naam en foto kun je altijd zelf aanpassen.
var USER_ROLES = { admin: 'Beheerder', bewoner: 'Bewoner' };
var USER_PHOTO_SIZE = 256;   // de foto wordt in de browser vierkant gesneden en verkleind voor hij naar de server gaat
var usersData = null, userArmed = null, userForm = null; // userForm: { id, action } van het open invulveld; userArmed: de knop die op een tweede tik wacht
var userPhotoFor = null;
function userPhotoUrl(u) { return '/api/auth/avatar/' + u.id + '?v=' + u.photo; }
function showUsers(d, error) {
  var list = document.getElementById('users-list'), status = document.getElementById('users-status');
  if (!list || !status || !d) return;
  usersData = d;
  var me = d.users.filter(function(u) { return u.id === d.me; })[0];
  var admin = !!me && me.role === 'admin';
  list.innerHTML = d.users.map(function(u) {
    var self = u.id === d.me, form = userForm && userForm.id === u.id ? userForm : null;
    var actions = form ? '' :
      (admin || self ? '<button class="presence-remove" onclick="userAsk(\'' + u.id + '\',\'name\')">Naam wijzigen</button>' +
        '<button class="presence-remove" onclick="userPickPhoto(\'' + u.id + '\')">' + (u.photo ? 'Andere foto' : 'Foto kiezen') + '</button>' +
        (u.photo ? '<button class="presence-remove" onclick="userPhoto(\'' + u.id + '\',null)">Foto weghalen</button>' : '') : '') +
      (admin && !self ? '<button class="presence-remove" onclick="userAsk(\'' + u.id + '\',\'pin\')">Nieuwe PIN</button>' +
        '<button class="presence-remove" onclick="userConfirm(\'transfer\',\'' + u.id + '\',this)">Beheer overdragen</button>' +
        '<button class="presence-remove" onclick="userConfirm(\'remove\',\'' + u.id + '\',this)" aria-label="' + escHtml(u.name) + ' verwijderen">Verwijderen</button>' : '');
    return '<div class="presence-row' + (self ? ' home' : '') + '">' +
      (u.photo ? '<img class="user-avatar" src="' + userPhotoUrl(u) + '" alt="">' : '<i class="fa-solid ' + (u.role === 'admin' ? 'fa-user-shield' : 'fa-user') + '"></i>') +
      '<div><div class="outage-text">' + escHtml(u.name) + '<span class="presence-type">' + (USER_ROLES[u.role] || '') + '</span></div>' +
      (self ? '<div class="outage-sub">Dit ben jij</div>' : '') +
      (form ? '<div class="presence-form presence-inline"><input class="field" id="user-edit" autocomplete="' + (form.action === 'pin' ? 'new-password' : 'off') + '"' +
        (form.action === 'pin' ? ' type="password" inputmode="numeric" maxlength="4" placeholder="Nieuwe PIN (4 cijfers)"' : ' maxlength="30" placeholder="Naam" value="' + escHtml(u.name) + '"') + '>' +
        '<button class="btn btn-primary" onclick="userSubmit()">Opslaan</button></div>' : '') +
      '</div>' + actions + '</div>';
  }).join('');
  status.style.color = error ? 'var(--red)' : '';
  status.textContent = error || (!d.users.length ? 'Nog geen gebruikers: iedereen logt in met dezelfde PIN. Maak hieronder eerst je eigen account aan; dat wordt de beheerder. Daarna vervalt de gedeelde PIN en logt iedereen in met een eigen account.' :
    admin ? 'Jij bent de beheerder. Voeg hieronder een huisgenoot toe met een eerste PIN; die kan hem daarna zelf wijzigen bij Beveiliging.' :
    'Alleen de beheerder kan gebruikers toevoegen of verwijderen. Je eigen naam en foto kun je zelf aanpassen.');
  document.getElementById('users-form').hidden = d.users.length > 0 && !admin;
  var out = document.getElementById('logout-desc');
  if (out) out.textContent = me ? 'Ingelogd als ' + me.name : 'Sessie beëindigen';
  var input = document.getElementById('user-edit');
  if (input) { input.focus(); input.onkeydown = function(e) { if (e.key === 'Enter') userSubmit(); if (e.key === 'Escape') { userForm = null; showUsers(usersData); } }; }
}
function loadUsers() {
  if (userForm || userArmed !== null) return;
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
  userPost('add', { name: name.value, pin: pin.value }, function() {
    toast(name.value.trim() + ' toegevoegd', 'ok'); name.value = ''; pin.value = '';
    // wie de eerste gebruiker aanmaakt is vanaf nu als beheerder ingelogd
    if (!ME) location.reload();
  });
}
// Naam wijzigen en een nieuwe PIN vragen eerst om invoer, in de regel zelf
function userAsk(id, action) { userForm = { id: id, action: action }; showUsers(usersData); }
function userSubmit() {
  var input = document.getElementById('user-edit');
  if (!input || !userForm) return;
  var pin = userForm.action === 'pin';
  userPost('update', pin ? { id: userForm.id, pin: input.value } : { id: userForm.id, name: input.value }, pin ? function() { toast('Nieuwe PIN ingesteld', 'ok'); } : null);
}
// Verwijderen en het beheer overdragen vragen een tweede tik ter bevestiging
function userConfirm(action, id, btn) {
  var key = action + id, label = btn.textContent;
  if (userArmed !== key) {
    userArmed = key;
    btn.textContent = 'Zeker weten?';
    setTimeout(function() { if (userArmed === key) { userArmed = null; btn.textContent = label; } }, 4000);
    return;
  }
  userArmed = null;
  // na het overdragen ben je zelf bewoner: de pagina opnieuw laden verbergt wat alleen de beheerder mag
  userPost(action, { id: id }, action === 'transfer' ? function() { location.reload(); } : null);
}
// ── Profielfoto ──
function userPickPhoto(id) {
  var input = document.getElementById('user-photo-file');
  userPhotoFor = id;
  input.value = '';
  input.click();
}
// Snijdt het midden van de gekozen foto vierkant uit en verkleint hem, zodat er maar een klein bestand naar de server gaat
function userPhotoChosen(input) {
  var file = input.files && input.files[0], id = userPhotoFor;
  if (!file || !id) return;
  var url = URL.createObjectURL(file), img = new Image();
  img.onload = function() {
    var side = Math.min(img.naturalWidth, img.naturalHeight), canvas = document.createElement('canvas');
    canvas.width = canvas.height = USER_PHOTO_SIZE;
    canvas.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, USER_PHOTO_SIZE, USER_PHOTO_SIZE);
    URL.revokeObjectURL(url);
    userPhoto(id, canvas.toDataURL('image/jpeg', 0.85));
  };
  img.onerror = function() { URL.revokeObjectURL(url); showUsers(usersData, 'Deze foto kan niet geopend worden'); };
  img.src = url;
}
function userPhoto(id, image) {
  userPost('photo', { id: id, image: image }, function() { toast(image ? 'Foto opgeslagen' : 'Foto weggehaald', 'ok'); });
}

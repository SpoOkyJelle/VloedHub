function showPinModal() {
  ['pin-current', 'pin-new', 'pin-confirm'].forEach(function(id) { document.getElementById(id).value = ''; });
  document.getElementById('pin-modal-error').textContent = '';
  openModal('pin-modal-overlay', closePinModal);
}
function closePinModal() { closeModal('pin-modal-overlay'); }
function savePinModal() {
  var current = document.getElementById('pin-current').value;
  var newPin  = document.getElementById('pin-new').value;
  var confirm = document.getElementById('pin-confirm').value;
  var errEl   = document.getElementById('pin-modal-error');
  if (!/^\d{4}$/.test(newPin))   { errEl.textContent = 'PIN moet precies 4 cijfers zijn'; return; }
  if (newPin !== confirm)         { errEl.textContent = 'PINs komen niet overeen'; return; }
  fetch('/api/auth/set-pin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ current: current, pin: newPin })
  }).then(function(r) { return r.json(); }).then(function(d) {
    if (d.ok) { closePinModal(); toast('PIN gewijzigd', 'ok'); }
    else { errEl.textContent = d.error || 'Wijzigen mislukt'; }
  }).catch(function() { errEl.textContent = 'Verbindingsfout'; });
}
function logout() {
  fetch('/api/auth/logout', { method: 'POST' }).then(function() {
    window.location.href = '/pin';
  }).catch(actionFailed('Uitloggen lukte niet'));
}
// Enter in een van de velden slaat op
document.getElementById('pin-modal-body').addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && e.target.tagName === 'INPUT') savePinModal();
});

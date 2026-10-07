function showPinModal() {
  var el = document.getElementById('pin-modal-overlay');
  el.style.display = 'flex';
  document.getElementById('pin-current').value = '';
  document.getElementById('pin-new').value = '';
  document.getElementById('pin-confirm').value = '';
  document.getElementById('pin-modal-error').textContent = '';
  document.getElementById('pin-current').focus();
}
function closePinModal() {
  document.getElementById('pin-modal-overlay').style.display = 'none';
}
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
    if (d.ok) { closePinModal(); }
    else { errEl.textContent = d.error || 'Fout'; }
  });
}
function logout() {
  fetch('/api/auth/logout', { method: 'POST' }).then(function() {
    window.location.href = '/pin';
  });
}
document.getElementById('pin-modal-overlay').addEventListener('click', function(e) {
  if (e.target === this) closePinModal();
});
document.addEventListener('DOMContentLoaded',function(){var eb=document.getElementById('layout-edit-btn');if(eb)eb.style.display='flex';});

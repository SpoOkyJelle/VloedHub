// Deel van het voormalige 05-apparaten.js — afgesplitst voor overzicht.
// Instellingen-UI: tabbladen, modules aan/uit, en de apparaatstatus-lijst.

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

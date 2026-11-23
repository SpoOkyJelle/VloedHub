// Deel van het voormalige 03-home-blokken.js — afgesplitst voor overzicht.
// Scènes (bewerken/uitvoeren) en de discostand van de app. Draait in dezelfde bundle-scope.

// ── Scènes ──
var SCENE_DATA = { scenes: [], icons: [], led: [], relay: [] };
var SCENE_DEVICE_NAMES = { 'led::default': 'LED Strip', 'led::keuken': 'Ledstrip Keuken', 'led::gang': 'Ledstrip Gang', 'led::tv-meubel': 'LED TV Meubel', 'relay::gang': 'Lamp Gang' };
function escHtml(v) { return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function sceneDeviceName(key) { return (typeof deviceNamesCache !== 'undefined' && deviceNamesCache[key]) || SCENE_DEVICE_NAMES[key] || key; }
function renderScenes() {
  var buttons = SCENE_DATA.scenes.map(function(s) {
    return '<button class="btn btn-ghost' + (s.id === 'disco' ? ' btn-disco' : '') + '" data-scene="' + s.id + '" onclick="runScene(this)"><i class="fa-solid fa-' + s.icon + '"></i> ' + escHtml(s.label) + '</button>';
  }).join('');
  // in de feeststand staat de proostknop bij de scènes
  if (typeof partyState !== 'undefined' && partyState.on) buttons += '<button class="btn btn-proost" onclick="proost(this)"><i class="fa-solid fa-champagne-glasses"></i> Proost</button>';
  Array.prototype.forEach.call(document.querySelectorAll('.scene-row'), function(el) {
    el.innerHTML = buttons || '<div class="empty-note">Nog geen scènes. Maak er een bij Instellingen.</div>';
  });
  var list = document.getElementById('settings-scenes');
  if (!list) return;
  list.innerHTML = '<div class="setting-card">' +
    SCENE_DATA.scenes.map(function(s) {
      return '<div class="setting-row"><i class="fa-solid fa-' + s.icon + ' setting-icon"></i>' +
        '<div class="setting-text"><div class="setting-title">' + escHtml(s.label) + '</div></div>' +
        '<button class="btn btn-ghost btn-sm" data-id="' + s.id + '" onclick="openSceneEditor(this.dataset.id)"><i class="fa-solid fa-pen"></i> Bewerken</button></div>';
    }).join('') +
    '<div class="setting-row"><button class="btn btn-primary" onclick="openSceneEditor(null)"><i class="fa-solid fa-plus"></i> Nieuwe scène</button></div>' +
    '</div>';
}
function loadScenes() {
  fetch('/api/scenes').then(function(r){return r.json();}).then(function(d) {
    if (!d || !d.scenes) return;
    SCENE_DATA = d;
    renderScenes();
  }).catch(function(){});
}
function runScene(btn) {
  btn.disabled = true;
  fetch('/api/scenes/run', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({scene: btn.dataset.scene})})
    .then(function(r){return r.json();}).then(function(d) {
      btn.disabled = false;
      if (!d.ok) { toast(d.error || 'Scène starten lukte niet', 'error'); return; }
      btn.classList.add('done');
      setTimeout(function() { btn.classList.remove('done'); }, 900);
      lampsRefresh();
      // Disco zet ook de app zelf in discostand; elke andere scène haalt hem er weer uit
      setDisco(btn.dataset.scene === DISCO_SCENE);
    }).catch(function() { btn.disabled = false; toast('Scène starten lukte niet', 'error'); });
}

// Scène maken of bewerken
var sceneEditId = null, sceneEditIcon = 'lightbulb';
function sceneModeSelect(id, value) {
  return '<select class="field scene-mode" id="' + id + '" onchange="sceneEditorSync()">' +
    [['keep','Niet wijzigen'],['off','Uit'],['on','Aan']].map(function(o) { return '<option value="' + o[0] + '"' + (o[0] === value ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>';
}
function openSceneEditor(id) {
  var s = SCENE_DATA.scenes.filter(function(x) { return x.id === id; })[0] || { id: null, label: '', icon: 'lightbulb', led: {}, relay: {} };
  sceneEditId = s.id;
  sceneEditIcon = s.icon;
  var html = '<div class="scene-field"><label for="scene-name">Naam</label><input class="field" id="scene-name" maxlength="24" placeholder="bijv. Film kijken" value="' + escHtml(s.label) + '"></div>' +
    '<div class="scene-field"><label>Icoon</label><div class="scene-icons">' + SCENE_DATA.icons.map(function(ic) {
      return '<button type="button" class="scene-icon' + (ic === s.icon ? ' on' : '') + '" data-icon="' + ic + '" onclick="scenePickIcon(this)" aria-label="' + ic + '"><i class="fa-solid fa-' + ic + '"></i></button>';
    }).join('') + '</div></div>';
  SCENE_DATA.led.forEach(function(dev) {
    var cfg = (s.led || {})[dev];
    var mode = !cfg ? 'keep' : cfg.on ? 'on' : 'off';
    var effect = cfg && cfg.effect != null ? cfg.effect : 0;
    var bright = cfg && cfg.brightness != null ? cfg.brightness : 180;
    var col = cfg && cfg.color ? '#' + [cfg.color.r, cfg.color.g, cfg.color.b].map(function(v) { return ('0' + v.toString(16)).slice(-2); }).join('') : '#ffffff';
    html += '<div class="scene-device" data-led="' + dev + '"><div class="scene-device-head"><span>' + escHtml(sceneDeviceName('led::' + dev)) + '</span>' + sceneModeSelect('scene-led-' + dev, mode) + '</div>' +
      '<div class="scene-device-opts">' +
      '<select class="field scene-effect" onchange="sceneEditorSync()">' + LED_EFFECTS.map(function(name, i) { return '<option value="' + i + '"' + (i === effect ? ' selected' : '') + '>' + name + '</option>'; }).join('') + '</select>' +
      '<label class="scene-bright">Helderheid<input type="range" min="10" max="255" value="' + bright + '" class="scene-brightness"></label>' +
      '<label class="scene-color">Kleur<input type="color" value="' + col + '" class="scene-colorpick"></label>' +
      '</div></div>';
  });
  SCENE_DATA.relay.forEach(function(dev) {
    var cfg = (s.relay || {})[dev];
    html += '<div class="scene-device" data-relay="' + dev + '"><div class="scene-device-head"><span>' + escHtml(sceneDeviceName('relay::' + dev)) + '</span>' + sceneModeSelect('scene-relay-' + dev, !cfg ? 'keep' : cfg.on ? 'on' : 'off') + '</div></div>';
  });
  html += '<div class="form-error" id="scene-error" role="alert"></div>' +
    '<div class="modal-actions">' +
    (s.id ? '<button class="btn btn-danger" id="scene-delete" onclick="deleteScene(this)">Verwijderen</button>' : '') +
    '<span class="spacer"></span><button class="btn btn-quiet" onclick="closeSceneEditor()">Annuleren</button><button class="btn btn-primary" onclick="saveScene()">Opslaan</button></div>';
  document.getElementById('scene-modal-title').textContent = s.id ? 'Scène bewerken' : 'Nieuwe scène';
  document.getElementById('scene-modal-body').innerHTML = html;
  sceneEditorSync();
  openModal('scene-modal-overlay', closeSceneEditor);
}
function closeSceneEditor() { closeModal('scene-modal-overlay'); }
function scenePickIcon(btn) {
  sceneEditIcon = btn.dataset.icon;
  Array.prototype.forEach.call(document.querySelectorAll('.scene-icon'), function(b) { b.classList.toggle('on', b === btn); });
}
// extra instellingen alleen tonen bij "Aan"; de kleurkiezer alleen bij het effect "Eigen kleur"
function sceneEditorSync() {
  Array.prototype.forEach.call(document.querySelectorAll('.scene-device[data-led]'), function(row) {
    var on = row.querySelector('.scene-mode').value === 'on';
    row.querySelector('.scene-device-opts').style.display = on ? '' : 'none';
    row.querySelector('.scene-color').style.display = parseInt(row.querySelector('.scene-effect').value, 10) === LED_EFFECTS.length - 1 ? '' : 'none';
  });
}
function saveScene() {
  var scene = { id: sceneEditId, label: document.getElementById('scene-name').value, icon: sceneEditIcon, led: {}, relay: {} };
  Array.prototype.forEach.call(document.querySelectorAll('.scene-device[data-led]'), function(row) {
    var mode = row.querySelector('.scene-mode').value;
    if (mode === 'keep') return;
    var cfg = { on: mode === 'on' };
    if (cfg.on) {
      cfg.effect = parseInt(row.querySelector('.scene-effect').value, 10);
      cfg.brightness = parseInt(row.querySelector('.scene-brightness').value, 10);
      if (cfg.effect === LED_EFFECTS.length - 1) {
        var hex = row.querySelector('.scene-colorpick').value;
        cfg.color = { r: parseInt(hex.substr(1, 2), 16), g: parseInt(hex.substr(3, 2), 16), b: parseInt(hex.substr(5, 2), 16) };
      }
    }
    scene.led[row.dataset.led] = cfg;
  });
  Array.prototype.forEach.call(document.querySelectorAll('.scene-device[data-relay]'), function(row) {
    var mode = row.querySelector('.scene-mode').value;
    if (mode !== 'keep') scene.relay[row.dataset.relay] = { on: mode === 'on' };
  });
  fetch('/api/scenes', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(scene)})
    .then(function(r){return r.json();}).then(function(d) {
      if (!d.ok) { document.getElementById('scene-error').textContent = d.error || 'Opslaan mislukt'; return; }
      closeSceneEditor();
      loadScenes();
      toast('Scène opgeslagen', 'ok');
    }).catch(function() { document.getElementById('scene-error').textContent = 'Verbindingsfout'; });
}
function deleteScene(btn) {
  // eerste tik vraagt om bevestiging, de tweede verwijdert
  if (!btn.dataset.sure) { btn.dataset.sure = '1'; btn.textContent = 'Zeker weten?'; return; }
  fetch('/api/scenes/delete', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({id: sceneEditId})})
    .then(function(r){return r.json();}).then(function() { closeSceneEditor(); loadScenes(); toast('Scène verwijderd', 'ok'); })
    .catch(function() { document.getElementById('scene-error').textContent = 'Verbindingsfout'; });
}
loadScenes();


// ── Discostand van de app ──
// Start iemand de scène Disco, dan doet de app zelf mee: de merkkleur loopt de regenboog rond en er schuiven
// gekleurde lichtvlekken over het scherm. De server onthoudt welke scène het laatst is gestart, dus elk open
// scherm (ook de wandtablet) gaat binnen een paar tellen mee. Op de maat (twee keer per seconde) krijgt de kleur een
// nieuw doel, ver van de vorige; de overgang ernaartoe loopt vloeiend via CSS (zie main.css) en duurt precies één tel,
// dus de kleur is voortdurend onderweg. De helderheid blijft gelijk: het flitst niet.
var DISCO_SCENE = 'disco', DISCO_POLL = 4000;
var DISCO_BEAT = 500;   // ms per kleurwissel: 120 tellen per minuut
var DISCO_JUMP = 137;   // graden op de kleurcirkel per wissel; zo ligt elke kleur ver van de vorige en herhaalt het lang niet
var discoOn = false, discoTimer = null, discoHue = 90;
var DISCO_VARS = ['--accent', '--accent-l', '--accent-text', '--accent-hover', '--accent-rgb'];
function hslRgb(h, s, l) {
  var a = s * Math.min(l, 1 - l);
  function f(n) { var k = (n + h / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); }
  return [f(0), f(8), f(4)];
}
function discoStep() {
  discoHue = (discoHue + DISCO_JUMP) % 360;
  var light = document.documentElement.dataset.theme === 'light', st = document.documentElement.style;
  function rgb(l, sat) { return 'rgb(' + hslRgb(discoHue, sat || 0.75, l).join(',') + ')'; }
  var base = hslRgb(discoHue, 0.75, light ? 0.45 : 0.6);
  st.setProperty('--accent', 'rgb(' + base.join(',') + ')');
  st.setProperty('--accent-rgb', base.join(','));
  // tekst in de merkkleur moet leesbaar blijven: licht op donker, donker op licht
  st.setProperty('--accent-l', rgb(light ? 0.3 : 0.78, 0.85));
  st.setProperty('--accent-text', rgb(light ? 0.35 : 0.65));
  st.setProperty('--accent-hover', rgb(light ? 0.55 : 0.75));
}
function setDisco(on) {
  on = !!on;
  if (on === discoOn) return;
  discoOn = on;
  document.body.classList.toggle('disco', on);
  document.documentElement.classList.toggle('disco-colors', on);
  clearInterval(discoTimer);
  if (on) {
    discoStep();
    // wie minder beweging wil krijgt één feestkleur, zonder verloop
    if (!noMotion) discoTimer = setInterval(discoStep, DISCO_BEAT);
  } else {
    DISCO_VARS.forEach(function(v) { document.documentElement.style.removeProperty(v); });
  }
}
// De knop "Stoppen" haalt alleen de app uit discostand; de lampen blijven zoals ze zijn
function stopDisco() {
  setDisco(false);
  fetch('/api/scenes/active/clear', {method:'POST'}).catch(function(){});
}
function discoSync() {
  if (document.hidden) return;
  fetch('/api/scenes/active').then(function(r){return r.json();}).then(function(d) { setDisco(d && d.id === DISCO_SCENE); }).catch(function(){});
}
setInterval(discoSync, DISCO_POLL);
// noMotion komt uit een later deel van de app; de eerste controle wacht daarop
document.addEventListener('DOMContentLoaded', discoSync);

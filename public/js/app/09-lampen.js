// ── Lampen ──
var LED_EFFECTS = ['Warm Wit','Ijs Wit','Rainbow','Rainbow Wave','Fade Aan/Uit','Confetti','Vuur','Meteor Regen','Twinkle','Politielichten','Eigen kleur'];
var LED_CUSTOM = LED_EFFECTS.length - 1;
// De ledstrips werken hetzelfde; alleen het adres, de naam en de kaart op Home verschillen
var LEDS = {
  'default': { key: 'led::default', name: 'LED Strip',       query: '',               home: 'home-led-status' },
  'keuken':  { key: 'led::keuken',  name: 'Ledstrip Keuken', query: '?device=keuken', home: 'home-led-keuken-status' },
  'gang':    { key: 'led::gang',    name: 'Ledstrip Gang',   query: '?device=gang',   home: 'home-led-gang-status' }
};
var RELAY = { key: 'relay::gang', name: 'Lamp Gang', query: '?device=gang', home: 'home-relay-gang-status' };
var ledStates = {}, ledSendTimers = {};
var relayGangState = null;

function lampCardHtml(base, cfg, toggle, panelId) {
  return '<div class="lamp-block"><div class="card lamp-card">' +
    '<div class="lamp-head"><div class="lamp-name"><span id="rename-' + base + '">' + cfg.name + '</span>' +
    '<button class="icon-btn icon-btn-sm" aria-label="Naam wijzigen" title="Naam wijzigen" onclick="deviceRename(\'' + cfg.key + '\',\'' + cfg.name + '\',this)"><i class="fa-solid fa-pen"></i></button></div>' +
    '<button class="mod-switch" role="switch" aria-checked="false" aria-labelledby="rename-' + base + '" id="' + base + '-switch" onclick="' + toggle + '"></button></div>' +
    '<div class="lamp-state" id="' + base + '-state">—</div>' +
    (panelId ? '<button class="lamp-more" aria-expanded="false" aria-controls="' + panelId + '" onclick="toggleLedPanel(\'' + panelId.slice(10) + '\',this)">Aanpassen<i class="fa-solid fa-chevron-down"></i></button>' : '') +
    '</div></div>';
}
function ledPanelHtml(id) {
  return '<div id="led-panel-' + id + '" class="lamp-panel" style="display:none"><div class="card lamp-controls">' +
    '<label class="lamp-slider"><span class="field-label">Helderheid</span><input type="range" min="10" max="255" value="180" id="led-' + id + '-brightness" oninput="ledBrightness(\'' + id + '\',this.value)"><span class="lamp-slider-val" id="led-' + id + '-brightness-val"></span></label>' +
    '<label class="lamp-slider" id="led-' + id + '-color-row" hidden><span class="field-label">Kleur</span><input type="color" class="color-field" value="#ffffff" id="led-' + id + '-color" oninput="ledSetColor(\'' + id + '\',this.value)"></label>' +
    '<div class="field-label">Effect</div><div class="effect-grid">' +
    LED_EFFECTS.map(function(name, i) { return '<button class="effect-btn" data-effect="' + i + '" aria-pressed="false" onclick="ledSetEffect(\'' + id + '\',' + i + ')">' + name + '</button>'; }).join('') +
    '</div></div></div>';
}
(function() {
  var grid = document.getElementById('lamp-grid');
  if (!grid) return;
  grid.innerHTML = Object.keys(LEDS).map(function(id) {
    return lampCardHtml('led-' + id, LEDS[id], 'ledToggle(\'' + id + '\')', 'led-panel-' + id) + ledPanelHtml(id);
  }).join('') + lampCardHtml('relay-gang', RELAY, 'relayToggle()', null);
})();

// Zet aan/uit en de toestand op één kaart: de schakelaar en de regel eronder
function lampShow(switchId, stateId, on, text) {
  var sw = document.getElementById(switchId), st = document.getElementById(stateId);
  if (sw) { sw.classList.toggle('on', on); if (sw.hasAttribute('role')) sw.setAttribute('aria-checked', on); }
  if (st) { st.textContent = text; st.classList.toggle('on', on); }
}
function ledRender(id) {
  var s = ledStates[id], cfg = LEDS[id];
  if (!s || !cfg) return;
  var text = s.on ? (LED_EFFECTS[s.effect] || 'Aan') : 'Uit';
  lampShow('led-' + id + '-switch', 'led-' + id + '-state', s.on, text);
  lampShow(cfg.home + '-switch', cfg.home, s.on, text);
  var panel = document.getElementById('led-panel-' + id);
  if (!panel) return;
  Array.prototype.forEach.call(panel.querySelectorAll('.effect-btn'), function(btn) {
    var active = s.on && parseInt(btn.dataset.effect, 10) === s.effect;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active);
  });
  // de schuif niet onder de vinger vandaan trekken
  var slider = document.getElementById('led-' + id + '-brightness');
  if (slider && document.activeElement !== slider) slider.value = s.brightness;
  var val = document.getElementById('led-' + id + '-brightness-val');
  if (val) val.textContent = Math.round(s.brightness / 255 * 100) + '%';
  var colorRow = document.getElementById('led-' + id + '-color-row');
  if (colorRow) colorRow.hidden = s.effect !== LED_CUSTOM;
  var colorEl = document.getElementById('led-' + id + '-color');
  if (colorEl && s.color && document.activeElement !== colorEl) {
    colorEl.value = '#' + [s.color.r, s.color.g, s.color.b].map(function(v) { return ('0' + Number(v).toString(16)).slice(-2); }).join('');
  }
}
function ledRenderAll() { Object.keys(LEDS).forEach(ledRender); relayRender(); }
function lampJson(r) { if (!r.ok) throw new Error('status ' + r.status); return r.json(); }
// De kaart springt meteen om; lukt het versturen niet, dan gaat hij terug naar hoe het was
function ledSend(id, before) {
  fetch('/api/led/state' + LEDS[id].query, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(ledStates[id])})
    .then(lampJson).then(function(s) { ledStates[id] = s; ledRender(id); })
    .catch(function() {
      if (before) { ledStates[id] = before; ledRender(id); }
      toast((deviceNamesCache[LEDS[id].key] || LEDS[id].name) + ' reageert niet', 'error');
    });
}
function ledChange(id, change) {
  var s = ledStates[id];
  if (!s) return;
  var before = JSON.parse(JSON.stringify(s));
  change(s);
  ledRender(id);
  return before;
}
function ledToggle(id) { var b = ledChange(id, function(s) { s.on = !s.on; }); if (b) ledSend(id, b); }
function ledSetEffect(id, n) { var b = ledChange(id, function(s) { s.effect = n; s.on = true; }); if (b) ledSend(id, b); }
// Schuif en kleurkiezer geven tientallen waarden per seconde: alleen de laatste gaat naar de strip
function ledSendSoon(id, before) {
  clearTimeout(ledSendTimers[id]);
  ledSendTimers[id] = setTimeout(function() { ledSend(id, before); }, 120);
}
function ledSetColor(id, hex) {
  var b = ledChange(id, function(s) { s.color = { r: parseInt(hex.substr(1, 2), 16), g: parseInt(hex.substr(3, 2), 16), b: parseInt(hex.substr(5, 2), 16) }; s.effect = LED_CUSTOM; s.on = true; });
  if (b) ledSendSoon(id, null);
}
function ledBrightness(id, v) {
  var b = ledChange(id, function(s) { s.brightness = parseInt(v, 10); });
  if (b) ledSendSoon(id, null);
}
function ledRefresh(id) {
  fetch('/api/led/state' + LEDS[id].query).then(lampJson).then(function(s) { ledStates[id] = s; ledRender(id); }).catch(function() {});
}

// ── Relais (lamp gang) ──
function relayRender() {
  if (!relayGangState) return;
  var on = !!relayGangState.on, text = on ? 'Aan' : 'Uit';
  lampShow('relay-gang-switch', 'relay-gang-state', on, text);
  lampShow(RELAY.home + '-switch', RELAY.home, on, text);
}
function relayToggle() {
  if (!relayGangState) return;
  var before = !!relayGangState.on;
  relayGangState.on = !before;
  relayRender();
  fetch('/api/relay/state' + RELAY.query, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(relayGangState)})
    .then(lampJson).then(function(s) { relayGangState = s; relayRender(); })
    .catch(function() {
      relayGangState.on = before;
      relayRender();
      toast((deviceNamesCache[RELAY.key] || RELAY.name) + ' reageert niet', 'error');
    });
}
function relayRefresh() {
  fetch('/api/relay/state' + RELAY.query).then(lampJson).then(function(s) { relayGangState = s; relayRender(); }).catch(function() {});
}

function lampsRefresh() { Object.keys(LEDS).forEach(ledRefresh); relayRefresh(); }
lampsRefresh();
// Een flow, een scène of een ander scherm kan een lamp omzetten: Home en Thuis lopen daar binnen een halve minuut mee
setInterval(function() {
  if (document.hidden || !moduleOn('lights') || (currentScreen !== 0 && currentScreen !== 4)) return;
  lampsRefresh();
}, 20000);

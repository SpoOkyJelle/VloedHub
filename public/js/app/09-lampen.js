// ── LED Strip ──
var LED_EFFECTS = ['Warm Wit','Ijs Wit','Rainbow','Rainbow Wave','Fade Aan/Uit','Confetti','Vuur','Meteor Regen','Twinkle','Politielichten','Eigen kleur'];
var ledClientState = {on: true, effect: 0, brightness: 180, color: {r:255,g:255,b:255}};

function buildLedGrid() { updateLedUI(); }

function updateLedUI() {
  var onBtn = document.getElementById('led-onoff');
  if (onBtn) { onBtn.textContent = ledClientState.on ? 'AAN' : 'UIT'; onBtn.style.borderColor = ledClientState.on ? 'rgba(141,178,85,0.5)' : 'rgba(255,255,255,0.1)'; onBtn.style.color = ledClientState.on ? 'var(--accent-l)' : 'var(--muted)'; }
  var nameEl = document.getElementById('led-effect-name');
  if (nameEl) nameEl.textContent = ledClientState.on ? LED_EFFECTS[ledClientState.effect] : 'Uit';
  LED_EFFECTS.forEach(function(_, i) {
    var btn = document.getElementById('led-btn-' + i);
    if (!btn) return;
    var active = i === ledClientState.effect && ledClientState.on;
    btn.style.background = active ? 'rgba(141,178,85,0.25)' : '#1C2140';
    btn.style.borderColor = active ? 'rgba(141,178,85,0.7)' : 'rgba(255,255,255,0.15)';
    btn.style.color = active ? '#BBDD8C' : '#F1F5F9';
  });
  var bEl = document.getElementById('led-brightness'); if (bEl) bEl.value = ledClientState.brightness;
  var bVal = document.getElementById('led-brightness-val'); if (bVal) bVal.textContent = ledClientState.brightness;
  var colorRow = document.getElementById('led-color-row'); if (colorRow) colorRow.style.display = (ledClientState.effect === LED_EFFECTS.length - 1) ? 'flex' : 'none';
  var colorEl = document.getElementById('led-color'); if (colorEl && ledClientState.color) { var toHex = function(v){ return ('0'+Number(v).toString(16)).slice(-2); }; colorEl.value = '#' + toHex(ledClientState.color.r) + toHex(ledClientState.color.g) + toHex(ledClientState.color.b); }
}

function ledToggle() { ledClientState.on = !ledClientState.on; ledSend(); }
function ledSetEffect(n) { ledClientState.effect = n; ledClientState.on = true; ledSend(); }
function ledSetColor(hex) { var r = parseInt(hex.substr(1,2),16), g = parseInt(hex.substr(3,2),16), b = parseInt(hex.substr(5,2),16); ledClientState.color = {r:r,g:g,b:b}; ledClientState.effect = LED_EFFECTS.length - 1; ledClientState.on = true; ledSend(); }
function ledBrightness(v) { ledClientState.brightness = parseInt(v); var bVal = document.getElementById('led-brightness-val'); if (bVal) bVal.textContent = v; ledSend(); }

function ledSend() {
  fetch('/api/led/state', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(ledClientState)})
    .then(function(r){return r.json();}).then(function(s) { ledClientState = s; updateLedUI(); }).catch(function(){});
}

function refreshLedState() {
  fetch('/api/led/state').then(function(r){return r.json();}).then(function(s) { ledClientState = s; updateLedUI(); }).catch(function(){});
}
function ledQuickToggle() {
  ledClientState.on = !ledClientState.on;
  fetch('/api/led/state', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(ledClientState)})
    .then(function(r){return r.json();}).then(function(s) { ledClientState = s; updateHomeLedStatus(); }).catch(function(){});
}
function updateHomeLedStatus() {
  if (!ledClientState) return;
  var el = document.getElementById('home-led-status');
  if (el) el.textContent = ledClientState.on ? 'AAN' : 'UIT';
}

var ledClientState2 = {on: true, effect: 0, brightness: 180, color: {r:255,g:255,b:255}};

function buildLed2Grid() { updateLed2UI(); }

function updateLed2UI() {
  var onBtn = document.getElementById('led2-onoff');
  if (onBtn) { onBtn.textContent = ledClientState2.on ? 'AAN' : 'UIT'; onBtn.style.borderColor = ledClientState2.on ? 'rgba(141,178,85,0.5)' : 'rgba(255,255,255,0.1)'; onBtn.style.color = ledClientState2.on ? 'var(--accent-l)' : 'var(--muted)'; }
  var nameEl = document.getElementById('led2-effect-name');
  if (nameEl) nameEl.textContent = ledClientState2.on ? LED_EFFECTS[ledClientState2.effect] : 'Uit';
  LED_EFFECTS.forEach(function(_, i) {
    var btn = document.getElementById('led2-btn-' + i);
    if (!btn) return;
    var active = i === ledClientState2.effect && ledClientState2.on;
    btn.style.background = active ? 'rgba(141,178,85,0.25)' : '#1C2140';
    btn.style.borderColor = active ? 'rgba(141,178,85,0.7)' : 'rgba(255,255,255,0.15)';
    btn.style.color = active ? '#BBDD8C' : '#F1F5F9';
  });
  var bEl = document.getElementById('led2-brightness'); if (bEl) bEl.value = ledClientState2.brightness;
  var bVal = document.getElementById('led2-brightness-val'); if (bVal) bVal.textContent = ledClientState2.brightness;
  var colorRow = document.getElementById('led2-color-row'); if (colorRow) colorRow.style.display = (ledClientState2.effect === LED_EFFECTS.length - 1) ? 'flex' : 'none';
  var colorEl = document.getElementById('led2-color'); if (colorEl && ledClientState2.color) { var toHex = function(v){ return ('0'+Number(v).toString(16)).slice(-2); }; colorEl.value = '#' + toHex(ledClientState2.color.r) + toHex(ledClientState2.color.g) + toHex(ledClientState2.color.b); }
}

function led2Toggle() { ledClientState2.on = !ledClientState2.on; led2Send(); }
function led2SetEffect(n) { ledClientState2.effect = n; ledClientState2.on = true; led2Send(); }
function led2SetColor(hex) { var r = parseInt(hex.substr(1,2),16), g = parseInt(hex.substr(3,2),16), b = parseInt(hex.substr(5,2),16); ledClientState2.color = {r:r,g:g,b:b}; ledClientState2.effect = LED_EFFECTS.length - 1; ledClientState2.on = true; led2Send(); }
function led2Brightness(v) { ledClientState2.brightness = parseInt(v); var bVal = document.getElementById('led2-brightness-val'); if (bVal) bVal.textContent = v; led2Send(); }

function led2Send() {
  fetch('/api/led/state?device=keuken', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(ledClientState2)})
    .then(function(r){return r.json();}).then(function(s) { ledClientState2 = s; updateLed2UI(); }).catch(function(){});
}

function refreshLed2State() {
  fetch('/api/led/state?device=keuken').then(function(r){return r.json();}).then(function(s) { ledClientState2 = s; updateLed2UI(); }).catch(function(){});
}
function ledKeukenQuickToggle() {
  ledClientState2.on = !ledClientState2.on;
  fetch('/api/led/state?device=keuken', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(ledClientState2)})
    .then(function(r){return r.json();}).then(function(s) { ledClientState2 = s; updateHomeLed2Status(); }).catch(function(){});
}
function updateHomeLed2Status() {
  if (!ledClientState2) return;
  var el = document.getElementById('home-led-keuken-status');
  if (el) el.textContent = ledClientState2.on ? 'AAN' : 'UIT';
}

// ── LED Strip Gang ──
var ledClientState3 = {on: true, effect: 0, brightness: 180, color: {r:255,g:255,b:255}};

function buildLed3Grid() { updateLed3UI(); }

function updateLed3UI() {
  var onBtn = document.getElementById('led3-onoff');
  if (onBtn) { onBtn.textContent = ledClientState3.on ? 'AAN' : 'UIT'; onBtn.style.borderColor = ledClientState3.on ? 'rgba(141,178,85,0.5)' : 'rgba(255,255,255,0.1)'; onBtn.style.color = ledClientState3.on ? 'var(--accent-l)' : 'var(--muted)'; }
  var nameEl = document.getElementById('led3-effect-name');
  if (nameEl) nameEl.textContent = ledClientState3.on ? LED_EFFECTS[ledClientState3.effect] : 'Uit';
  LED_EFFECTS.forEach(function(_, i) {
    var btn = document.getElementById('led3-btn-' + i);
    if (!btn) return;
    var active = i === ledClientState3.effect && ledClientState3.on;
    btn.style.background = active ? 'rgba(141,178,85,0.25)' : '#1C2140';
    btn.style.borderColor = active ? 'rgba(141,178,85,0.7)' : 'rgba(255,255,255,0.15)';
    btn.style.color = active ? '#BBDD8C' : '#F1F5F9';
  });
  var bEl = document.getElementById('led3-brightness'); if (bEl) bEl.value = ledClientState3.brightness;
  var bVal = document.getElementById('led3-brightness-val'); if (bVal) bVal.textContent = ledClientState3.brightness;
  var colorRow = document.getElementById('led3-color-row'); if (colorRow) colorRow.style.display = (ledClientState3.effect === LED_EFFECTS.length - 1) ? 'flex' : 'none';
  var colorEl = document.getElementById('led3-color'); if (colorEl && ledClientState3.color) { var toHex = function(v){ return ('0'+Number(v).toString(16)).slice(-2); }; colorEl.value = '#' + toHex(ledClientState3.color.r) + toHex(ledClientState3.color.g) + toHex(ledClientState3.color.b); }
}

function led3Toggle() { ledClientState3.on = !ledClientState3.on; led3Send(); }
function led3SetEffect(n) { ledClientState3.effect = n; ledClientState3.on = true; led3Send(); }
function led3SetColor(hex) { var r = parseInt(hex.substr(1,2),16), g = parseInt(hex.substr(3,2),16), b = parseInt(hex.substr(5,2),16); ledClientState3.color = {r:r,g:g,b:b}; ledClientState3.effect = LED_EFFECTS.length - 1; ledClientState3.on = true; led3Send(); }
function led3Brightness(v) { ledClientState3.brightness = parseInt(v); var bVal = document.getElementById('led3-brightness-val'); if (bVal) bVal.textContent = v; led3Send(); }

function led3Send() {
  fetch('/api/led/state?device=gang', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(ledClientState3)})
    .then(function(r){return r.json();}).then(function(s) { ledClientState3 = s; updateLed3UI(); }).catch(function(){});
}

function refreshLed3State() {
  fetch('/api/led/state?device=gang').then(function(r){return r.json();}).then(function(s) { ledClientState3 = s; updateLed3UI(); }).catch(function(){});
}
function ledGangQuickToggle() {
  ledClientState3.on = !ledClientState3.on;
  fetch('/api/led/state?device=gang', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(ledClientState3)})
    .then(function(r){return r.json();}).then(function(s) { ledClientState3 = s; updateHomeLed3Status(); }).catch(function(){});
}
function updateHomeLed3Status() {
  if (!ledClientState3) return;
  var el = document.getElementById('home-led-gang-status');
  if (el) el.textContent = ledClientState3.on ? 'AAN' : 'UIT';
}

// ── Relay Gang ──
var relayGangState = {on: false};

function updateRelayGangUI() {
  if (!relayGangState) return;
  var btn = document.getElementById('relay-gang-onoff');
  var txt = document.getElementById('relay-gang-status-text');
  if (btn) { btn.textContent = relayGangState.on ? 'AAN' : 'UIT'; btn.style.borderColor = relayGangState.on ? 'rgba(34,197,94,0.6)' : 'rgba(34,197,94,0.2)'; btn.style.background = relayGangState.on ? 'rgba(34,197,94,0.2)' : 'rgba(34,197,94,0.05)'; btn.style.color = relayGangState.on ? '#4ADE80' : 'var(--muted)'; }
  if (txt) { txt.textContent = relayGangState.on ? 'AAN' : 'UIT'; txt.style.color = relayGangState.on ? '#4ADE80' : 'var(--muted)'; }
  var el = document.getElementById('home-relay-gang-status');
  if (el) el.textContent = relayGangState.on ? 'AAN' : 'UIT';
}

function relayGangToggle() { relayGangState.on = !relayGangState.on; relayGangSend(); }
function relayGangSend() {
  fetch('/api/relay/state?device=gang', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(relayGangState)})
    .then(function(r){return r.json();}).then(function(s) { relayGangState = s; updateRelayGangUI(); }).catch(function(){});
}
function refreshRelayGangState() {
  fetch('/api/relay/state?device=gang').then(function(r){return r.json();}).then(function(s) { relayGangState = s; updateRelayGangUI(); }).catch(function(){});
}
function relayGangQuickToggle() { relayGangState.on = !relayGangState.on; relayGangSend(); }
// Build effect grids now — LED_EFFECTS and all functions are defined above
buildLedGrid(); buildLed2Grid(); buildLed3Grid();

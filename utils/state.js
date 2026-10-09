var fs   = require('fs');
var path = require('path');

var DATA_CUTOFF   = '2026-08-27T00:00:00';
var includeOldData = false;
var STATE_FILE = path.join(__dirname, '../data/lamp-state.json');

var ledStates = {
  "default":   { on: false, effect: 0, brightness: 180, color: { r: 255, g: 255, b: 255 } },
  "keuken":    { on: false, effect: 0, brightness: 180, color: { r: 255, g: 255, b: 255 } },
  "gang":      { on: false, effect: 0, brightness: 180, color: { r: 255, g: 255, b: 255 } },
  "tv-meubel": { on: false, effect: 0, brightness: 120, color: { r: 255, g: 255, b: 255 } }
};

var relayStates = {
  "gang": { on: false }
};

// Load persisted state from disk
try {
  var saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  if (saved.ledStates)   Object.assign(ledStates,   saved.ledStates);
  if (saved.relayStates) Object.assign(relayStates, saved.relayStates);
} catch (e) { /* file doesn't exist yet — use defaults above */ }

function saveState() {
  try {
    var dir = path.dirname(STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify({ ledStates: ledStates, relayStates: relayStates }, null, 2));
  } catch (e) {}
}

function getLedState(device) {
  if (!ledStates[device]) ledStates[device] = { on: false, effect: 0, brightness: 180, color: { r: 255, g: 255, b: 255 } };
  return ledStates[device];
}

function getRelayState(device) {
  if (!relayStates[device]) relayStates[device] = { on: false };
  return relayStates[device];
}

module.exports = {
  get includeOldData() { return includeOldData; },
  set includeOldData(v) { includeOldData = v; },
  DATA_CUTOFF:   DATA_CUTOFF,
  ledStates:     ledStates,
  getLedState:   getLedState,
  relayStates:   relayStates,
  getRelayState: getRelayState,
  saveState:     saveState
};

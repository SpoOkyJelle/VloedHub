// Data completeness cutoff: data before this date was only logged when the app was running
var includeOldData = false;
var DATA_CUTOFF = '2026-08-27T00:00:00';

var ledStates = {
  "default": { on: true, effect: 0, brightness: 180, color: { r: 255, g: 255, b: 255 } },
  "keuken":  { on: true, effect: 0, brightness: 180, color: { r: 255, g: 255, b: 255 } },
  "gang":    { on: true, effect: 0, brightness: 180, color: { r: 255, g: 255, b: 255 } }
};

function getLedState(device) {
  return ledStates[device] || ledStates["default"];
}

// Relay states — keyed by device name, value is { on: bool }
var relayStates = {
  "gang": { on: false }
};

function getRelayState(device) {
  if (!relayStates[device]) relayStates[device] = { on: false };
  return relayStates[device];
}

module.exports = {
  get includeOldData() { return includeOldData; },
  set includeOldData(v) { includeOldData = v; },
  DATA_CUTOFF: DATA_CUTOFF,
  ledStates:      ledStates,
  getLedState:    getLedState,
  relayStates:    relayStates,
  getRelayState:  getRelayState
};

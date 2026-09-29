// Returns a naive Amsterdam-local datetime string (matches how received_at is stored)
function cutoff(ms) {
  return new Date(Date.now() - ms).toLocaleString('sv-SE', { timeZone: 'Europe/Amsterdam' }).replace(' ', 'T');
}

function todayAms() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Amsterdam' }).slice(0, 10);
}

function dateAms(offsetMs) {
  return new Date(Date.now() + offsetMs).toLocaleString('sv-SE', { timeZone: 'Europe/Amsterdam' }).slice(0, 10);
}

// Returns the later of (now - ms) or DATA_CUTOFF, unless old data is included
function effectiveCutoff(ms) {
  var state = require('./state');
  var rel = cutoff(ms);
  if (state.includeOldData) return rel;
  return rel > state.DATA_CUTOFF ? rel : state.DATA_CUTOFF;
}

// Absolute floor for all-time queries
function dataFloor() {
  var state = require('./state');
  return state.includeOldData ? '2000-01-01T00:00:00' : state.DATA_CUTOFF;
}

module.exports = { cutoff: cutoff, todayAms: todayAms, dateAms: dateAms, effectiveCutoff: effectiveCutoff, dataFloor: dataFloor };

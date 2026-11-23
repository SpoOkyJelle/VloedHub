// Alle tijden hier zijn "naive" Amsterdam-lokaal, in hetzelfde formaat als received_at in de database
// ("YYYY-MM-DDTHH:MM:SS"). Eén gedeelde basis, zodat het tijdzone-/formaat-gedoe maar op één plek staat.
function amsString(offsetMs) {
  return new Date(Date.now() + (offsetMs || 0)).toLocaleString('sv-SE', { timeZone: 'Europe/Amsterdam' });
}

// "YYYY-MM-DDTHH:MM:SS" — nu, exact de vorm waarin received_at wordt opgeslagen
function now() {
  return amsString(0).replace(' ', 'T');
}

// Zelfde vorm, maar ms geleden — voor "WHERE received_at >= ?"-vensters
function cutoff(ms) {
  return amsString(-ms).replace(' ', 'T');
}

// "HH:MM" — huidige wandkloktijd (Amsterdam)
function clock() {
  return amsString(0).slice(11, 16);
}

function todayAms() {
  return amsString(0).slice(0, 10);
}

function dateAms(offsetMs) {
  return amsString(offsetMs).slice(0, 10);
}

// De kalenderdag ná dateStr ("YYYY-MM-DD"), als "YYYY-MM-DD". UTC-rekenen is veilig: we tellen exact
// 24 u op een UTC-middernacht op en nemen alleen het datumdeel, dus DST verschuift niets.
function nextDay(dateStr) {
  var d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// [start, end) van één kalenderdag als received_at-strings, voor een index-vriendelijke range-filter
// ("WHERE received_at >= start AND received_at < end") i.p.v. het niet-indexeerbare date(received_at) = ?.
function dayRange(dateStr) {
  return { start: dateStr + 'T00:00:00', end: nextDay(dateStr) + 'T00:00:00' };
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

module.exports = {
  now: now, cutoff: cutoff, clock: clock,
  todayAms: todayAms, dateAms: dateAms, nextDay: nextDay, dayRange: dayRange,
  effectiveCutoff: effectiveCutoff, dataFloor: dataFloor
};

var db = require("./setup");

function logReading(data, callback) {
  var received_at = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Amsterdam' }).replace(' ', 'T');
  var n = function(v) { return v != null ? v : null; };

  db.run(
    "INSERT INTO readings (" +
    "  received_at, device," +
    "  voltage_l1, voltage_l2, voltage_l3," +
    "  current_l1, current_l2, current_l3," +
    "  power_delivered_l1_kw, power_delivered_l2_kw, power_delivered_l3_kw," +
    "  power_returned_l1_kw, power_returned_l2_kw, power_returned_l3_kw," +
    "  power_delivered_total_kw, power_returned_total_kw," +
    "  gas_m3, raw" +
    ") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [
      received_at,
      n(data.device),
      n(data.voltage_l1), n(data.voltage_l2), n(data.voltage_l3),
      n(data.current_l1), n(data.current_l2), n(data.current_l3),
      n(data.power_delivered_l1_kw), n(data.power_delivered_l2_kw), n(data.power_delivered_l3_kw),
      n(data.power_returned_l1_kw), n(data.power_returned_l2_kw), n(data.power_returned_l3_kw),
      n(data.power_delivered_total_kw), n(data.power_returned_total_kw),
      n(data.gas_m3),
      JSON.stringify(data)
    ],
    function(err) {
      if (err) return callback(err);
      console.log(
        "[" + received_at + "] " + (data.device || "unknown") + " - " +
        "delivered=" + data.power_delivered_total_kw + "kW " +
        "returned=" + data.power_returned_total_kw + "kW " +
        "gas=" + data.gas_m3 + "m3"
      );
      callback(null);
    }
  );
}

function logTemperatureReadings(data, callback) {
  var received_at = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Amsterdam' }).replace(' ', 'T');
  var readings = Array.isArray(data.readings) ? data.readings : [];
  var valid = readings.filter(function(r) { return r && typeof r.room === "string" && r.room.length > 0 && typeof r.temp_c === "number" && isFinite(r.temp_c); });

  if (valid.length === 0) {
    return callback(new Error("no valid readings"));
  }

  var stmt = db.prepare("INSERT INTO temperature_readings (received_at, room, temp_c, device) VALUES (?,?,?,?)");
  valid.forEach(function(r) {
    stmt.run([received_at, r.room, r.temp_c, data.device || null]);
  });
  stmt.finalize(function(err) {
    if (err) return callback(err);
    console.log("[" + received_at + "] Temperatuur (" + (data.device || "unknown") + "): " + valid.map(function(r) { return r.room + "=" + r.temp_c + "\u00b0C"; }).join(", "));
    callback(null, received_at);
  });
}

function setWashStatus(state, device, callback) {
  var since = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Amsterdam' }).replace(' ', 'T');
  db.run(
    "INSERT INTO wasmachine_status (id, state, since, device) VALUES (1, ?, ?, ?)" +
    " ON CONFLICT(id) DO UPDATE SET state = excluded.state, since = excluded.since, device = excluded.device",
    [state, since, device || null],
    function(err) {
      if (callback) callback(err, since);
    }
  );
}

function logWashCycle(data, callback) {
  var finished_at = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Amsterdam' }).replace(' ', 'T');
  db.run(
    "INSERT INTO wasmachine_cycles (finished_at, device) VALUES (?,?)",
    [finished_at, data.device || null],
    function(err) {
      if (err) return callback(err);
      console.log("[" + finished_at + "] Wasmachine klaar (" + (data.device || "unknown") + ")");
      callback(null, finished_at);
    }
  );
}

module.exports = { logReading: logReading, logTemperatureReadings: logTemperatureReadings, setWashStatus: setWashStatus, logWashCycle: logWashCycle };

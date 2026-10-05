var path = require("path");
var sqlite3 = require("sqlite3");

var db = new sqlite3.Database(path.join(__dirname, "../p1_data.db"));

db.serialize(function() {
  db.run(
    "CREATE TABLE IF NOT EXISTS readings (" +
    "  id INTEGER PRIMARY KEY AUTOINCREMENT," +
    "  received_at TEXT NOT NULL," +
    "  device TEXT," +
    "  voltage_l1 REAL, voltage_l2 REAL, voltage_l3 REAL," +
    "  current_l1 REAL, current_l2 REAL, current_l3 REAL," +
    "  power_delivered_l1_kw REAL, power_delivered_l2_kw REAL, power_delivered_l3_kw REAL," +
    "  power_returned_l1_kw REAL, power_returned_l2_kw REAL, power_returned_l3_kw REAL," +
    "  power_delivered_total_kw REAL," +
    "  power_returned_total_kw REAL," +
    "  gas_m3 REAL," +
    "  raw TEXT NOT NULL" +
    ")"
  );

  // Migrate UTC timestamps to local time (Europe/Amsterdam = UTC+1/+2)
  // Only runs once: skips rows that are already in local time (no trailing Z, not starting with UTC offset)
  db.run(
    "UPDATE readings SET received_at = datetime(received_at, '+2 hours')" +
    " WHERE received_at LIKE '%Z' OR received_at LIKE '%+00:00'"
  );

  // Migrate older single-column schema if needed
  var oldCols = ["voltage_l1","voltage_l2","voltage_l3","current_l1","current_l2","current_l3",
    "power_delivered_l1_kw","power_delivered_l2_kw","power_delivered_l3_kw",
    "power_returned_l1_kw","power_returned_l2_kw","power_returned_l3_kw",
    "power_delivered_total_kw","power_returned_total_kw"];
  oldCols.forEach(function(col) {
    db.run("ALTER TABLE readings ADD COLUMN " + col + " REAL", function() {});
  });

  db.run(
    "CREATE TABLE IF NOT EXISTS wasmachine_cycles (" +
    "  id INTEGER PRIMARY KEY AUTOINCREMENT," +
    "  finished_at TEXT NOT NULL," +
    "  device TEXT" +
    ")"
  );

  db.run(
    "CREATE TABLE IF NOT EXISTS wasmachine_status (" +
    "  id INTEGER PRIMARY KEY CHECK (id = 1)," +
    "  state TEXT NOT NULL," +
    "  since TEXT NOT NULL," +
    "  device TEXT" +
    ")"
  );

  db.run(
    "CREATE TABLE IF NOT EXISTS temperature_readings (" +
    "  id INTEGER PRIMARY KEY AUTOINCREMENT," +
    "  received_at TEXT NOT NULL," +
    "  room TEXT NOT NULL," +
    "  temp_c REAL," +
    "  device TEXT" +
    ")"
  );

  db.run(
    "CREATE TABLE IF NOT EXISTS esphome_readings (" +
    "  id INTEGER PRIMARY KEY AUTOINCREMENT," +
    "  received_at TEXT NOT NULL," +
    "  device TEXT NOT NULL," +
    "  sensor_name TEXT NOT NULL," +
    "  value REAL," +
    "  value_text TEXT," +
    "  unit TEXT" +
    ")"
  );
  db.run("ALTER TABLE esphome_readings ADD COLUMN value_text TEXT", function() {});
  db.run("ALTER TABLE esphome_readings ADD COLUMN host TEXT", function() {});

  db.run(
    "CREATE TABLE IF NOT EXISTS flows (" +
    "  id INTEGER PRIMARY KEY AUTOINCREMENT," +
    "  name TEXT NOT NULL DEFAULT 'Naamloos'," +
    "  enabled INTEGER NOT NULL DEFAULT 1," +
    "  data TEXT NOT NULL DEFAULT '{}'," +
    "  created_at TEXT NOT NULL," +
    "  last_run TEXT" +
    ")"
  );

  // Migrate: add last_run column to existing flows table if missing
  db.run("ALTER TABLE flows ADD COLUMN last_run TEXT", function() {});

  db.run(
    "CREATE TABLE IF NOT EXISTS flow_runs (" +
    "  id INTEGER PRIMARY KEY AUTOINCREMENT," +
    "  flow_id INTEGER NOT NULL," +
    "  triggered_at TEXT NOT NULL," +
    "  actions TEXT NOT NULL DEFAULT '[]'" +
    ")"
  );
});

module.exports = db;

var path = require("path");
var sqlite3 = require("sqlite3");

var db = new sqlite3.Database(path.join(__dirname, "../p1_data.db"));

db.serialize(function() {
  // WAL: lezers (de grafiek-/stat-queries van de pagina's) worden niet meer geblokkeerd door de
  // constante P1-logging die eroverheen schrijft. synchronous=NORMAL is veilig onder WAL en scheelt
  // schrijf-latency. Dit maakt de dashboards merkbaar sneller op een draaiende server.
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA synchronous = NORMAL");

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
  // Luchtvochtigheid komt erbij (o.a. de Tapo T310 in de badkamer); oudere rijen hebben hem niet
  db.run("ALTER TABLE temperature_readings ADD COLUMN humidity REAL", function() {});

  // Vermogenshistorie van de Tapo-stekker (P410M) per poll, voor de wasmachine-trend
  db.run(
    "CREATE TABLE IF NOT EXISTS tapo_power (" +
    "  id INTEGER PRIMARY KEY AUTOINCREMENT," +
    "  received_at TEXT NOT NULL," +
    "  device TEXT," +
    "  watts REAL" +
    ")"
  );
  db.run("CREATE INDEX IF NOT EXISTS idx_tapo_power_received ON tapo_power (received_at)", function() {});

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

  // Stookhistorie per kamer: gevraagde temperatuur (setpoint), actuele temperatuur en het stookpercentage,
  // fijnmazig gelogd tijdens het opwarmen (zie services/tado.js logHeating). Hiermee reken je uit hoelang
  // een kamer erover doet om op peil te komen, en combineer je dat met het gasverbruik uit `readings`.
  db.run(
    "CREATE TABLE IF NOT EXISTS heating_readings (" +
    "  id INTEGER PRIMARY KEY AUTOINCREMENT," +
    "  received_at TEXT NOT NULL," +
    "  room TEXT NOT NULL," +
    "  setpoint_c REAL," +
    "  temp_c REAL," +
    "  heating_power REAL," +
    "  device TEXT" +
    ")"
  );

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

  // ── Indexen ─────────────────────────────────────────────────────────────────
  // Afgestemd op de werkelijke WHERE/ORDER BY/GROUP BY van de routes. Eerste aanmaak op een al
  // volle readings-tabel kost eenmalig wat tijd bij het opstarten; daarna slaat IF NOT EXISTS over.

  // readings: vrijwel elke grafiek/stat filtert op "received_at >= ?" (costs, insights, p1, party,
  // homeconnect, heatmap, voltage-dips). Zonder index = full scan over miljoenen rijen.
  db.run("CREATE INDEX IF NOT EXISTS idx_readings_received ON readings (received_at)", function() {});

  // temperature_readings: laatste-per-kamer (MAX(id) GROUP BY room), historie-range, en de
  // tapo-klimaatreeks (device + range).
  db.run("CREATE INDEX IF NOT EXISTS idx_temp_room_id ON temperature_readings (room, id)", function() {});
  db.run("CREATE INDEX IF NOT EXISTS idx_temp_received ON temperature_readings (received_at)", function() {});
  db.run("CREATE INDEX IF NOT EXISTS idx_temp_device_received ON temperature_readings (device, received_at)", function() {});

  // esphome_readings: laatste-per-sensor (MAX(id) GROUP BY device, sensor_name) en historie-range.
  db.run("CREATE INDEX IF NOT EXISTS idx_esphome_dev_sensor_id ON esphome_readings (device, sensor_name, id)", function() {});
  db.run("CREATE INDEX IF NOT EXISTS idx_esphome_received ON esphome_readings (received_at)", function() {});

  // heating_readings: laatste-per-kamer (MAX(id) GROUP BY room) en historie-range voor de opwarmcurve.
  db.run("CREATE INDEX IF NOT EXISTS idx_heating_room_id ON heating_readings (room, id)", function() {});
  db.run("CREATE INDEX IF NOT EXISTS idx_heating_received ON heating_readings (received_at)", function() {});

  // flow_runs: lijst per flow (WHERE flow_id = ? ORDER BY id DESC) en de opschoon-query (bewaar 100).
  db.run("CREATE INDEX IF NOT EXISTS idx_flow_runs_flow_id ON flow_runs (flow_id, id)", function() {});

  // Laat de query-planner de nieuwe indexen meteen goed inzetten.
  db.run("PRAGMA optimize");
});

module.exports = db;

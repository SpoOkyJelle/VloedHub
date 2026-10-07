var fs = require("fs");
var path = require("path");

// Koelkastdata staat in een Azure SQL-database (tabel ingest.fridge_status).
// Inloggegevens komen uit omgevingsvariabelen, of anders uit data/fridge.json (staat niet in git):
//   FRIDGE_SQL_SERVER, FRIDGE_SQL_DATABASE, FRIDGE_SQL_USER, FRIDGE_SQL_PASSWORD
var CONFIG_FILE = path.join(__dirname, "../data/fridge.json");
var DEFAULT_SERVER = "pulles-sqlserver.database.windows.net";
var CACHE_TTL = 5 * 60 * 1000;

var QUERY =
  "SELECT TOP 1 Puid, LoadTimestampUtc, model_type," +
  " refrigerator_real_temperature, freeze_real_temperature, variation_real_temperature," +
  " refrigerator_temperature, freeze_temperature, variation_temperature," +
  " environment_real_temperature, environment_humidity," +
  " refr_room, free_room, vari_room" +
  " FROM ingest.fridge_status ORDER BY LoadTimestampUtc DESC";

var pool = null;
var cache = { data: null, fetchedAt: 0 };

function getConfig() {
  var file = {};
  try { file = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")); } catch (e) {}
  var cfg = {
    server:   process.env.FRIDGE_SQL_SERVER   || file.server || DEFAULT_SERVER,
    database: process.env.FRIDGE_SQL_DATABASE || file.database,
    user:     process.env.FRIDGE_SQL_USER     || file.user,
    password: process.env.FRIDGE_SQL_PASSWORD || file.password
  };
  return (cfg.database && cfg.user && cfg.password) ? cfg : null;
}

// De kolommen zijn tekst; lege of niet-numerieke waarden worden null
function num(v) {
  if (v == null || v === "") return null;
  var n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function present(flag) {
  return flag == null || flag === "" || String(flag) === "1" || String(flag).toLowerCase() === "true";
}

function toMs(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.getTime();
  var s = String(v).replace(" ", "T");
  var ms = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + "Z");
  return isNaN(ms) ? null : ms;
}

function shape(row) {
  var updated = toMs(row.LoadTimestampUtc);
  var compartments = [
    { key: "refrigerator", label: "Koelkast", on: present(row.refr_room), temp: num(row.refrigerator_real_temperature), setpoint: num(row.refrigerator_temperature) },
    { key: "freezer",      label: "Vriezer",  on: present(row.free_room), temp: num(row.freeze_real_temperature),       setpoint: num(row.freeze_temperature) },
    { key: "variation",    label: "Variabel", on: present(row.vari_room), temp: num(row.variation_real_temperature),    setpoint: num(row.variation_temperature) }
  ].filter(function(c) { return c.on && (c.temp != null || c.setpoint != null); })
   .map(function(c) { return { key: c.key, label: c.label, temp: c.temp, setpoint: c.setpoint }; });
  return {
    configured: true,
    ok: true,
    model: row.model_type || null,
    updated: updated ? new Date(updated).toISOString() : null,
    compartments: compartments,
    environment: { temp: num(row.environment_real_temperature), humidity: num(row.environment_humidity) }
  };
}

function fetchStatus(cb) {
  var cfg = getConfig();
  if (!cfg) return cb(null, { configured: false });
  if (cache.data && Date.now() - cache.fetchedAt < CACHE_TTL) return cb(null, cache.data);

  var sql;
  try { sql = require("mssql"); }
  catch (e) { return cb(null, { configured: true, ok: false, error: "Pakket mssql ontbreekt (voer npm install uit)" }); }

  function fail(err) {
    if (pool) { try { pool.close(); } catch (e) {} }
    pool = null;
    console.error("[koelkast]", err && err.message);
    cb(null, { configured: true, ok: false, error: "Database niet bereikbaar" });
  }

  var ready = pool ? Promise.resolve(pool) : new sql.ConnectionPool({
    server: cfg.server, database: cfg.database, user: cfg.user, password: cfg.password,
    options: { encrypt: true, trustServerCertificate: false },
    connectionTimeout: 15000, requestTimeout: 15000,
    pool: { max: 2, min: 0, idleTimeoutMillis: 60000 }
  }).connect();

  ready.then(function(p) {
    pool = p;
    return p.request().query(QUERY);
  }).then(function(result) {
    var row = result.recordset && result.recordset[0];
    var data = row ? shape(row) : { configured: true, ok: true, updated: null, compartments: [], environment: {} };
    cache = { data: data, fetchedAt: Date.now() };
    cb(null, data);
  }).catch(fail);
}

// Verbindingstest voor de debugpagina: eigen verbinding (niet de gedeelde pool, geen cache), stap voor stap,
// met de echte foutmelding van de database erbij. Het wachtwoord komt nergens in het antwoord voor.
function testConnection(cb) {
  var file = {};
  try { file = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")); } catch (e) {}
  var raw = {
    server:   process.env.FRIDGE_SQL_SERVER   || file.server || DEFAULT_SERVER,
    database: process.env.FRIDGE_SQL_DATABASE || file.database,
    user:     process.env.FRIDGE_SQL_USER     || file.user,
    password: process.env.FRIDGE_SQL_PASSWORD || file.password
  };
  var missing = ["database", "user", "password"].filter(function(k) { return !raw[k]; });
  var out = { server: raw.server, database: raw.database || null, user: raw.user || null, steps: [] };
  function step(name, ok, started, detail) { out.steps.push({ name: name, ok: ok, ms: started ? Date.now() - started : null, detail: detail || null }); }
  function message(err) { return (err && (err.code ? err.code + ": " : "") + (err.message || String(err))) || "onbekende fout"; }

  step("Instellingen", !missing.length, null, missing.length ? "Ontbreekt: " + missing.join(", ") + " (data/fridge.json of FRIDGE_SQL_*)" : "compleet");
  if (missing.length) return cb(out);

  var sql;
  try { sql = require("mssql"); }
  catch (e) {
    // de echte reden erbij: "niet gevonden" is iets anders dan "laadt niet onder deze Node-versie"
    step("Pakket mssql laden", false, null, message(e).split("\n")[0] + " — Node " + process.version + ", map " + path.join(__dirname, ".."));
    return cb(out);
  }

  var t = Date.now();
  var testPool = new sql.ConnectionPool({
    server: raw.server, database: raw.database, user: raw.user, password: raw.password,
    options: { encrypt: true, trustServerCertificate: false },
    connectionTimeout: 15000, requestTimeout: 15000,
    pool: { max: 1, min: 0 }
  });
  function finish() { try { testPool.close(); } catch (e) {} cb(out); }
  testPool.connect().then(function() {
    step("Verbinden en inloggen", true, t);
    t = Date.now();
    return testPool.request().query("SELECT 1 AS ok").then(function() {
      step("SELECT 1", true, t);
      t = Date.now();
      return testPool.request().query("SELECT TOP 1 LoadTimestampUtc, model_type FROM ingest.fridge_status ORDER BY LoadTimestampUtc DESC").then(function(result) {
        var row = result.recordset && result.recordset[0];
        var ms = row ? toMs(row.LoadTimestampUtc) : null;
        step("Laatste rij uit ingest.fridge_status", true, t, row ? "meting van " + (ms ? new Date(ms).toISOString() : "onbekende tijd") + (row.model_type ? " · " + row.model_type : "") : "tabel is leeg");
      }, function(err) { step("Laatste rij uit ingest.fridge_status", false, t, message(err)); });
    }, function(err) { step("SELECT 1", false, t, message(err)); });
  }, function(err) { step("Verbinden en inloggen", false, t, message(err)); }).then(finish, finish);
}

module.exports = { fetchStatus: fetchStatus, getConfig: getConfig, shape: shape, testConnection: testConnection };

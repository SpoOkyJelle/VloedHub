var execFile = require("child_process").execFile;
var db = require("../db/setup");
var time = require("../utils/time");
var auth = require("./auth");
var modules = require("./modules");

// Meet de internetsnelheid met de Speedtest CLI van Ookla (https://www.speedtest.net/apps/cli).
// Die moet op de machine van de server staan; staat hij niet in het PATH, zet dan het volledige pad
// in data/config.json onder internet.path. Gemeten wordt de verbinding van die machine zelf.
var TEST_INTERVAL = 60 * 60 * 1000; // een test kost op een snelle lijn honderden MB's; niet vaker dan dit
var FIRST_TEST    = 2 * 60 * 1000;
var TEST_TIMEOUT  = 3 * 60 * 1000;
var KEEP_DAYS     = 90;

db.run(
  "CREATE TABLE IF NOT EXISTS internet_tests (" +
  "  id INTEGER PRIMARY KEY AUTOINCREMENT," +
  "  measured_at TEXT NOT NULL," +
  "  download_mbps REAL," +
  "  upload_mbps REAL," +
  "  ping_ms REAL," +
  "  jitter_ms REAL," +
  "  packet_loss REAL," +
  "  isp TEXT," +
  "  server TEXT" +
  ")"
);

var running = false;
var lastError = null;   // waarom de laatste poging mislukte; null als die lukte

function binary() {
  var cfg = auth.readConfig().internet;
  return (cfg && cfg.path) || "speedtest";
}

function round(v, d) {
  var f = Math.pow(10, d);
  return Math.round(v * f) / f;
}

// Zet de JSON van de Speedtest CLI om naar één meting; null als het geen bruikbaar resultaat is.
// bandwidth is in bytes per seconde.
function parse(out) {
  var r;
  try { r = JSON.parse(String(out).trim().split("\n").pop()); } catch (e) { return null; }
  if (!r || r.type !== "result" || !r.download || !r.upload) return null;
  var ping = r.ping || {};
  return {
    download_mbps: round(r.download.bandwidth * 8 / 1e6, 2),
    upload_mbps:   round(r.upload.bandwidth * 8 / 1e6, 2),
    ping_ms:       ping.latency != null ? round(ping.latency, 1) : null,
    jitter_ms:     ping.jitter != null ? round(ping.jitter, 1) : null,
    packet_loss:   r.packetLoss != null ? round(r.packetLoss, 1) : null,
    isp:           r.isp || null,
    server:        r.server ? [r.server.name, r.server.location].filter(Boolean).join(", ") : null
  };
}

function explain(err, stderr) {
  if (err.code === "ENOENT") return "Speedtest CLI niet gevonden op de server";
  if (err.killed) return "Snelheidstest duurde te lang";
  // De Python-variant (speedtest-cli) heet ook 'speedtest' maar kent deze opties niet
  if (/unrecognized arguments|usage: speedtest/i.test(stderr || "")) return "Verkeerde speedtest gevonden: de Ookla Speedtest CLI is nodig";
  return "Snelheidstest mislukt";
}

// cb(foutmelding of null, meting)
function run(cb) {
  if (running) return cb && cb("Er loopt al een test");
  running = true;
  execFile(binary(), ["--format=json", "--accept-license", "--accept-gdpr"], { timeout: TEST_TIMEOUT, windowsHide: true }, function(err, stdout, stderr) {
    running = false;
    var m = err ? null : parse(stdout);
    if (!m) {
      lastError = err ? explain(err, stderr) : "Uitvoer van de snelheidstest niet leesbaar";
      console.error("[internet]", lastError, err ? "(" + (String(stderr).trim().split("\n")[0] || err.message) + ")" : "");
      return cb && cb(lastError);
    }
    lastError = null;
    db.run(
      "INSERT INTO internet_tests (measured_at, download_mbps, upload_mbps, ping_ms, jitter_ms, packet_loss, isp, server) VALUES (?,?,?,?,?,?,?,?)",
      [time.cutoff(0), m.download_mbps, m.upload_mbps, m.ping_ms, m.jitter_ms, m.packet_loss, m.isp, m.server],
      function(dbErr) {
        if (dbErr) console.error("[internet]", dbErr.message);
        db.run("DELETE FROM internet_tests WHERE measured_at < ?", [time.cutoff(KEEP_DAYS * 24 * 3600 * 1000)], function() {});
        if (cb) cb(null, m);
      }
    );
  });
}

// cb({ running, error, latest })
function getStatus(cb) {
  db.get("SELECT * FROM internet_tests ORDER BY id DESC LIMIT 1", function(err, row) {
    cb({ running: running, error: lastError, latest: row || null, interval_min: TEST_INTERVAL / 60000 });
  });
}

// cb(metingen van de afgelopen dagen, oudste eerst)
function history(days, cb) {
  days = Math.max(1, Math.min(KEEP_DAYS, parseInt(days, 10) || 7));
  db.all(
    "SELECT measured_at, download_mbps, upload_mbps, ping_ms FROM internet_tests WHERE measured_at >= ? ORDER BY id",
    [time.cutoff(days * 24 * 3600 * 1000)],
    function(err, rows) { cb(rows || []); }
  );
}

function check() {
  if (!modules.isOn("internet")) return;
  run();
}

function start() {
  setTimeout(check, FIRST_TEST);
  setInterval(check, TEST_INTERVAL);
}

module.exports = { run: run, parse: parse, getStatus: getStatus, history: history, check: check, start: start };

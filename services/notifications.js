var db = require("../db/setup");
var time = require("../utils/time");

// Alle meldingen die VloedHub doet (weer, storingen, apparaten, wasmachine, vaatwasser, flows, …) komen hier
// in een logboek, los van Discord: ook als Discord uit staat of niet is ingesteld zijn ze terug te lezen.
var KEEP = 500;

db.run(
  "CREATE TABLE IF NOT EXISTS notifications (" +
  "  id INTEGER PRIMARY KEY AUTOINCREMENT," +
  "  created_at TEXT NOT NULL," +
  "  category TEXT NOT NULL," +
  "  message TEXT NOT NULL" +
  ")"
);

function add(category, message) {
  db.run(
    "INSERT INTO notifications (created_at, category, message) VALUES (?,?,?)",
    [time.cutoff(0), String(category || "overig"), String(message || "")],
    function(err) {
      if (err) return console.error("[meldingen]", err.message);
      db.run("DELETE FROM notifications WHERE id NOT IN (SELECT id FROM notifications ORDER BY id DESC LIMIT ?)", [KEEP], function() {});
    }
  );
}

function list(limit, cb) {
  db.all(
    "SELECT id, created_at, category, message FROM notifications ORDER BY id DESC LIMIT ?",
    [Math.max(1, Math.min(KEEP, parseInt(limit, 10) || 50))],
    function(err, rows) { cb(rows || []); }
  );
}

function clear(cb) {
  db.run("DELETE FROM notifications", function() { if (cb) cb(); });
}

module.exports = { add: add, list: list, clear: clear };

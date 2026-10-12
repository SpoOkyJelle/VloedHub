var db = require("../db/setup");
var time = require("../utils/time");

// Alle meldingen die VloedHub doet (weer, storingen, apparaten, wasmachine, vaatwasser, flows, …) komen hier
// in een logboek, los van Discord: ook als Discord uit staat of niet is ingesteld zijn ze terug te lezen.
// Een melding is voor iedereen, of persoonlijk voor één gebruiker (user_id). Per gebruiker wordt bijgehouden tot
// waar die de meldingen gezien heeft en tot waar hij ze gewist heeft; wissen haalt ze dus alleen bij jezelf weg.
var KEEP = 500;

db.serialize(function() {
  db.run(
    "CREATE TABLE IF NOT EXISTS notifications (" +
    "  id INTEGER PRIMARY KEY AUTOINCREMENT," +
    "  created_at TEXT NOT NULL," +
    "  category TEXT NOT NULL," +
    "  message TEXT NOT NULL" +
    ")"
  );
  // Migrate: add user_id column to an existing notifications table if missing
  db.run("ALTER TABLE notifications ADD COLUMN user_id TEXT", function() {});
  db.run(
    "CREATE TABLE IF NOT EXISTS notification_state (" +
    "  user_id TEXT PRIMARY KEY," +
    "  seen_id INTEGER NOT NULL DEFAULT 0," +
    "  cleared_id INTEGER NOT NULL DEFAULT 0" +
    ")"
  );
});

// userId: alleen voor die gebruiker; weggelaten is de melding voor iedereen
function add(category, message, userId) {
  db.run(
    "INSERT INTO notifications (created_at, category, message, user_id) VALUES (?,?,?,?)",
    [time.cutoff(0), String(category || "overig"), String(message || ""), userId || null],
    function(err) {
      if (err) return console.error("[meldingen]", err.message);
      db.run("DELETE FROM notifications WHERE id NOT IN (SELECT id FROM notifications ORDER BY id DESC LIMIT ?)", [KEEP], function() {});
    }
  );
}

function state(userId, cb) {
  if (!userId) return cb({ seen: 0, cleared: 0 });
  db.get("SELECT seen_id, cleared_id FROM notification_state WHERE user_id = ?", [userId], function(err, row) {
    cb({ seen: (row && row.seen_id) || 0, cleared: (row && row.cleared_id) || 0 });
  });
}

// De meldingen voor deze gebruiker: die voor iedereen plus zijn eigen, zonder wat hij gewist heeft.
// Zonder gebruiker (iedereen deelt nog één PIN) alleen die voor iedereen. cb(rijen, tot welke melding gezien)
function list(limit, userId, cb) {
  state(userId, function(st) {
    db.all(
      "SELECT id, created_at, category, message, user_id IS NOT NULL AS personal FROM notifications" +
      " WHERE (user_id IS NULL OR user_id = ?) AND id > ? ORDER BY id DESC LIMIT ?",
      [userId || "", st.cleared, Math.max(1, Math.min(KEEP, parseInt(limit, 10) || 50))],
      function(err, rows) { cb((rows || []).map(function(r) { r.personal = !!r.personal; return r; }), st.seen); }
    );
  });
}

// Onthoudt tot welke melding deze gebruiker ze gezien heeft, zodat het bolletje op al zijn apparaten klopt
function markSeen(userId, id, cb) {
  id = parseInt(id, 10) || 0;
  db.run(
    "INSERT INTO notification_state (user_id, seen_id) VALUES (?,?)" +
    " ON CONFLICT(user_id) DO UPDATE SET seen_id = MAX(seen_id, excluded.seen_id)",
    [userId, id], function() { if (cb) cb(); }
  );
}

// Wissen: voor een gebruiker verdwijnt alles tot nu toe uit zijn eigen overzicht; zonder gebruikers wordt het logboek geleegd
function clear(userId, cb) {
  if (!userId) return db.run("DELETE FROM notifications", function() { if (cb) cb(); });
  db.run(
    "INSERT INTO notification_state (user_id, seen_id, cleared_id)" +
    " SELECT ?, COALESCE(MAX(id), 0), COALESCE(MAX(id), 0) FROM notifications WHERE true" +
    " ON CONFLICT(user_id) DO UPDATE SET seen_id = excluded.seen_id, cleared_id = excluded.cleared_id",
    [userId], function() { if (cb) cb(); }
  );
}

// Een verwijderde gebruiker laat niets achter
function forget(userId) {
  db.run("DELETE FROM notifications WHERE user_id = ?", [userId], function() {});
  db.run("DELETE FROM notification_state WHERE user_id = ?", [userId], function() {});
}

module.exports = { add: add, list: list, markSeen: markSeen, clear: clear, forget: forget };

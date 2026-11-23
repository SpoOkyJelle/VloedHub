// Promise-schil om de sqlite3-database, zodat handlers met meerdere queries als async/await geschreven
// kunnen worden i.p.v. geneste callbacks ("pyramid of doom"). Zelfde onderliggende verbinding als db/setup.
//
// Let op de router: elke route-module moet synchroon true/false teruggeven (zie server.js). Maak de
// geëxporteerde route-functie dus NIET async; match de URL synchroon, return true, en doe het
// async-werk in een losse (async () => { ... })() met een try/catch eromheen.
var db = require("./setup");

function get(sql, params) {
  return new Promise(function(resolve, reject) {
    db.get(sql, params || [], function(err, row) { if (err) reject(err); else resolve(row); });
  });
}

function all(sql, params) {
  return new Promise(function(resolve, reject) {
    db.all(sql, params || [], function(err, rows) { if (err) reject(err); else resolve(rows || []); });
  });
}

// resolve met het statement-object (this), zodat lastID / changes beschikbaar zijn na een INSERT/UPDATE
function run(sql, params) {
  return new Promise(function(resolve, reject) {
    db.run(sql, params || [], function(err) { if (err) reject(err); else resolve(this); });
  });
}

module.exports = { get: get, all: all, run: run, raw: db };

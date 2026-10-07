var fs = require("fs");
var path = require("path");
var db = require("../db/setup");
var state = require("../utils/state");
var discord = require("./discord");
var fridge = require("./fridge");
var modules = require("./modules");
var auth = require("./auth");

// Bewaakt of apparaten nog berichten sturen en meldt via Discord als er één wegvalt of terugkomt.
var CHECK_INTERVAL = 60 * 1000;
var STARTUP_GRACE  = 5 * 60 * 1000;        // na een herstart eerst iedereen de kans geven zich te melden
var FORGET_AFTER   = 7 * 24 * 3600 * 1000; // sensoren die al een week weg zijn worden niet meer bewaakt

// Na hoeveel stilte een apparaat als offline telt
var LIMITS = {
  p1:          5 * 60 * 1000,  // stuurt elke 15 s
  temperature: 10 * 60 * 1000, // stuurt elke 60 s
  esphome:     15 * 60 * 1000,
  polling:     2 * 60 * 1000,  // ledstrips en relais vragen elke halve seconde hun stand op
  fridge:      90 * 60 * 1000  // schrijft maar eens per 30 tot 60 minuten een meting weg
};

// Apparaten waarvan stilte niets zegt: de koelkast meldt zich te onregelmatig en de ledstrip in de keuken
// gaat met de wandschakelaar van de stroom af. Ze staan wel in de lijst, maar geven geen melding.
// Per apparaat om te zetten bij Instellingen > Apparaatstatus (bewaard in data/config.json).
var QUIET_BY_DEFAULT = { "fridge": true, "led::keuken": true };

var DEFAULT_NAMES = { "led::default": "LED Strip", "led::keuken": "Ledstrip Keuken", "led::gang": "Ledstrip Gang", "relay::gang": "Lamp Gang" };
var NAMES_FILE = path.join(__dirname, "../data/device-names.json");

var startedAt = Date.now();
var polled = {};   // key -> tijdstip (ms) van het laatste verzoek van een ledstrip of relais
var known = {};    // key -> laatst gemelde toestand (true = online)

function localString(ms) {
  return new Date(ms).toLocaleString("sv-SE", { timeZone: "Europe/Amsterdam" });
}

// Tijdstempels zijn lokale tijd zonder zone; voor een verschil is het genoeg ze allebei als UTC te lezen.
function ageMs(local) {
  return Date.parse(localString(Date.now()).replace(" ", "T") + "Z") - Date.parse(local.replace(" ", "T") + "Z");
}

function seen(key) {
  polled[key] = Date.now();
}

function notifies(key) {
  var saved = auth.readConfig().monitorNotify || {};
  return saved[key] != null ? !!saved[key] : !QUIET_BY_DEFAULT[key];
}

function setNotify(key, on) {
  var cfg = auth.readConfig();
  if (!cfg.monitorNotify) cfg.monitorNotify = {};
  cfg.monitorNotify[key] = !!on;
  auth.writeConfig(cfg);
}

function deviceNames() {
  try { return JSON.parse(fs.readFileSync(NAMES_FILE, "utf8")); } catch (e) { return {}; }
}

// cb(lijst van { key, name, last_seen, limit_min, online, notify })
function getStatus(cb) {
  var list = [];
  var names = deviceNames();

  function add(key, name, lastSeen, limit, module) {
    if (module && !modules.isOn(module)) return;
    var age = lastSeen ? ageMs(lastSeen) : null;
    if (age != null && age > FORGET_AFTER) return;
    list.push({ key: key, name: name, last_seen: lastSeen, limit_min: limit / 60000, online: age != null && age <= limit, notify: notifies(key) });
  }

  // Ledstrips en relais: alleen apparaten die zich ooit gemeld hebben (dan is hun ip bewaard)
  [["led::", state.ledStates], ["relay::", state.relayStates]].forEach(function(group) {
    Object.keys(group[1]).forEach(function(device) {
      var key = group[0] + device;
      if (!group[1][device].ip && !polled[key]) return;
      add(key, names[key] || DEFAULT_NAMES[key] || key, polled[key] ? localString(polled[key]) : null, LIMITS.polling, "lights");
    });
  });

  db.get("SELECT MAX(received_at) as last FROM readings", function(err, row) {
    if (row && row.last) add("p1", "P1-meter", row.last, LIMITS.p1);
    db.all("SELECT room, MAX(received_at) as last FROM temperature_readings GROUP BY room", function(err2, rooms) {
      (rooms || []).forEach(function(r) { add("temp::" + r.room, "Temperatuursensor " + r.room, r.last, LIMITS.temperature, "temperature"); });
      db.all("SELECT device, MAX(received_at) as last FROM esphome_readings GROUP BY device", function(err3, devices) {
        (devices || []).forEach(function(d) { add("esphome::" + d.device, "ESPHome " + d.device, d.last, LIMITS.esphome, "esphome"); });
        if (!fridge.getConfig() || !modules.isOn("fridge")) return cb(list);
        fridge.fetchStatus(function(err4, f) {
          if (f && f.ok && f.updated) add("fridge", "Koelkast", localString(Date.parse(f.updated)), LIMITS.fridge);
          cb(list);
        });
      });
    });
  });
}

function check() {
  if (Date.now() - startedAt < STARTUP_GRACE) return;
  getStatus(function(list) {
    list.forEach(function(d) {
      var before = known[d.key];
      known[d.key] = d.online;
      if (before === d.online || !d.notify) return;
      if (!d.online) {
        discord.notify("apparaat", "⚠️ **" + d.name + " is offline** — " +
          (d.last_seen ? "laatste bericht om " + d.last_seen.slice(11, 16) : "nog niets ontvangen sinds de server is gestart"));
      } else if (before === false) {
        discord.notify("apparaat", "✅ **" + d.name + " is weer online**");
      }
    });
  });
}

function start() {
  setInterval(check, CHECK_INTERVAL);
}

// Vlak na een herstart is nog niet te zeggen wie er offline is
function isReady() { return Date.now() - startedAt >= STARTUP_GRACE; }

module.exports = { start: start, seen: seen, getStatus: getStatus, setNotify: setNotify, check: check, isReady: isReady };

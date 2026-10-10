var fs = require("fs");
var path = require("path");
var db = require("../db/setup");
var state = require("../utils/state");
var prices = require("./prices");

// Feeststand: voor een avond met gasten. Zolang hij aan staat
//  - verwelkomt de ledstrip in de gang wie aanbelt, en telt elke keer aanbellen als een gast,
//  - staat er een proostknop bij de scènes die alle ledstrips even op confetti zet,
//  - houdt VloedHub bij hoe de avond verliep; na afloop staat dat bij "Het feest in cijfers".
// De stand en de tellers staan in data/party.json, zodat een herstart midden op de avond niets wist.
var PARTY_FILE = path.join(__dirname, "../data/party.json");

var LED_DEVICES = ["default", "keuken", "gang", "tv-meubel"];
var CONFETTI = 5, RAINBOW = 2;      // effectnummers van de ledstrips
var PROOST_MS = 10000;              // zo lang staan de strips op confetti
var WELCOME_MS = 6000;              // zo lang verwelkomen alle strips een gast

var party = { on: false, started_at: null, ended_at: null, rings: [], proosts: 0, discos: 0 };
try {
  var saved = JSON.parse(fs.readFileSync(PARTY_FILE, "utf8"));
  if (saved && typeof saved === "object") Object.assign(party, saved);
  if (!Array.isArray(party.rings)) party.rings = [];
} catch (e) {}
// Momenten waar open schermen op reageren (confetti); alleen van deze sessie, dus niet bewaard
var lastProost = 0, lastWelcome = 0;

function write() {
  try {
    var dir = path.dirname(PARTY_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(PARTY_FILE, JSON.stringify(party, null, 2));
  } catch (e) { console.error("[feest]", e.message); }
}

// ── Lampen even iets anders laten doen ──
// De strip krijgt tijdelijk een andere stand en gaat daarna terug naar hoe hij stond. Loopt er al zo'n moment,
// dan blijft de eerste bewaarde stand gelden en schuift alleen het einde op: anders zou een proost tijdens een
// welkom de confetti als "hoe het was" onthouden.
var borrowed = {};   // per strip: { before, timer }
function flash(device, patch, ms) {
  var cur = state.getLedState(device);
  var b = borrowed[device];
  if (b) clearTimeout(b.timer);
  else b = borrowed[device] = { before: { on: cur.on, effect: cur.effect, brightness: cur.brightness, color: cur.color } };
  Object.assign(cur, patch);
  b.timer = setTimeout(function() {
    Object.assign(state.getLedState(device), b.before);
    delete borrowed[device];
    state.saveState();
  }, ms);
}

function proost() {
  LED_DEVICES.forEach(function(d) {
    flash(d, { on: true, effect: CONFETTI, brightness: Math.max(state.getLedState(d).brightness || 0, 200) }, PROOST_MS);
  });
  state.saveState();
  lastProost = Date.now();
  if (party.on) { party.proosts++; write(); }
  return lastProost;
}

// Aangeroepen door de deurbel
function ring(at) {
  if (!party.on) return;
  party.rings.push(at);
  write();
  lastWelcome = at;
  LED_DEVICES.forEach(function(d) {
    flash(d, { on: true, effect: RAINBOW, brightness: Math.max(state.getLedState(d).brightness || 0, 200) }, WELCOME_MS);
  });
  state.saveState();
}

// Aangeroepen als er een scène start
function sceneStarted(id) {
  if (party.on && id === "disco") { party.discos++; write(); }
}

function start() {
  party = { on: true, started_at: Date.now(), ended_at: null, rings: [], proosts: 0, discos: 0 };
  write();
}
function stop() {
  if (!party.on) return;
  party.on = false;
  party.ended_at = Date.now();
  write();
}

// Wat open schermen elke paar tellen navragen
function status() {
  return { on: party.on, started_at: party.started_at, proost_at: lastProost, welcome_at: lastWelcome, guests: party.rings.length, now: Date.now() };
}

function stamp(ms) { return new Date(ms).toLocaleString("sv-SE", { timeZone: "Europe/Amsterdam" }).replace(" ", "T"); }

// Het feest in cijfers: van het aanzetten van de feeststand tot het uitzetten (of tot nu). cb(cijfers of null)
function stats(cb) {
  if (!party.started_at) return cb(null);
  var from = stamp(party.started_at), until = stamp(party.ended_at || Date.now());
  var out = {
    on: party.on, started_at: party.started_at, ended_at: party.ended_at,
    guests: party.rings.length, first_ring: party.rings[0] || null, last_ring: party.rings[party.rings.length - 1] || null,
    proosts: party.proosts, discos: party.discos,
    peak_kw: null, peak_at: null, avg_kw: null, kwh: null, cost: null
  };
  prices.fetchPrices(function(err, cur) {
    var now = cur && cur.electricity_eur_kwh != null ? cur.electricity_eur_kwh : null;
    prices.priceMaps(from.slice(0, 10), function(maps) {
      // per uur, zodat elk uur zijn eigen stroomprijs krijgt; een uur zonder bewaarde prijs rekent met de prijs van nu
      db.all(
        "SELECT strftime('%Y-%m-%d %H', received_at) as h, AVG(power_delivered_total_kw) as avg_kw," +
        " (julianday(MAX(received_at)) - julianday(MIN(received_at))) * 24 as hours, COUNT(*) as n" +
        " FROM readings WHERE received_at >= ? AND received_at <= ? AND power_delivered_total_kw IS NOT NULL GROUP BY h",
        [from, until],
        function(err2, rows) {
          var hours = 0;
          (rows || []).forEach(function(r) {
            if (r.avg_kw == null || !r.hours) return;
            var kwh = r.avg_kw * r.hours;
            var price = maps.elec[r.h] != null ? maps.elec[r.h] : now;
            out.kwh = (out.kwh || 0) + kwh;
            hours += r.hours;
            if (price != null) out.cost = (out.cost || 0) + kwh * price;
          });
          if (hours) out.avg_kw = out.kwh / hours;
          db.get(
            "SELECT power_delivered_total_kw as kw, received_at as at FROM readings" +
            " WHERE received_at >= ? AND received_at <= ? AND power_delivered_total_kw IS NOT NULL" +
            " ORDER BY power_delivered_total_kw DESC LIMIT 1",
            [from, until],
            function(err3, peak) {
              if (peak) { out.peak_kw = peak.kw; out.peak_at = peak.at; }
              cb(out);
            }
          );
        }
      );
    });
  });
}

module.exports = { start: start, stop: stop, status: status, stats: stats, proost: proost, ring: ring, sceneStarted: sceneStarted };

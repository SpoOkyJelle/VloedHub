var httpget = require("../utils/httpget");
var auth = require("./auth");
var discord = require("./discord");
var modules = require("./modules");
var notified = require("./notified");

// Storingen en gepland onderhoud van Ziggo op het thuisadres. Dit is de bron achter de storingscheck op
// ziggo.nl; een beschreven API is het niet, de veldnamen komen uit de code van die pagina.
var API_URL = "https://api.prod.aws.ziggo.io/v2/api/incidents/v1/";
var CACHE_TTL = 10 * 60 * 1000;
var CHECK_INTERVAL = 10 * 60 * 1000;

var MAINTENANCE = {
  "NETWORK ADJUSTMENTS": "kabels en straatkasten", "NETWORK ENHANCEMENTS": "netwerk update",
  "NETWORK EXPANSION": "netwerk uitbreiding", "NETWORK MAINTENANCE": "kabels vervangen"
};

var cache = { data: null, key: null, fetchedAt: 0 };

// Hetzelfde adres als de afvalkalender en de stroomstoringen
function getAddress() {
  var a = auth.readConfig().afval;
  if (!a || !a.postcode || !a.huisnummer) return null;
  return { postcode: a.postcode, huisnummer: String(a.huisnummer), toevoeging: String(a.toevoeging || "") };
}

function when(d) {
  if (!d || isNaN(d.getTime())) return "";
  return d.toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
}

// Onderhoud heeft tijden als "14-10-2026 08:00:00", in Nederlandse tijd
function localDate(text) {
  var m = String(text || "").match(/^(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2})/);
  return m ? new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]) : new Date(NaN);
}

function parse(data, now) {
  now = now || Date.now();
  var seen = {}, outages = [], maintenance = [];
  (data.outages || []).forEach(function(o) {
    // dezelfde storing komt per dienst terug als "nummer_dienst"
    var id = String(o.id || "").split("_")[0];
    if (!id || seen[id] || o.status === "Resolved") return;
    seen[id] = true;
    outages.push({
      id: id, title: o.title || "Storing", status: o.status || "",
      from: when(new Date(o.start_date)), expected: when(new Date(o.expected_solv_time || o.expec_solv_time))
    });
  });
  (data.announcements || []).forEach(function(a) {
    var id = String(a.change_number || a.id || "");
    var end = localDate(a.impact_end);
    if (!id || a.status === "Cancelled" || (!isNaN(end.getTime()) && end.getTime() < now)) return;
    var kind = MAINTENANCE[String(a.maintenance_type || "").toUpperCase()];
    maintenance.push({
      id: id, title: "Onderhoud" + (kind ? ": " + kind : ""),
      from: when(localDate(a.impact_start)), until: when(end)
    });
  });
  return { outages: outages, maintenance: maintenance };
}

function fetchStatus(cb) {
  var addr = getAddress();
  if (!addr) return cb(null, { ok: true, address: null, outages: [], maintenance: [] });
  var label = addr.postcode + " " + addr.huisnummer + addr.toevoeging;
  function done(r) { cb(null, { ok: true, address: label, outages: r.outages, maintenance: r.maintenance }); }
  if (cache.data && cache.key === label && Date.now() - cache.fetchedAt < CACHE_TTL) return done(cache.data);
  var url = API_URL + encodeURIComponent(addr.postcode) + "/" + encodeURIComponent(addr.huisnummer) + (addr.toevoeging ? "/" + encodeURIComponent(addr.toevoeging) : "");
  httpget.get(url, function(err, text) {
    var data = null;
    if (!err) { try { data = JSON.parse(text); } catch (e) {} }
    if (!data || !Array.isArray(data.outages)) return cb(null, { ok: false, address: label, error: "Ziggo niet bereikbaar" });
    cache = { data: parse(data), key: label, fetchedAt: Date.now() };
    done(cache.data);
  });
}

// Eén Discord-bericht per storing of gepland onderhoud
function check() {
  if (!modules.isOn("ziggo") || !getAddress()) return;
  fetchStatus(function(err, s) {
    if (!s || !s.ok) return;
    s.outages.forEach(function(o) {
      var key = "ziggo:" + o.id;
      if (notified.has(key)) return;
      notified.add(key);
      discord.notify("ziggo", "📡 **Ziggo-storing: " + o.title + "**" + (o.expected ? " — verwacht opgelost " + o.expected : ""));
    });
    s.maintenance.forEach(function(m) {
      var key = "ziggo:onderhoud:" + m.id;
      if (notified.has(key)) return;
      notified.add(key);
      discord.notify("ziggo", "🛠️ **Ziggo: " + m.title.toLowerCase() + "** — " + (m.from || "tijd onbekend") + (m.until ? " tot " + m.until : ""));
    });
  });
}

function start() {
  setTimeout(check, 105000);
  setInterval(check, CHECK_INTERVAL);
}

module.exports = { fetchStatus: fetchStatus, parse: parse, check: check, start: start };

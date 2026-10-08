var httpget = require("../utils/httpget");
var weather = require("./weather");
var discord = require("./discord");
var modules = require("./modules");
var notified = require("./notified");

// NL-Alerts die voor het thuisadres of vlak daarbij gelden. De overheid heeft zelf geen openbare feed;
// dit komt van public-warning.app, dat de uitgezonden berichten met hun gebied bijhoudt.
var FEED_URL = "https://api.public-warning.app/api/v1/providers/nl-alert/alerts";
var CACHE_TTL = 2 * 60 * 1000;
var CHECK_INTERVAL = 2 * 60 * 1000;
var NEAR_KM = 15;   // rook en stank reiken verder dan het gebied dat het bericht kreeg

var cache = { data: null, fetchedAt: 0 };

// Een gebied is een reeks hoekpunten: "lat,lon lat,lon ..."
function polygon(text) {
  return String(text || "").trim().split(/\s+/).map(function(p) {
    var c = p.split(",");
    return [parseFloat(c[0]), parseFloat(c[1])];
  }).filter(function(p) { return !isNaN(p[0]) && !isNaN(p[1]); });
}

function inside(poly, lat, lon) {
  var hit = false;
  for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    var a = poly[i], b = poly[j];
    if ((a[1] > lon) !== (b[1] > lon) && lat < (b[0] - a[0]) * (lon - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit;
  }
  return hit;
}

// Houdt de lopende alerts over die het thuisadres raken of er dichtbij zijn
function parse(feed, now) {
  now = now || Date.now();
  var lat = weather.WEATHER_LAT, lon = weather.WEATHER_LON, out = [];
  (feed.data || []).forEach(function(a) {
    var stop = Date.parse(a.stop_at);
    if (isNaN(stop) || stop < now) return;
    var home = false, km = Infinity;
    (a.area || []).forEach(function(text) {
      var poly = polygon(text);
      if (poly.length >= 3 && inside(poly, lat, lon)) home = true;
      poly.forEach(function(p) { km = Math.min(km, httpget.distanceKm(lat, lon, p[0], p[1])); });
    });
    if (!home && km > NEAR_KM) return;
    out.push({
      id: a.id,
      // na de sterretjes volgt dezelfde tekst in het Engels
      message: String(a.message || "").split("***")[0].trim(),
      home: home, km: home ? 0 : Math.round(km), from: a.start_at || null, until: a.stop_at
    });
  });
  return out;
}

function fetchAlerts(cb) {
  if (cache.data && Date.now() - cache.fetchedAt < CACHE_TTL) return cb(null, { ok: true, alerts: cache.data });
  httpget.get(FEED_URL, function(err, text) {
    var feed = null;
    if (!err) { try { feed = JSON.parse(text); } catch (e) {} }
    if (!feed || !Array.isArray(feed.data)) return cb(null, { ok: false, alerts: [] });
    cache = { data: parse(feed), fetchedAt: Date.now() };
    cb(null, { ok: true, alerts: cache.data });
  });
}

function check() {
  if (!modules.isOn("nlalert")) return;
  fetchAlerts(function(err, r) {
    if (!r || !r.ok) return;
    r.alerts.forEach(function(a) {
      var key = "nlalert:" + a.id;
      if (notified.has(key)) return;
      notified.add(key);
      discord.notify("nlalert", "🚨 **NL-Alert " + (a.home ? "voor jouw adres" : "op " + a.km + " km") + "**\n" + a.message);
    });
  });
}

function start() {
  setTimeout(check, 45000);
  setInterval(check, CHECK_INTERVAL);
}

module.exports = { fetchAlerts: fetchAlerts, parse: parse, check: check, start: start };

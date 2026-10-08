var httpget = require("../utils/httpget");
var weather = require("./weather");

// Regen in de komende twee uur van Buienradar: per vijf minuten de verwachte neerslag op het thuisadres.
var FEED_URL = "https://gpsgadget.buienradar.nl/data/raintext?lat=" + weather.WEATHER_LAT.toFixed(2) + "&lon=" + weather.WEATHER_LON.toFixed(2);
var CACHE_TTL = 5 * 60 * 1000;
var DRY = 0.1;   // mm per uur; daaronder merk je er buiten niets van

var cache = { data: null, fetchedAt: 0 };

// Regels als "077|09:10". Het getal is een schaal van 0 tot 255: mm per uur = 10^((getal - 109) / 32)
function parse(text) {
  var out = [];
  String(text || "").split(/\r?\n/).forEach(function(line) {
    var m = line.match(/^(\d{1,3})\|(\d{2}:\d{2})/);
    if (!m) return;
    var v = +m[1];
    out.push({ time: m[2], mm: v > 0 ? Math.round(Math.pow(10, (v - 109) / 32) * 100) / 100 : 0 });
  });
  return out;
}

// Wat je wilt weten: regent het, tot wanneer, of wanneer begint het
function summarize(points) {
  var r = { raining: false, from: null, in_min: null, until: null, max_mm: 0, points: points };
  if (!points.length) return r;
  r.raining = points[0].mm >= DRY;
  points.forEach(function(p) { if (p.mm > r.max_mm) r.max_mm = p.mm; });
  for (var i = 1; i < points.length; i++) {
    var wet = points[i].mm >= DRY;
    if (r.raining && !wet) { r.until = points[i].time; break; }
    if (!r.raining && wet) { r.from = points[i].time; r.in_min = i * 5; break; }
  }
  return r;
}

function fetchRain(cb) {
  if (cache.data && Date.now() - cache.fetchedAt < CACHE_TTL) return cb(null, cache.data);
  httpget.get(FEED_URL, function(err, text) {
    var points = err ? [] : parse(text);
    if (!points.length) return cb(null, { ok: false, error: "Buienradar niet bereikbaar" });
    var data = summarize(points);
    data.ok = true;
    cache = { data: data, fetchedAt: Date.now() };
    cb(null, data);
  });
}

module.exports = { fetchRain: fetchRain, parse: parse, summarize: summarize };

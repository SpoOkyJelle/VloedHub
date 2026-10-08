var httpget = require("../utils/httpget");
var weather = require("./weather");

// Files, afsluitingen en wegwerkzaamheden op de rijkswegen rond huis, van Rijkswaterstaat Verkeersinfo.
// Dat is de bron achter rwsverkeersinfo.nl; een officiële, beschreven API is het niet.
var FEED_URL = "https://api.rwsverkeersinfo.nl/api/traffic/";
var CACHE_TTL = 3 * 60 * 1000;
var RADIUS_KM = 30;       // files
var NEAR_KM = 15;         // afsluitingen en wegwerkzaamheden: alleen vlakbij, die duren vaak maanden
var TYPE_JAM = 4, TYPE_WORKS = 1;

var cache = { data: null, fetchedAt: 0 };

function parse(feed) {
  var jams = [], other = [];
  (feed.obstructions || []).forEach(function(o) {
    if (!o.isCurrent || o.latitude == null || o.longitude == null) return;
    var km = httpget.distanceKm(weather.WEATHER_LAT, weather.WEATHER_LON, o.latitude, o.longitude);
    var jam = o.obstructionType === TYPE_JAM;
    if (km > (jam ? RADIUS_KM : NEAR_KM)) return;
    var item = {
      id: o.id, road: o.roadNumber || "", title: o.title || "", direction: o.directionText || "", location: o.locationText || "",
      description: o.description || "", cause: o.cause || "", delay_min: Math.round(o.delay || 0),
      length_km: Math.round((o.length || 0) / 100) / 10, until: o.timeEnd || null, km: Math.round(km)
    };
    if (jam) jams.push(item);
    else { item.works = o.obstructionType === TYPE_WORKS; other.push(item); }
  });
  jams.sort(function(a, b) { return b.delay_min - a.delay_min; });
  other.sort(function(a, b) { return a.km - b.km; });
  return { jams: jams, other: other };
}

function fetchTraffic(cb) {
  if (cache.data && Date.now() - cache.fetchedAt < CACHE_TTL) return cb(null, cache.data);
  httpget.get(FEED_URL, function(err, text) {
    var feed = null;
    if (!err) { try { feed = JSON.parse(text); } catch (e) {} }
    if (!feed || !Array.isArray(feed.obstructions)) return cb(null, { ok: false, error: "Rijkswaterstaat niet bereikbaar" });
    var data = parse(feed);
    data.ok = true;
    cache = { data: data, fetchedAt: Date.now() };
    cb(null, data);
  });
}

module.exports = { fetchTraffic: fetchTraffic, parse: parse };

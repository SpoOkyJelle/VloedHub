var https = require("https");
var discord = require("./discord");
var modules = require("./modules");
var notified = require("./notified");

// Weerwaarschuwingen (code geel, oranje, rood) van het KNMI voor Noord-Brabant, via MeteoAlarm.
var PROVINCE = "Noord-Brabant";
var FEED_URL = "https://feeds.meteoalarm.org/api/v1/warnings/feeds-netherlands";
var CACHE_TTL = 15 * 60 * 1000;
var CHECK_INTERVAL = 15 * 60 * 1000;

var LEVELS = { yellow: { code: "geel", rank: 1 }, orange: { code: "oranje", rank: 2 }, red: { code: "rood", rank: 3 } };

var cache = { data: null, fetchedAt: 0 };

function fetchFeed(cb) {
  var req = https.get(FEED_URL, { timeout: 30000 }, function(res) {
    if (res.statusCode !== 200) { res.resume(); return cb(new Error("HTTP " + res.statusCode)); }
    var chunks = "";
    res.setEncoding("utf8");
    res.on("data", function(c) { chunks += c; });
    res.on("end", function() {
      try { cb(null, JSON.parse(chunks)); } catch (e) { cb(e); }
    });
  });
  req.on("timeout", function() { req.destroy(new Error("timeout")); });
  req.on("error", cb);
}

function param(info, name) {
  var p = (info.parameter || []).filter(function(x) { return x.valueName === name; })[0];
  return p ? String(p.value) : "";
}

// Houdt de geldende, niet-groene waarschuwingen voor de provincie over
function parse(feed, now) {
  now = now || Date.now();
  var out = [];
  (feed.warnings || []).forEach(function(w) {
    var alert = w.alert || {};
    (alert.info || []).forEach(function(info) {
      if (info.language !== "nl-NL") return;
      if (!(info.area || []).some(function(a) { return a.areaDesc === PROVINCE; })) return;
      var color = (param(info, "awareness_level").split(";")[1] || "").trim();
      var level = LEVELS[color];
      if (!level) return; // groen = geen waarschuwing
      var expires = Date.parse(info.expires);
      if (!isNaN(expires) && expires < now) return;
      out.push({
        id: alert.identifier,
        code: level.code,
        rank: level.rank,
        // de kop is "Windstoten - Code geel voor Noord-Brabant - Nederland"; het eerste deel is het soort weer
        type: String(info.headline || info.event || "Weer").split(" - ")[0],
        description: info.description || "",
        from: info.onset || info.effective || null,
        until: info.expires || null
      });
    });
  });
  return out.sort(function(a, b) { return b.rank - a.rank || String(a.from).localeCompare(String(b.from)); });
}

function fetchWarnings(cb) {
  if (cache.data && Date.now() - cache.fetchedAt < CACHE_TTL) return cb(null, { ok: true, province: PROVINCE, warnings: cache.data });
  fetchFeed(function(err, feed) {
    if (err) return cb(null, { ok: false, province: PROVINCE, warnings: [] });
    cache = { data: parse(feed), fetchedAt: Date.now() };
    cb(null, { ok: true, province: PROVINCE, warnings: cache.data });
  });
}

function when(iso) {
  var d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });
}

// Eén Discord-bericht per nieuwe waarschuwing
function check() {
  if (!modules.isOn("weather")) return;
  fetchWarnings(function(err, r) {
    if (!r || !r.ok) return;
    r.warnings.forEach(function(w) {
      var key = "warning:" + w.id;
      if (notified.has(key)) return;
      notified.add(key);
      discord.sendDiscord("⚠️ **Code " + w.code + " voor " + PROVINCE + ": " + w.type + "**" +
        (w.from ? " — " + when(w.from) + (w.until ? " tot " + when(w.until) : "") : "") +
        (w.description ? "\n" + w.description : ""));
    });
  });
}

function start() {
  setTimeout(check, 90000);
  setInterval(check, CHECK_INTERVAL);
}

module.exports = { fetchWarnings: fetchWarnings, parse: parse, check: check, start: start };

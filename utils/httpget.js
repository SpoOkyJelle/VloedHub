var https = require("https");

// Haalt een openbare pagina of feed op als tekst: cb(fout, tekst). Volgt één keer een doorverwijzing.
var MAX_BYTES = 2 * 1024 * 1024;

function get(url, cb, redirected) {
  var done = false;
  function finish(err, text) { if (done) return; done = true; cb(err, text); }
  var req = https.get(url, { headers: { "User-Agent": "Mozilla/5.0 (VloedHub)" }, timeout: 20000 }, function(res) {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && !redirected) {
      res.resume();
      done = true;
      return get(new URL(res.headers.location, url).href, cb, true);
    }
    if (res.statusCode !== 200) { res.resume(); return finish(new Error("HTTP " + res.statusCode)); }
    var text = "", size = 0;
    res.setEncoding("utf8");
    res.on("data", function(c) {
      size += c.length;
      if (size > MAX_BYTES) { req.destroy(); return finish(new Error("te groot")); }
      text += c;
    });
    res.on("end", function() { finish(null, text); });
    res.on("error", finish);
  });
  req.on("timeout", function() { req.destroy(new Error("timeout")); });
  req.on("error", finish);
}

// Afstand in kilometers tussen twee punten; ruim nauwkeurig genoeg voor "in de buurt"
function distanceKm(lat1, lon1, lat2, lon2) {
  var x = (lon2 - lon1) * Math.PI / 180 * Math.cos((lat1 + lat2) / 2 * Math.PI / 180);
  var y = (lat2 - lat1) * Math.PI / 180;
  return Math.sqrt(x * x + y * y) * 6371;
}

module.exports = { get: get, distanceKm: distanceKm };

var http = require("http");
var auth = require("./services/auth");

// Routes that never require authentication
var PUBLIC_PATHS = ['/pin', '/api/auth/login', '/api/auth/status', '/api/auth/set-pin'];

// Adressen voor de apparaten in huis (ESP32's, P1-meter, sensoren). Die kunnen niet inloggen, dus deze
// werken zonder PIN — maar alleen vanaf het thuisnetwerk. Van buitenaf is ook hier een inlog nodig.
var LOCAL_API_PREFIXES = ['/api/p1', '/api/led', '/api/relay', '/api/temperature', '/api/wasmachine', '/api/gas', '/api/esphome', '/api/device-names', '/api/layout'];

// Bedoeld om van buitenaf aangeroepen te worden; het token in het adres is de sleutel
var PUBLIC_API_PREFIXES = ['/api/webhook/'];

var MAX_BODY = 1024 * 1024; // 1 MB; de grootste echte aanvraag (een flow opslaan) is een fractie daarvan

function isLocalAddress(addr) {
  addr = String(addr || '').replace('::ffff:', '');
  if (addr === '127.0.0.1' || addr === '::1') return true;
  if (/^10\./.test(addr) || /^192\.168\./.test(addr) || /^169\.254\./.test(addr)) return true;
  var m = addr.match(/^172\.(\d+)\./);
  if (m && +m[1] >= 16 && +m[1] <= 31) return true;
  return /^f[cd][0-9a-f]{2}:/i.test(addr) || /^fe80:/i.test(addr);
}

// Static asset extensions that are always public (needed by /pin page)
var PUBLIC_EXTS  = ['.css', '.js', '.png', '.ico', '.svg', '.woff', '.woff2', '.webmanifest'];

var routes = [
  require("./routes/auth"),
  require("./routes/p1"),
  require("./routes/wasmachine"),
  require("./routes/homeconnect"),
  require("./routes/meldingen"),
  require("./routes/temperature"),
  require("./routes/gas"),
  require("./routes/costs"),
  require("./routes/weather"),
  require("./routes/afval"),
  require("./routes/insights"),
  require("./routes/scenes"),
  require("./routes/monitor"),
  require("./routes/internet"),
  require("./routes/camera"),
  require("./routes/fridge"),
  require("./routes/modules"),
  require("./routes/discord"),
  require("./routes/region"),
  require("./routes/sun"),
  require("./routes/led"),
  require("./routes/relay"),
  require("./routes/flows"),
  require("./routes/webhook-trigger"),
  require("./routes/esphome"),
  require("./routes/device-names"),
  require("./routes/layout"),
  require("./routes/debug"),
  require("./routes/pages")
];

var path = require("path");

function isPublic(url, remoteAddress) {
  var urlPath = url.split("?")[0];
  if (PUBLIC_PATHS.indexOf(urlPath) !== -1) return true;
  for (var i = 0; i < PUBLIC_API_PREFIXES.length; i++) {
    if (urlPath.startsWith(PUBLIC_API_PREFIXES[i])) return true;
  }
  for (var j = 0; j < LOCAL_API_PREFIXES.length; j++) {
    if (urlPath.startsWith(LOCAL_API_PREFIXES[j])) return isLocalAddress(remoteAddress);
  }
  // de code van het dashboard zelf blijft achter de PIN, net als toen die nog in de pagina stond
  if (urlPath.indexOf("/js/") === 0) return false;
  var ext = path.extname(urlPath);
  return ext && PUBLIC_EXTS.indexOf(ext) !== -1;
}

var server = http.createServer(function(req, res) {
  // de pagina mag niet in andermans frame, en de browser mag bestandstypen niet zelf raden
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "same-origin");

  // een aanvraag die maar door blijft sturen wordt afgekapt
  var received = 0;
  req.on("data", function(chunk) {
    received += chunk.length;
    if (received > MAX_BODY) req.destroy();
  });

  // Auth gate: redirect to /pin if not authenticated
  if (!isPublic(req.url, req.socket.remoteAddress)) {
    var token = auth.getSessionToken(req);
    if (!auth.isValidSession(token)) {
      // API calls get 401, page loads get redirect
      if (req.url.startsWith("/api/")) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Niet ingelogd" }));
      } else {
        var dest = encodeURIComponent(req.url);
        res.writeHead(302, { "Location": "/pin?next=" + dest });
        res.end();
      }
      return;
    }
  }

  // een fout in één aanvraag (bijv. een kapot adres) mag de server niet onderuit halen
  try {
    for (var i = 0; i < routes.length; i++) {
      if (routes[i](req, res)) return;
    }
  } catch (e) {
    console.error("[server]", req.method, req.url.split("?")[0], e.message);
    if (!res.headersSent) res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Ongeldige aanvraag" }));
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

module.exports = server;

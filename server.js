var http = require("http");
var auth = require("./services/auth");

// Routes that never require authentication
var PUBLIC_PATHS = ['/pin', '/api/auth/login', '/api/auth/status', '/api/auth/set-pin'];

// API path prefixes that are device-facing (ESP32, P1 meter, sensors) — always public
var PUBLIC_API_PREFIXES = ['/api/p1', '/api/led', '/api/relay', '/api/temperature', '/api/wasmachine', '/api/gas', '/api/webhook/', '/api/esphome', '/api/device-names', '/api/layout'];

// Static asset extensions that are always public (needed by /pin page)
var PUBLIC_EXTS  = ['.css', '.js', '.png', '.ico', '.svg', '.woff', '.woff2', '.webmanifest'];

var routes = [
  require("./routes/auth"),
  require("./routes/p1"),
  require("./routes/wasmachine"),
  require("./routes/homeconnect"),
  require("./routes/temperature"),
  require("./routes/gas"),
  require("./routes/costs"),
  require("./routes/weather"),
  require("./routes/afval"),
  require("./routes/insights"),
  require("./routes/scenes"),
  require("./routes/monitor"),
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

function isPublic(url) {
  var urlPath = url.split("?")[0];
  if (PUBLIC_PATHS.indexOf(urlPath) !== -1) return true;
  for (var i = 0; i < PUBLIC_API_PREFIXES.length; i++) {
    if (urlPath.startsWith(PUBLIC_API_PREFIXES[i])) return true;
  }
  var ext = path.extname(urlPath);
  return ext && PUBLIC_EXTS.indexOf(ext) !== -1;
}

var server = http.createServer(function(req, res) {
  // Auth gate: redirect to /pin if not authenticated
  if (!isPublic(req.url)) {
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

  for (var i = 0; i < routes.length; i++) {
    if (routes[i](req, res)) return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

module.exports = server;

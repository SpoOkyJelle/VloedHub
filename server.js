var http = require("http");
var auth = require("./services/auth");

// Routes that never require authentication
var PUBLIC_PATHS = ['/pin', '/api/auth/login', '/api/auth/status'];

// Static asset extensions that are always public (needed by /pin page)
var PUBLIC_EXTS  = ['.css', '.js', '.png', '.ico', '.svg', '.woff', '.woff2'];

var routes = [
  require("./routes/auth"),
  require("./routes/p1"),
  require("./routes/wasmachine"),
  require("./routes/temperature"),
  require("./routes/gas"),
  require("./routes/costs"),
  require("./routes/weather"),
  require("./routes/sun"),
  require("./routes/led"),
  require("./routes/relay"),
  require("./routes/flows"),
  require("./routes/webhook-trigger"),
  require("./routes/debug"),
  require("./routes/pages")
];

var path = require("path");

function isPublic(url) {
  var urlPath = url.split("?")[0];
  if (PUBLIC_PATHS.indexOf(urlPath) !== -1) return true;
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

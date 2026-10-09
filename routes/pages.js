var fs = require("fs");
var path = require("path");
var discord = require("../services/discord");
var layout = require("./layout");
var modules = require("../services/modules");

var PUBLIC_DIR = path.join(__dirname, "../public");
var HTML_TEMPLATE = fs.readFileSync(path.join(PUBLIC_DIR, "index.html"), "utf8");

var MIME_TYPES = {
  ".css": "text/css",
  ".js":  "application/javascript; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json"
};

module.exports = function(req, res) {
  if (req.method === "GET" && req.url.split("?")[0] === "/") {
    var layoutJson = JSON.stringify(layout.load()).replace(/</g, "\\u003c");
    var html = HTML_TEMPLATE.replace(/__LOCAL_IP__/g, discord.LOCAL_IP).replace("__LAYOUT_JSON__", function() { return layoutJson; })
      .replace("__MODULES_JSON__", function() { return JSON.stringify(modules.getMap()); });
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
    return true;
  }

  if (req.method === "GET" && req.url === "/api/network-info") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ lan: discord.LOCAL_IP, wan: discord.WAN_IP }));
    return true;
  }

  // De code van het dashboard staat verdeeld over public/js/app/ (01-kern.js, 02-energie.js, …).
  // De browser krijgt ze als één script, op volgorde van bestandsnaam: de delen gebruiken elkaars
  // functies, en als losse scripts zou een antwoord van de server tussen twee delen door kunnen komen.
  if (req.method === "GET" && req.url.split("?")[0] === "/js/app.js") {
    var appDir = path.join(PUBLIC_DIR, "js", "app");
    var bundle = fs.readdirSync(appDir).filter(function(f) { return /\.js$/.test(f); }).sort()
      .map(function(f) { return fs.readFileSync(path.join(appDir, f), "utf8"); }).join("");
    res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
    res.end(bundle);
    return true;
  }

  // Serve static files from public/ (CSS, JS, images, etc.)
  if (req.method === "GET") {
    var urlPath = req.url.split("?")[0];
    var ext = path.extname(urlPath);
    var mime = MIME_TYPES[ext];
    if (mime) {
      var filePath = path.join(PUBLIC_DIR, urlPath);
      // Prevent path traversal
      if (filePath.indexOf(PUBLIC_DIR) === 0 && fs.existsSync(filePath)) {
        res.writeHead(200, { "Content-Type": mime });
        res.end(fs.readFileSync(filePath));
        return true;
      }
    }
  }

  return false;
};

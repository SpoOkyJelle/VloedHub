var fs = require("fs");
var path = require("path");

var NAMES_FILE = path.join(__dirname, "../data/device-names.json");

function loadNames() {
  try { return JSON.parse(fs.readFileSync(NAMES_FILE, "utf8")); }
  catch (e) { return {}; }
}

function saveNames(names) {
  var dir = path.dirname(NAMES_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(NAMES_FILE, JSON.stringify(names, null, 2));
}

module.exports = function(req, res) {
  if (req.method === "GET" && req.url === "/api/device-names") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(loadNames()));
    return true;
  }

  if (req.method === "POST" && req.url === "/api/device-names") {
    var body = "";
    req.on("data", function(chunk) { body += chunk; });
    req.on("end", function() {
      var data;
      try { data = JSON.parse(body); }
      catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid JSON" }));
        return;
      }
      if (!data.key || typeof data.name !== "string") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "missing fields" }));
        return;
      }
      var names = loadNames();
      if (data.name.trim()) {
        names[data.key] = data.name.trim();
      } else {
        delete names[data.key];
      }
      saveNames(names);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    });
    return true;
  }

  return false;
};

/*
 * Simple local server for the GoonESP32-P1meter dongle.
 *
 * Receives JSON P1 readings via HTTP POST and stores them in SQLite.
 * Visit http://localhost:5000 for a live dashboard.
 *
 * Run with:
 *     npm install
 *     node app.js
 *
 * The ESP32 sketch expects this reachable at:
 *     http://192.168.178.10:5000/api/p1data
 */

var http = require("http");
var path = require("path");
var sqlite3 = require("sqlite3");

var PORT = 5000;
var db = new sqlite3.Database(path.join(__dirname, "p1_data.db"));

db.run(
  "CREATE TABLE IF NOT EXISTS readings (" +
  "  id INTEGER PRIMARY KEY AUTOINCREMENT," +
  "  received_at TEXT NOT NULL," +
  "  device TEXT," +
  "  power_delivered_kw REAL," +
  "  power_returned_kw REAL," +
  "  gas_m3 REAL," +
  "  raw TEXT NOT NULL" +
  ")"
);

function logReading(data, callback) {
  var received_at = new Date().toISOString();

  db.run(
    "INSERT INTO readings (received_at, device, power_delivered_kw, power_returned_kw, gas_m3, raw) " +
    "VALUES (?, ?, ?, ?, ?, ?)",
    [
      received_at,
      data.device != null ? data.device : null,
      data.power_delivered_kw != null ? data.power_delivered_kw : null,
      data.power_returned_kw != null ? data.power_returned_kw : null,
      data.gas_m3 != null ? data.gas_m3 : null,
      JSON.stringify(data)
    ],
    function(err) {
      if (err) return callback(err);

      console.log(
        "[" + received_at + "] " + (data.device != null ? data.device : "unknown") + " - " +
        "delivered=" + data.power_delivered_kw + "kW " +
        "returned=" + data.power_returned_kw + "kW " +
        "gas=" + data.gas_m3 + "m3"
      );

      callback(null);
    }
  );
}

var HTML = "<!DOCTYPE html>\n" +
"<html lang=\"en\">\n" +
"<head>\n" +
"  <meta charset=\"UTF-8\" />\n" +
"  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />\n" +
"  <title>VloedHub \u2014 P1 Live</title>\n" +
"  <style>\n" +
"    * { box-sizing: border-box; margin: 0; padding: 0; }\n" +
"    body { font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; padding: 2rem; }\n" +
"    h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }\n" +
"    .subtitle { color: #64748b; font-size: 0.85rem; margin-bottom: 2rem; }\n" +
"    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin-bottom: 2rem; }\n" +
"    .card { background: #1e293b; border-radius: 12px; padding: 1.25rem; }\n" +
"    .card-label { font-size: 0.75rem; text-transform: uppercase; color: #64748b; letter-spacing: 0.05em; margin-bottom: 0.5rem; }\n" +
"    .card-value { font-size: 2rem; font-weight: 700; }\n" +
"    .card-unit { font-size: 0.85rem; color: #94a3b8; margin-left: 0.25rem; }\n" +
"    .delivered { color: #34d399; }\n" +
"    .returned { color: #60a5fa; }\n" +
"    .gas { color: #f59e0b; }\n" +
"    .updated { color: #475569; font-size: 0.8rem; margin-bottom: 1.5rem; }\n" +
"    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }\n" +
"    th { text-align: left; padding: 0.5rem 0.75rem; color: #64748b; border-bottom: 1px solid #1e293b; }\n" +
"    td { padding: 0.5rem 0.75rem; border-bottom: 1px solid #1e293b; color: #cbd5e1; }\n" +
"    tr:last-child td { border-bottom: none; }\n" +
"    .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #34d399; margin-right: 0.5rem; animation: pulse 2s infinite; }\n" +
"    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }\n" +
"  </style>\n" +
"</head>\n" +
"<body>\n" +
"  <h1><span class=\"dot\"></span>VloedHub P1 Monitor</h1>\n" +
"  <p class=\"subtitle\">Live energy readings from your smart meter</p>\n" +
"\n" +
"  <div class=\"cards\">\n" +
"    <div class=\"card\"><div class=\"card-label\">Delivered</div><div class=\"card-value delivered\" id=\"delivered\">\u2014<span class=\"card-unit\">kW</span></div></div>\n" +
"    <div class=\"card\"><div class=\"card-label\">Returned</div><div class=\"card-value returned\" id=\"returned\">\u2014<span class=\"card-unit\">kW</span></div></div>\n" +
"    <div class=\"card\"><div class=\"card-label\">Gas</div><div class=\"card-value gas\" id=\"gas\">\u2014<span class=\"card-unit\">m\u00b3</span></div></div>\n" +
"    <div class=\"card\"><div class=\"card-label\">Device</div><div class=\"card-value\" style=\"font-size:1.1rem;padding-top:0.6rem\" id=\"device\">\u2014</div></div>\n" +
"  </div>\n" +
"\n" +
"  <p class=\"updated\" id=\"updated\">Waiting for data\u2026</p>\n" +
"\n" +
"  <table>\n" +
"    <thead><tr><th>Time</th><th>Delivered (kW)</th><th>Returned (kW)</th><th>Gas (m\u00b3)</th></tr></thead>\n" +
"    <tbody id=\"rows\"></tbody>\n" +
"  </table>\n" +
"\n" +
"  <script>\n" +
"    function refresh() {\n" +
"      fetch('/api/latest').then(function(res) {\n" +
"        return res.json();\n" +
"      }).then(function(d) {\n" +
"        var latest = d.latest;\n" +
"        var recent = d.recent;\n" +
"        if (latest) {\n" +
"          document.getElementById('delivered').innerHTML = (latest.power_delivered_kw != null ? latest.power_delivered_kw : '\u2014') + '<span class=\"card-unit\">kW</span>';\n" +
"          document.getElementById('returned').innerHTML = (latest.power_returned_kw != null ? latest.power_returned_kw : '\u2014') + '<span class=\"card-unit\">kW</span>';\n" +
"          document.getElementById('gas').innerHTML = (latest.gas_m3 != null ? latest.gas_m3 : '\u2014') + '<span class=\"card-unit\">m\u00b3</span>';\n" +
"          document.getElementById('device').textContent = latest.device != null ? latest.device : 'unknown';\n" +
"          document.getElementById('updated').textContent = 'Last updated: ' + new Date(latest.received_at).toLocaleTimeString();\n" +
"        }\n" +
"        var html = '';\n" +
"        for (var i = 0; i < recent.length; i++) {\n" +
"          var r = recent[i];\n" +
"          html += '<tr><td>' + new Date(r.received_at).toLocaleTimeString() + '</td>' +\n" +
"            '<td>' + (r.power_delivered_kw != null ? r.power_delivered_kw : '\u2014') + '</td>' +\n" +
"            '<td>' + (r.power_returned_kw != null ? r.power_returned_kw : '\u2014') + '</td>' +\n" +
"            '<td>' + (r.gas_m3 != null ? r.gas_m3 : '\u2014') + '</td></tr>';\n" +
"        }\n" +
"        document.getElementById('rows').innerHTML = html;\n" +
"      }).catch(function() {});\n" +
"    }\n" +
"    refresh();\n" +
"    setInterval(refresh, 3000);\n" +
"  </script>\n" +
"</body>\n" +
"</html>";

var server = http.createServer(function(req, res) {
  if (req.method === "POST" && req.url === "/api/p1data") {
    var contentType = req.headers["content-type"] || "";
    if (!contentType.includes("application/json")) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "expected application/json" }));
      return;
    }

    var body = "";
    req.on("data", function(chunk) { body += chunk; });
    req.on("end", function() {
      var data;
      try {
        data = JSON.parse(body);
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid JSON" }));
        return;
      }

      logReading(data, function(err) {
        if (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "db error" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      });
    });
    return;
  }

  if (req.method === "GET" && req.url === "/api/latest") {
    db.get("SELECT * FROM readings ORDER BY id DESC LIMIT 1", function(err, latest) {
      if (err) { latest = null; }
      db.all(
        "SELECT received_at, power_delivered_kw, power_returned_kw, gas_m3 FROM readings ORDER BY id DESC LIMIT 20",
        function(err2, recent) {
          if (err2) { recent = []; }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ latest: latest || null, recent: recent }));
        }
      );
    });
    return;
  }

  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(HTML);
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, "0.0.0.0", function() {
  console.log("Server listening on http://0.0.0.0:" + PORT);
});

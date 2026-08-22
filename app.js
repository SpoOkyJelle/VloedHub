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

db.serialize(function() {
  db.run(
    "CREATE TABLE IF NOT EXISTS readings (" +
    "  id INTEGER PRIMARY KEY AUTOINCREMENT," +
    "  received_at TEXT NOT NULL," +
    "  device TEXT," +
    "  voltage_l1 REAL, voltage_l2 REAL, voltage_l3 REAL," +
    "  current_l1 REAL, current_l2 REAL, current_l3 REAL," +
    "  power_delivered_l1_kw REAL, power_delivered_l2_kw REAL, power_delivered_l3_kw REAL," +
    "  power_returned_l1_kw REAL, power_returned_l2_kw REAL, power_returned_l3_kw REAL," +
    "  power_delivered_total_kw REAL," +
    "  power_returned_total_kw REAL," +
    "  gas_m3 REAL," +
    "  raw TEXT NOT NULL" +
    ")"
  );

  // Migrate older single-column schema if needed
  var oldCols = ["voltage_l1","voltage_l2","voltage_l3","current_l1","current_l2","current_l3",
    "power_delivered_l1_kw","power_delivered_l2_kw","power_delivered_l3_kw",
    "power_returned_l1_kw","power_returned_l2_kw","power_returned_l3_kw",
    "power_delivered_total_kw","power_returned_total_kw"];
  oldCols.forEach(function(col) {
    db.run("ALTER TABLE readings ADD COLUMN " + col + " REAL", function() {});
  });
});

function logReading(data, callback) {
  var received_at = new Date().toISOString();
  var n = function(v) { return v != null ? v : null; };

  db.run(
    "INSERT INTO readings (" +
    "  received_at, device," +
    "  voltage_l1, voltage_l2, voltage_l3," +
    "  current_l1, current_l2, current_l3," +
    "  power_delivered_l1_kw, power_delivered_l2_kw, power_delivered_l3_kw," +
    "  power_returned_l1_kw, power_returned_l2_kw, power_returned_l3_kw," +
    "  power_delivered_total_kw, power_returned_total_kw," +
    "  gas_m3, raw" +
    ") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [
      received_at,
      n(data.device),
      n(data.voltage_l1), n(data.voltage_l2), n(data.voltage_l3),
      n(data.current_l1), n(data.current_l2), n(data.current_l3),
      n(data.power_delivered_l1_kw), n(data.power_delivered_l2_kw), n(data.power_delivered_l3_kw),
      n(data.power_returned_l1_kw), n(data.power_returned_l2_kw), n(data.power_returned_l3_kw),
      n(data.power_delivered_total_kw), n(data.power_returned_total_kw),
      n(data.gas_m3),
      JSON.stringify(data)
    ],
    function(err) {
      if (err) return callback(err);
      console.log(
        "[" + received_at + "] " + (data.device || "unknown") + " - " +
        "delivered=" + data.power_delivered_total_kw + "kW " +
        "returned=" + data.power_returned_total_kw + "kW " +
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
"    html, body { height: 100%; }\n" +
"    body { font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; padding: 1.25rem; display: flex; flex-direction: column; min-height: 100vh; }\n" +
"    h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }\n" +
"    .subtitle { color: #64748b; font-size: 0.85rem; margin-bottom: 1.5rem; }\n" +
"    .section-title { font-size: 0.7rem; text-transform: uppercase; color: #475569; letter-spacing: 0.08em; margin: 1.25rem 0 0.6rem; }\n" +
"    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0.75rem; margin-bottom: 0.5rem; }\n" +
"    .cards-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem; margin-bottom: 0.5rem; }\n" +
"    .card { background: #1e293b; border-radius: 10px; padding: 0.9rem 1rem; }\n" +
"    .card-label { font-size: 0.7rem; text-transform: uppercase; color: #64748b; letter-spacing: 0.05em; margin-bottom: 0.4rem; }\n" +
"    .card-value { font-size: 1.9rem; font-weight: 700; }\n" +
"    .card-value.small { font-size: clamp(1rem, 3.5vw, 1.3rem); padding-top: 0.2rem; }\n" +
"    .card-unit { font-size: 0.75rem; color: #94a3b8; margin-left: 0.15rem; }\n" +
"    .delivered { color: #34d399; }\n" +
"    .returned { color: #60a5fa; }\n" +
"    .gas { color: #f59e0b; }\n" +
"    .voltage { color: #a78bfa; }\n" +
"    .updated { color: #475569; font-size: 0.8rem; margin: 1rem 0 0.5rem; }\n" +
"    .log-wrap { flex: 1; overflow-y: auto; overflow-x: auto; margin-top: 0.5rem; border-radius: 10px; border: 1px solid #1e293b; }\n" +
"    table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }\n" +
"    thead th { position: sticky; top: 0; background: #0f172a; z-index: 1; }\n" +
"    th { text-align: left; padding: 0.5rem 0.75rem; color: #64748b; border-bottom: 1px solid #1e293b; }\n" +
"    td { padding: 0.45rem 0.75rem; border-bottom: 1px solid #1e293b; color: #cbd5e1; white-space: nowrap; }\n" +
"    tr:last-child td { border-bottom: none; }\n" +
"    .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #34d399; margin-right: 0.5rem; animation: pulse 2s infinite; }\n" +
"    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }\n" +
"    .chart-card { background: #1e293b; border-radius: 10px; padding: 1rem; margin-top: 0.5rem; }\n" +
"    .tab-bar { display: flex; gap: 0.5rem; margin-bottom: 1rem; }\n" +
"    .tab { background: #0f172a; border: 1px solid #334155; color: #94a3b8; border-radius: 6px; padding: 0.35rem 0.9rem; font-size: 0.8rem; cursor: pointer; }\n" +
"    .tab.active { background: #334155; color: #e2e8f0; }\n" +
"  </style>\n" +
"  <script src=\"https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js\"></script>\n" +
"</head>\n" +
"<body>\n" +
"  <h1><span class=\"dot\"></span>VloedHub P1 Monitor</h1>\n" +
"  <p class=\"subtitle\">Live energy readings from your smart meter</p>\n" +
"\n" +
"  <p class=\"section-title\">Totals</p>\n" +
"  <div class=\"cards\">\n" +
"    <div class=\"card\"><div class=\"card-label\">Delivered</div><div class=\"card-value delivered\" id=\"del-total\">\u2014<span class=\"card-unit\">kW</span></div></div>\n" +
"    <div class=\"card\"><div class=\"card-label\">Returned</div><div class=\"card-value returned\" id=\"ret-total\">\u2014<span class=\"card-unit\">kW</span></div></div>\n" +
"    <div class=\"card\"><div class=\"card-label\">Gas</div><div class=\"card-value gas\" id=\"gas\">\u2014<span class=\"card-unit\">m\u00b3</span></div></div>\n" +
"  </div>\n" +
"\n" +
"  <p class=\"section-title\">Per phase \u2014 Power</p>\n" +
"  <div class=\"cards-3\">\n" +
"    <div class=\"card\"><div class=\"card-label\">L1 delivered</div><div class=\"card-value small delivered\" id=\"del-l1\">\u2014<span class=\"card-unit\">kW</span></div></div>\n" +
"    <div class=\"card\"><div class=\"card-label\">L2 delivered</div><div class=\"card-value small delivered\" id=\"del-l2\">\u2014<span class=\"card-unit\">kW</span></div></div>\n" +
"    <div class=\"card\"><div class=\"card-label\">L3 delivered</div><div class=\"card-value small delivered\" id=\"del-l3\">\u2014<span class=\"card-unit\">kW</span></div></div>\n" +
"  </div>\n" +
"  <div class=\"cards-3\">\n" +
"    <div class=\"card\"><div class=\"card-label\">L1 returned</div><div class=\"card-value small returned\" id=\"ret-l1\">\u2014<span class=\"card-unit\">kW</span></div></div>\n" +
"    <div class=\"card\"><div class=\"card-label\">L2 returned</div><div class=\"card-value small returned\" id=\"ret-l2\">\u2014<span class=\"card-unit\">kW</span></div></div>\n" +
"    <div class=\"card\"><div class=\"card-label\">L3 returned</div><div class=\"card-value small returned\" id=\"ret-l3\">\u2014<span class=\"card-unit\">kW</span></div></div>\n" +
"  </div>\n" +
"\n" +
"  <p class=\"section-title\">Per phase \u2014 Voltage &amp; Current</p>\n" +
"  <div class=\"cards-3\">\n" +
"    <div class=\"card\"><div class=\"card-label\">L1 voltage</div><div class=\"card-value small voltage\" id=\"v-l1\">\u2014<span class=\"card-unit\">V</span></div></div>\n" +
"    <div class=\"card\"><div class=\"card-label\">L2 voltage</div><div class=\"card-value small voltage\" id=\"v-l2\">\u2014<span class=\"card-unit\">V</span></div></div>\n" +
"    <div class=\"card\"><div class=\"card-label\">L3 voltage</div><div class=\"card-value small voltage\" id=\"v-l3\">\u2014<span class=\"card-unit\">V</span></div></div>\n" +
"  </div>\n" +
"  <div class=\"cards-3\">\n" +
"    <div class=\"card\"><div class=\"card-label\">L1 current</div><div class=\"card-value small\" id=\"a-l1\">\u2014<span class=\"card-unit\">A</span></div></div>\n" +
"    <div class=\"card\"><div class=\"card-label\">L2 current</div><div class=\"card-value small\" id=\"a-l2\">\u2014<span class=\"card-unit\">A</span></div></div>\n" +
"    <div class=\"card\"><div class=\"card-label\">L3 current</div><div class=\"card-value small\" id=\"a-l3\">\u2014<span class=\"card-unit\">A</span></div></div>\n" +
"  </div>\n" +
"\n" +
"  <p class=\"updated\" id=\"updated\">Waiting for data\u2026</p>\n" +
"\n" +
"  <p class=\"section-title\">History</p>\n" +
"  <div class=\"chart-card\">\n" +
"    <div class=\"tab-bar\">\n" +
"      <button class=\"tab active\" onclick=\"loadChart('day',this)\">Day</button>\n" +
"      <button class=\"tab\" onclick=\"loadChart('week',this)\">Week</button>\n" +
"      <button class=\"tab\" onclick=\"loadChart('month',this)\">Month</button>\n" +
"    </div>\n" +
"    <canvas id=\"chart\" height=\"120\"></canvas>\n" +
"  </div>\n" +
"\n" +
"  <div class=\"log-wrap\">\n" +
"  <table>\n" +
"    <thead><tr><th>Time</th><th>Del. total (kW)</th><th>Ret. total (kW)</th><th>Gas (m\u00b3)</th></tr></thead>\n" +
"    <tbody id=\"rows\"></tbody>\n" +
"  </table>\n" +
"  </div>\n" +
"\n" +
"  <script>\n" +
"    function val(v, dec) { return v != null ? Number(v).toFixed(dec != null ? dec : 3) : '\u2014'; }\n" +
"    function set(id, v, dec, unit) {\n" +
"      document.getElementById(id).innerHTML = val(v, dec) + '<span class=\"card-unit\">' + unit + '</span>';\n" +
"    }\n" +
"    function refresh() {\n" +
"      fetch('/api/latest').then(function(r) { return r.json(); }).then(function(d) {\n" +
"        var l = d.latest;\n" +
"        if (!l) return;\n" +
"        set('del-total', l.power_delivered_total_kw, 3, 'kW');\n" +
"        set('ret-total', l.power_returned_total_kw, 3, 'kW');\n" +
"        set('gas',       l.gas_m3,                  3, 'm\u00b3');\n" +
"        set('del-l1', l.power_delivered_l1_kw, 3, 'kW');\n" +
"        set('del-l2', l.power_delivered_l2_kw, 3, 'kW');\n" +
"        set('del-l3', l.power_delivered_l3_kw, 3, 'kW');\n" +
"        set('ret-l1', l.power_returned_l1_kw,  3, 'kW');\n" +
"        set('ret-l2', l.power_returned_l2_kw,  3, 'kW');\n" +
"        set('ret-l3', l.power_returned_l3_kw,  3, 'kW');\n" +
"        set('v-l1', l.voltage_l1, 1, 'V');\n" +
"        set('v-l2', l.voltage_l2, 1, 'V');\n" +
"        set('v-l3', l.voltage_l3, 1, 'V');\n" +
"        set('a-l1', l.current_l1, 0, 'A');\n" +
"        set('a-l2', l.current_l2, 0, 'A');\n" +
"        set('a-l3', l.current_l3, 0, 'A');\n" +
"        document.getElementById('updated').textContent = 'Last updated: ' + new Date(l.received_at).toLocaleTimeString();\n" +
"        var html = '';\n" +
"        for (var i = 0; i < d.recent.length; i++) {\n" +
"          var r = d.recent[i];\n" +
"          html += '<tr><td>' + new Date(r.received_at).toLocaleTimeString() + '</td>' +\n" +
"            '<td>' + val(r.power_delivered_total_kw) + '</td>' +\n" +
"            '<td>' + val(r.power_returned_total_kw)  + '</td>' +\n" +
"            '<td>' + val(r.gas_m3)                   + '</td></tr>';\n" +
"        }\n" +
"        document.getElementById('rows').innerHTML = html;\n" +
"      }).catch(function() {});\n" +
"    }\n" +
"    refresh();\n" +
"    setInterval(refresh, 3000);\n" +
"\n" +
"    var chart = null;\n" +
"    function loadChart(range, btn) {\n" +
"      document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });\n" +
"      if (btn) btn.classList.add('active');\n" +
"      fetch('/api/history?range=' + range).then(function(r) { return r.json(); }).then(function(rows) {\n" +
"        var labels = rows.map(function(r) { return r.period; });\n" +
"        var del    = rows.map(function(r) { return r.del != null ? Number(r.del).toFixed(3) : null; });\n" +
"        var ret    = rows.map(function(r) { return r.ret != null ? Number(r.ret).toFixed(3) : null; });\n" +
"        if (chart) chart.destroy();\n" +
"        chart = new Chart(document.getElementById('chart'), {\n" +
"          type: 'line',\n" +
"          data: {\n" +
"            labels: labels,\n" +
"            datasets: [\n" +
"              { label: 'Delivered (kW)', data: del, borderColor: '#34d399', backgroundColor: 'rgba(52,211,153,0.08)', tension: 0.3, pointRadius: 2, fill: true },\n" +
"              { label: 'Returned (kW)',  data: ret, borderColor: '#60a5fa', backgroundColor: 'rgba(96,165,250,0.08)', tension: 0.3, pointRadius: 2, fill: true }\n" +
"            ]\n" +
"          },\n" +
"          options: {\n" +
"            responsive: true,\n" +
"            interaction: { mode: 'index', intersect: false },\n" +
"            plugins: { legend: { labels: { color: '#94a3b8', boxWidth: 12 } } },\n" +
"            scales: {\n" +
"              x: { ticks: { color: '#475569', maxRotation: 45 }, grid: { color: '#1e293b' } },\n" +
"              y: { ticks: { color: '#475569' }, grid: { color: '#1e293b' }, beginAtZero: true }\n" +
"            }\n" +
"          }\n" +
"        });\n" +
"      }).catch(function() {});\n" +
"    }\n" +
"    loadChart('day', null);\n" +
"    setInterval(function() {\n" +
"      var active = document.querySelector('.tab.active');\n" +
"      if (active) loadChart(active.textContent.toLowerCase(), null);\n" +
"    }, 60000);\n" +
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
      try { data = JSON.parse(body); }
      catch (e) {
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
      db.all(
        "SELECT received_at, power_delivered_total_kw, power_returned_total_kw, gas_m3 FROM readings ORDER BY id DESC LIMIT 250",
        function(err2, recent) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ latest: latest || null, recent: recent || [] }));
        }
      );
    });
    return;
  }

  if (req.method === "GET" && req.url.indexOf("/api/history") === 0) {
    var range = "day";
    var qs = req.url.indexOf("?range=");
    if (qs !== -1) range = req.url.slice(qs + 7).split("&")[0];

    var interval, since, fmt;
    if (range === "week") {
      since = "'-7 days'"; fmt = "'%Y-%m-%d'";
    } else if (range === "month") {
      since = "'-30 days'"; fmt = "'%Y-%m-%d'";
    } else {
      since = "'-24 hours'"; fmt = "'%Y-%m-%d %H:00'";
    }

    var sql =
      "SELECT strftime(" + fmt + ", received_at) as period," +
      " AVG(power_delivered_total_kw) as del," +
      " AVG(power_returned_total_kw) as ret" +
      " FROM readings" +
      " WHERE received_at >= datetime('now'," + since + ")" +
      " GROUP BY period ORDER BY period ASC";

    db.all(sql, function(err, rows) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(rows || []));
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

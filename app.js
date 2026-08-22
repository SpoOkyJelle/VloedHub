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

const http = require("http");
const path = require("path");
const fs = require("fs");
const initSqlJs = require("sql.js");

const PORT = 5000;
const DB_PATH = path.join(__dirname, "p1_data.db");

let db;
let insertStmt;
let latestStmt;
let recentStmt;

function saveDb() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

initSqlJs().then(function(SQL) {
  const fileBuffer = fs.existsSync(DB_PATH) ? fs.readFileSync(DB_PATH) : null;
  db = fileBuffer ? new SQL.Database(fileBuffer) : new SQL.Database();

  db.run(`
    CREATE TABLE IF NOT EXISTS readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      received_at TEXT NOT NULL,
      device TEXT,
      power_delivered_kw REAL,
      power_returned_kw REAL,
      gas_m3 REAL,
      raw TEXT NOT NULL
    )
  `);

  insertStmt = db.prepare(`
    INSERT INTO readings (received_at, device, power_delivered_kw, power_returned_kw, gas_m3, raw)
    VALUES (:received_at, :device, :power_delivered_kw, :power_returned_kw, :gas_m3, :raw)
  `);

  latestStmt = db.prepare(`SELECT * FROM readings ORDER BY id DESC LIMIT 1`);
  recentStmt = db.prepare(`
    SELECT received_at, power_delivered_kw, power_returned_kw, gas_m3
    FROM readings ORDER BY id DESC LIMIT 20
  `);

  saveDb();

  server.listen(PORT, "0.0.0.0", function() {
    console.log("Server listening on http://0.0.0.0:" + PORT);
  });
});

function stmtToObjects(stmt) {
  var results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.reset();
  return results;
}

function logReading(data) {
  var received_at = new Date().toISOString();

  insertStmt.run({
    ":received_at": received_at,
    ":device": data.device != null ? data.device : null,
    ":power_delivered_kw": data.power_delivered_kw != null ? data.power_delivered_kw : null,
    ":power_returned_kw": data.power_returned_kw != null ? data.power_returned_kw : null,
    ":gas_m3": data.gas_m3 != null ? data.gas_m3 : null,
    ":raw": JSON.stringify(data),
  });

  saveDb();

  console.log(
    "[" + received_at + "] " + (data.device != null ? data.device : "unknown") + " - " +
    "delivered=" + data.power_delivered_kw + "kW " +
    "returned=" + data.power_returned_kw + "kW " +
    "gas=" + data.gas_m3 + "m3"
  );
}

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>VloedHub — P1 Live</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; padding: 2rem; }
    h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
    .subtitle { color: #64748b; font-size: 0.85rem; margin-bottom: 2rem; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
    .card { background: #1e293b; border-radius: 12px; padding: 1.25rem; }
    .card-label { font-size: 0.75rem; text-transform: uppercase; color: #64748b; letter-spacing: 0.05em; margin-bottom: 0.5rem; }
    .card-value { font-size: 2rem; font-weight: 700; }
    .card-unit { font-size: 0.85rem; color: #94a3b8; margin-left: 0.25rem; }
    .delivered { color: #34d399; }
    .returned { color: #60a5fa; }
    .gas { color: #f59e0b; }
    .updated { color: #475569; font-size: 0.8rem; margin-bottom: 1.5rem; }
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    th { text-align: left; padding: 0.5rem 0.75rem; color: #64748b; border-bottom: 1px solid #1e293b; }
    td { padding: 0.5rem 0.75rem; border-bottom: 1px solid #1e293b; color: #cbd5e1; }
    tr:last-child td { border-bottom: none; }
    .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #34d399; margin-right: 0.5rem; animation: pulse 2s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
  </style>
</head>
<body>
  <h1><span class="dot"></span>VloedHub P1 Monitor</h1>
  <p class="subtitle">Live energy readings from your smart meter</p>

  <div class="cards">
    <div class="card">
      <div class="card-label">Delivered</div>
      <div class="card-value delivered" id="delivered">—<span class="card-unit">kW</span></div>
    </div>
    <div class="card">
      <div class="card-label">Returned</div>
      <div class="card-value returned" id="returned">—<span class="card-unit">kW</span></div>
    </div>
    <div class="card">
      <div class="card-label">Gas</div>
      <div class="card-value gas" id="gas">—<span class="card-unit">m³</span></div>
    </div>
    <div class="card">
      <div class="card-label">Device</div>
      <div class="card-value" style="font-size:1.1rem;padding-top:0.6rem" id="device">—</div>
    </div>
  </div>

  <p class="updated" id="updated">Waiting for data…</p>

  <table>
    <thead>
      <tr>
        <th>Time</th>
        <th>Delivered (kW)</th>
        <th>Returned (kW)</th>
        <th>Gas (m³)</th>
      </tr>
    </thead>
    <tbody id="rows"></tbody>
  </table>

  <script>
    async function refresh() {
      const res = await fetch("/api/latest");
      if (!res.ok) return;
      const { latest, recent } = await res.json();

      if (latest) {
        document.getElementById("delivered").innerHTML =
          (latest.power_delivered_kw != null ? latest.power_delivered_kw : "—") + '<span class="card-unit">kW</span>';
        document.getElementById("returned").innerHTML =
          (latest.power_returned_kw != null ? latest.power_returned_kw : "—") + '<span class="card-unit">kW</span>';
        document.getElementById("gas").innerHTML =
          (latest.gas_m3 != null ? latest.gas_m3 : "—") + '<span class="card-unit">m³</span>';
        document.getElementById("device").textContent = latest.device != null ? latest.device : "unknown";
        document.getElementById("updated").textContent =
          "Last updated: " + new Date(latest.received_at).toLocaleTimeString();
      }

      const tbody = document.getElementById("rows");
      tbody.innerHTML = recent.map(function(r) { return \`
        <tr>
          <td>\${new Date(r.received_at).toLocaleTimeString()}</td>
          <td>\${r.power_delivered_kw != null ? r.power_delivered_kw : "—"}</td>
          <td>\${r.power_returned_kw != null ? r.power_returned_kw : "—"}</td>
          <td>\${r.gas_m3 != null ? r.gas_m3 : "—"}</td>
        </tr>
      \`; }).join("");
    }

    refresh();
    setInterval(refresh, 3000);
  </script>
</body>
</html>`;

const server = http.createServer(function(req, res) {
  if (req.method === "POST" && req.url === "/api/p1data") {
    const contentType = req.headers["content-type"] || "";
    if (!contentType.includes("application/json")) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "expected application/json" }));
      return;
    }

    let body = "";
    req.on("data", function(chunk) { body += chunk; });
    req.on("end", function() {
      try {
        const data = JSON.parse(body);
        logReading(data);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid JSON" }));
      }
    });
    return;
  }

  if (req.method === "GET" && req.url === "/api/latest") {
    var rows = stmtToObjects(latestStmt);
    var latest = rows.length > 0 ? rows[0] : null;
    var recent = stmtToObjects(recentStmt);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ latest: latest, recent: recent }));
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

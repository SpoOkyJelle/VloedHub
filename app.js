/*
 * Simple local server for the GoonESP32-P1meter dongle.
 *
 * Receives JSON P1 readings via HTTP POST and stores them in SQLite.
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
const Database = require("better-sqlite3");

const PORT = 5000;
const db = new Database(path.join(__dirname, "p1_data.db"));

db.exec(`
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

const insert = db.prepare(`
  INSERT INTO readings (received_at, device, power_delivered_kw, power_returned_kw, gas_m3, raw)
  VALUES (@received_at, @device, @power_delivered_kw, @power_returned_kw, @gas_m3, @raw)
`);

function logReading(data) {
  const received_at = new Date().toISOString();

  insert.run({
    received_at,
    device: data.device ?? null,
    power_delivered_kw: data.power_delivered_kw ?? null,
    power_returned_kw: data.power_returned_kw ?? null,
    gas_m3: data.gas_m3 ?? null,
    raw: JSON.stringify(data),
  });

  console.log(
    `[${received_at}] ${data.device ?? "unknown"} - ` +
      `delivered=${data.power_delivered_kw}kW ` +
      `returned=${data.power_returned_kw}kW ` +
      `gas=${data.gas_m3}m3`
  );
}

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/api/p1data") {
    const contentType = req.headers["content-type"] ?? "";
    if (!contentType.includes("application/json")) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "expected application/json" }));
      return;
    }

    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const data = JSON.parse(body);
        logReading(data);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid JSON" }));
      }
    });
    return;
  }

  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "running" }));
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on http://0.0.0.0:${PORT}`);
});

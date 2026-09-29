var db = require("../db/setup");
var logging = require("../db/logging");
var time = require("../utils/time");

module.exports = function(req, res) {
  if (req.method === "POST" && req.url === "/api/temperature") {
    var contentTypeT = req.headers["content-type"] || "";
    if (!contentTypeT.includes("application/json")) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "expected application/json" }));
      return true;
    }
    var bodyT = "";
    req.on("data", function(chunk) { bodyT += chunk; });
    req.on("end", function() {
      var dataT;
      try { dataT = JSON.parse(bodyT); }
      catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid JSON" }));
        return;
      }
      logging.logTemperatureReadings(dataT, function(err) {
        if (err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      });
    });
    return true;
  }

  if (req.method === "GET" && req.url === "/api/temperature/latest") {
    db.all(
      "SELECT room, temp_c, device, received_at FROM temperature_readings" +
      " WHERE id IN (SELECT MAX(id) FROM temperature_readings GROUP BY room)" +
      " ORDER BY room",
      function(err, rows) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(rows || []));
      }
    );
    return true;
  }

  if (req.method === "GET" && req.url.indexOf("/api/temperature/history") === 0) {
    var trange = "day";
    var tqs = req.url.indexOf("?range=");
    if (tqs !== -1) trange = req.url.slice(tqs + 7).split("&")[0];

    var tfmt, twhere, tparam;
    if (trange === "week") {
      tfmt = "'%Y-%m-%d'"; twhere = "received_at >= ?"; tparam = time.effectiveCutoff(604800000);
    } else if (trange === "month") {
      tfmt = "'%Y-%m-%d'"; twhere = "received_at >= ?"; tparam = time.effectiveCutoff(2592000000);
    } else {
      tfmt = "'%Y-%m-%d %H:00'"; twhere = "date(received_at) = ?"; tparam = time.todayAms();
    }

    db.all(
      "SELECT strftime(" + tfmt + ", received_at) as period, room, AVG(temp_c) as avg_temp" +
      " FROM temperature_readings" +
      " WHERE " + twhere +
      " GROUP BY period, room ORDER BY period ASC",
      [tparam],
      function(err, rows) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(rows || []));
      }
    );
    return true;
  }

  return false;
};

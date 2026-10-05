var db = require("../db/setup");
var logging = require("../db/logging");
var time = require("../utils/time");

module.exports = function(req, res) {
  if (req.method === "POST" && req.url === "/api/esphome") {
    var ct = req.headers["content-type"] || "";
    if (!ct.includes("application/json")) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "expected application/json" }));
      return true;
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
      logging.logEsphomeReadings(data, function(err) {
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

  if (req.method === "GET" && req.url === "/api/esphome/latest") {
    db.all(
      "SELECT device, sensor_name, value, unit, received_at FROM esphome_readings" +
      " WHERE id IN (SELECT MAX(id) FROM esphome_readings GROUP BY device, sensor_name)" +
      " ORDER BY device, sensor_name",
      function(err, rows) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(rows || []));
      }
    );
    return true;
  }

  if (req.method === "GET" && req.url.indexOf("/api/esphome/history") === 0) {
    var qs = req.url.indexOf("?") !== -1 ? req.url.slice(req.url.indexOf("?") + 1) : "";
    var params = {};
    qs.split("&").forEach(function(p) { var kv = p.split("="); if (kv[0]) params[kv[0]] = kv[1] || ""; });
    var range = params.range || "day";
    var sensor = params.sensor ? decodeURIComponent(params.sensor) : null;

    var fmt, where, paramList;
    if (range === "week") {
      fmt = "'%Y-%m-%d'"; where = "received_at >= ?"; paramList = [time.effectiveCutoff(604800000)];
    } else if (range === "month") {
      fmt = "'%Y-%m-%d'"; where = "received_at >= ?"; paramList = [time.effectiveCutoff(2592000000)];
    } else {
      fmt = "'%Y-%m-%d %H:00'"; where = "date(received_at) = ?"; paramList = [time.todayAms()];
    }

    var sensorWhere = sensor ? " AND sensor_name = ?" : "";
    if (sensor) paramList.push(sensor);

    db.all(
      "SELECT strftime(" + fmt + ", received_at) as period, sensor_name, device, AVG(value) as avg_value, unit" +
      " FROM esphome_readings" +
      " WHERE " + where + sensorWhere +
      " GROUP BY period, sensor_name ORDER BY period ASC",
      paramList,
      function(err, rows) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(rows || []));
      }
    );
    return true;
  }

  return false;
};

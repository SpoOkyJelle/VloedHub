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
      "SELECT room, temp_c, humidity, device, received_at FROM temperature_readings" +
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

    var tfmt, twhere, tparams;
    if (trange === "hour") {
      tfmt = "'%Y-%m-%d %H:%M'"; twhere = "received_at >= ?"; tparams = [time.cutoff(3600000)];
    } else if (trange === "week") {
      tfmt = "'%Y-%m-%d'"; twhere = "received_at >= ?"; tparams = [time.effectiveCutoff(604800000)];
    } else if (trange === "month") {
      tfmt = "'%Y-%m-%d'"; twhere = "received_at >= ?"; tparams = [time.effectiveCutoff(2592000000)];
    } else {
      // "vandaag" als index-vriendelijke range i.p.v. date(received_at) = ? (zie utils/time.dayRange)
      var tday = time.dayRange(time.todayAms());
      tfmt = "'%Y-%m-%d %H:00'"; twhere = "received_at >= ? AND received_at < ?"; tparams = [tday.start, tday.end];
    }

    db.all(
      "SELECT strftime(" + tfmt + ", received_at) as period, room, AVG(temp_c) as avg_temp, AVG(humidity) as avg_humidity" +
      " FROM temperature_readings" +
      " WHERE " + twhere +
      " GROUP BY period, room ORDER BY period ASC",
      tparams,
      function(err, rows) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(rows || []));
      }
    );
    return true;
  }

  if (req.method === "GET" && req.url === "/api/heating/latest") {
    db.all(
      "SELECT room, setpoint_c, temp_c, heating_power, device, received_at FROM heating_readings" +
      " WHERE id IN (SELECT MAX(id) FROM heating_readings GROUP BY room)" +
      " ORDER BY room",
      function(err, rows) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(rows || []));
      }
    );
    return true;
  }

  // Opwarmcurve per kamer: gevraagde temperatuur (setpoint), actuele temperatuur en stookpercentage over
  // tijd. hour/day geven per-minuut punten (fijnmazig genoeg voor "hoelang tot op peil"), week/month
  // dunnen uit naar uur/dag. Combineer met /api/gas-daily voor de efficiëntie (gasverbruik vs. opwarmtijd).
  if (req.method === "GET" && req.url.indexOf("/api/heating/history") === 0) {
    var hrange = "day";
    var hqs = req.url.indexOf("?range=");
    if (hqs !== -1) hrange = req.url.slice(hqs + 7).split("&")[0];

    var hfmt, hwhere, hparams;
    if (hrange === "hour") {
      hfmt = "'%Y-%m-%d %H:%M'"; hwhere = "received_at >= ?"; hparams = [time.cutoff(3600000)];
    } else if (hrange === "week") {
      hfmt = "'%Y-%m-%d %H:00'"; hwhere = "received_at >= ?"; hparams = [time.effectiveCutoff(604800000)];
    } else if (hrange === "month") {
      hfmt = "'%Y-%m-%d'"; hwhere = "received_at >= ?"; hparams = [time.effectiveCutoff(2592000000)];
    } else {
      var hday = time.dayRange(time.todayAms());
      hfmt = "'%Y-%m-%d %H:%M'"; hwhere = "received_at >= ? AND received_at < ?"; hparams = [hday.start, hday.end];
    }

    db.all(
      "SELECT strftime(" + hfmt + ", received_at) as period, room," +
      " AVG(setpoint_c) as setpoint, AVG(temp_c) as temp, AVG(heating_power) as heating_power" +
      " FROM heating_readings" +
      " WHERE " + hwhere +
      " GROUP BY period, room ORDER BY period ASC",
      hparams,
      function(err, rows) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(rows || []));
      }
    );
    return true;
  }

  return false;
};

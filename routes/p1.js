var db = require("../db/setup");
var logging = require("../db/logging");
var time = require("../utils/time");

module.exports = function(req, res) {
  if (req.method === "POST" && req.url === "/api/p1data") {
    var contentType = req.headers["content-type"] || "";
    if (!contentType.includes("application/json")) {
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
      logging.logReading(data, function(err) {
        if (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "db error" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      });
    });
    return true;
  }

  if (req.method === "GET" && req.url === "/api/latest") {
    db.get("SELECT * FROM readings ORDER BY id DESC LIMIT 1", function(err, latest) {
      db.all(
        "SELECT received_at, power_delivered_total_kw, power_returned_total_kw, gas_m3 FROM readings ORDER BY id DESC LIMIT 20",
        function(err2, recent) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ latest: latest || null, recent: recent || [] }));
        }
      );
    });
    return true;
  }

  if (req.method === "GET" && req.url.indexOf("/api/history") === 0) {
    var range = "day";
    var qs = req.url.indexOf("?range=");
    if (qs !== -1) range = req.url.slice(qs + 7).split("&")[0];

    var sinceMs, fmt;
    if (range === "week") {
      sinceMs = 604800000; fmt = "'%Y-%m-%d'";
    } else if (range === "month") {
      sinceMs = 2592000000; fmt = "'%Y-%m-%d'";
    } else {
      fmt = "'%Y-%m-%d %H:00'";
    }

    // "day" means the calendar day so far, not a rolling 24h window
    var sinceParam = range === "day" ? (time.todayAms() + "T00:00:00") : time.effectiveCutoff(sinceMs);

    var sql =
      "SELECT strftime(" + fmt + ", received_at) as period," +
      " AVG(power_delivered_total_kw) as del," +
      " AVG(power_returned_total_kw) as ret" +
      " FROM readings" +
      " WHERE received_at >= ?" +
      " GROUP BY period ORDER BY period ASC";

    db.all(sql, [sinceParam], function(err, rows) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(rows || []));
    });
    return true;
  }

  if (req.method === "GET" && req.url === "/api/peaks") {
    db.all(
      "SELECT strftime('%H', received_at) as hour," +
      " AVG(power_delivered_total_kw) as avg_del," +
      " COUNT(*) as n" +
      " FROM readings" +
      " WHERE power_delivered_total_kw IS NOT NULL AND received_at >= ?" +
      " GROUP BY strftime('%H', received_at)" +
      " ORDER BY hour",
      [time.dataFloor()],
      function(err, rows) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(rows || []));
      }
    );
    return true;
  }

  if (req.method === "GET" && req.url === "/api/phase-stats") {
    db.get(
      "SELECT" +
      " AVG(power_delivered_l1_kw) as avg_l1, AVG(power_delivered_l2_kw) as avg_l2, AVG(power_delivered_l3_kw) as avg_l3," +
      " MAX(power_delivered_l1_kw) as max_l1, MAX(power_delivered_l2_kw) as max_l2, MAX(power_delivered_l3_kw) as max_l3" +
      " FROM readings" +
      " WHERE received_at >= ?" +
      " AND power_delivered_l1_kw IS NOT NULL",
      [time.effectiveCutoff(604800000)],
      function(err, row) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(row || {}));
      }
    );
    return true;
  }

  if (req.method === "GET" && req.url === "/api/stats") {
    db.get(
      "SELECT" +
      " AVG(power_delivered_total_kw) as avg_del," +
      " MAX(power_delivered_total_kw) as max_del," +
      " MAX(power_returned_total_kw) as max_ret," +
      " COUNT(*) as total_readings," +
      " AVG(power_delivered_l1_kw) as avg_l1," +
      " AVG(power_delivered_l2_kw) as avg_l2," +
      " AVG(power_delivered_l3_kw) as avg_l3," +
      " MIN(voltage_l1) as min_v1, MAX(voltage_l1) as max_v1," +
      " MIN(voltage_l2) as min_v2, MAX(voltage_l2) as max_v2," +
      " MIN(voltage_l3) as min_v3, MAX(voltage_l3) as max_v3," +
      " AVG(voltage_l1) as avg_v1, AVG(voltage_l2) as avg_v2, AVG(voltage_l3) as avg_v3" +
      " FROM readings" +
      " WHERE date(received_at) = ?" +
      " AND power_delivered_total_kw IS NOT NULL",
      [time.todayAms()],
      function(err, row) {
        if (row) {
          // fasen zonder spanning (enkelfase-aansluiting) tellen niet mee
          var live = [1, 2, 3].filter(function(i) { return row["avg_v" + i] != null && row["avg_v" + i] > 50; });
          if (live.length) {
            row.avg_v = live.reduce(function(t, i) { return t + row["avg_v" + i]; }, 0) / live.length;
            row.min_v = Math.min.apply(null, live.map(function(i) { return row["min_v" + i]; }));
            row.max_v = Math.max.apply(null, live.map(function(i) { return row["max_v" + i]; }));
          }
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(row || {}));
      }
    );
    return true;
  }

  if (req.method === "GET" && req.url.indexOf("/api/heatmap") === 0) {
    var hmQs = req.url.indexOf("?range=");
    var hmRange = hmQs !== -1 ? req.url.slice(hmQs + 7).split("&")[0] : "alltime";
    var hmWhere = "power_delivered_total_kw IS NOT NULL AND received_at >= ?";
    var hmParams = [];
    if (hmRange === "year")       { hmParams.push(time.effectiveCutoff(365 * 86400000)); }
    else if (hmRange === "month") { hmParams.push(time.effectiveCutoff(2592000000)); }
    else if (hmRange === "day")   { hmParams.push(time.effectiveCutoff(86400000)); }
    else                          { hmParams.push(time.dataFloor()); }
    db.all(
      "SELECT strftime('%w', received_at) as dow, strftime('%H', received_at) as hour," +
      " AVG(power_delivered_total_kw) as avg_del, COUNT(*) as n" +
      " FROM readings WHERE " + hmWhere +
      " GROUP BY dow, hour",
      hmParams,
      function(err, rows) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(rows || []));
      }
    );
    return true;
  }

  if (req.method === "GET" && req.url === "/api/voltage-dips") {
    var vdSince = time.effectiveCutoff(604800000);
    db.get(
      "SELECT" +
      " SUM(CASE WHEN low = 1 AND COALESCE(plow, 0) = 0 THEN 1 ELSE 0 END) as dips," +
      " SUM(CASE WHEN high = 1 AND COALESCE(phigh, 0) = 0 THEN 1 ELSE 0 END) as peaks" +
      " FROM (SELECT low, high, LAG(low) OVER (ORDER BY id) as plow, LAG(high) OVER (ORDER BY id) as phigh" +
      "  FROM (SELECT id," +
      "   ((voltage_l1 > 50 AND voltage_l1 < 207) OR (voltage_l2 > 50 AND voltage_l2 < 207) OR (voltage_l3 > 50 AND voltage_l3 < 207)) as low," +
      "   (voltage_l1 > 253 OR voltage_l2 > 253 OR voltage_l3 > 253) as high" +
      "   FROM readings WHERE received_at >= ?))",
      [vdSince],
      function(err, events) {
        db.get(
          "SELECT MAX(current_l1) as max_a1, MAX(current_l2) as max_a2, MAX(current_l3) as max_a3 FROM readings WHERE received_at >= ?",
          [vdSince],
          function(err2, row) {
            row = row || {};
            row.dips = events && events.dips != null ? events.dips : 0;
            row.peaks = events && events.peaks != null ? events.peaks : 0;
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(row));
          }
        );
      }
    );
    return true;
  }

  return false;
};

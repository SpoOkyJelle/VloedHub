var fs = require("fs");
var path = require("path");
var db = require("../db/setup");
var time = require("../utils/time");
var state = require("../utils/state");

var DEBUG_HTML = fs.readFileSync(path.join(__dirname, "../public/debug.html"), "utf8");

module.exports = function(req, res) {
  if (req.method === "GET" && req.url === "/api/debug/stats") {
    var dbPath = path.join(__dirname, "../p1_data.db");
    var dbSize = 0;
    try { dbSize = fs.statSync(dbPath).size; } catch(e) {}
    db.get(
      "SELECT COUNT(*) as total, MIN(received_at) as first_entry, MAX(received_at) as last_entry," +
      " COUNT(DISTINCT date(received_at)) as days_with_data" +
      " FROM readings",
      function(err, row) {
        db.get(
          "SELECT COUNT(*) as today FROM readings WHERE date(received_at) = ?",
          [time.todayAms()],
          function(err2, today) {
            db.get(
              "SELECT COUNT(*) as last_hour FROM readings WHERE received_at >= ?",
              [time.cutoff(3600000)],
              function(err3, hour) {
                db.get(
                  "SELECT AVG(cnt) as avg_per_day FROM (SELECT COUNT(*) as cnt FROM readings GROUP BY date(received_at))",
                  function(err4, avg) {
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({
                      total: row ? row.total : 0,
                      first_entry: row ? row.first_entry : null,
                      last_entry: row ? row.last_entry : null,
                      days_with_data: row ? row.days_with_data : 0,
                      today: today ? today.today : 0,
                      last_hour: hour ? hour.last_hour : 0,
                      avg_per_day: avg ? avg.avg_per_day : 0,
                      db_size_mb: (dbSize / 1024 / 1024).toFixed(2)
                    }));
                  }
                );
              }
            );
          }
        );
      }
    );
    return true;
  }

  if (req.method === "GET" && req.url.indexOf("/api/debug/logs") === 0) {
    var qs = req.url.indexOf("?");
    var params = qs !== -1 ? req.url.slice(qs + 1) : "";
    var limitMatch = params.match(/limit=(\d+)/);
    var offsetMatch = params.match(/offset=(\d+)/);
    var limitRaw = parseInt(limitMatch ? limitMatch[1] : "100", 10);
    var limit = limitRaw === 0 ? 0 : Math.min(limitRaw, 99999);
    var offset = parseInt(offsetMatch ? offsetMatch[1] : "0", 10);
    db.all(
      "SELECT id, received_at, device, power_delivered_total_kw, gas_m3," +
      " power_delivered_l1_kw, power_delivered_l2_kw, power_delivered_l3_kw," +
      " voltage_l1, voltage_l2, voltage_l3, current_l1, current_l2, current_l3" +
      " FROM readings ORDER BY id DESC" + (limit === 0 ? "" : " LIMIT ? OFFSET ?"),
      limit === 0 ? [] : [limit, offset],
      function(err, rows) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(rows || []));
      }
    );
    return true;
  }

  if (req.method === "GET" && req.url.indexOf("/api/debug/gap-list") === 0) {
    var glQs = req.url.indexOf("?");
    var glParams = glQs !== -1 ? req.url.slice(glQs + 1) : "";
    var glMinMatch = glParams.match(/min=(\d+(\.\d+)?)/);
    var glMin = parseFloat(glMinMatch ? glMinMatch[1] : "5");
    db.all(
      "WITH ordered AS (" +
      "  SELECT received_at AS ts, LAG(received_at) OVER (ORDER BY id) AS prev_ts" +
      "  FROM readings WHERE received_at >= ?" +
      ")" +
      "SELECT" +
      "  date(ts) AS day," +
      "  time(prev_ts) AS gap_start," +
      "  time(ts) AS gap_end," +
      "  ROUND((julianday(ts) - julianday(prev_ts)) * 1440, 1) AS gap_min" +
      " FROM ordered" +
      " WHERE prev_ts IS NOT NULL" +
      "   AND (julianday(ts) - julianday(prev_ts)) * 1440 > ?" +
      " ORDER BY ts DESC LIMIT 500",
      [time.cutoff(5184000000), glMin],
      function(err, rows) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(rows || []));
      }
    );
    return true;
  }

  if (req.method === "GET" && req.url.indexOf("/api/debug/gaps") === 0) {
    db.all(
      "WITH ordered AS (" +
      "  SELECT received_at AS ts, LAG(received_at) OVER (ORDER BY id) AS prev_ts" +
      "  FROM readings WHERE received_at >= ?" +
      ")," +
      "gaps AS (" +
      "  SELECT date(ts) AS day," +
      "    ROUND((julianday(ts) - julianday(prev_ts)) * 1440, 1) AS gap_min," +
      "    time(prev_ts) AS gap_start, time(ts) AS gap_end" +
      "  FROM ordered" +
      "  WHERE prev_ts IS NOT NULL AND (julianday(ts) - julianday(prev_ts)) * 1440 > 2" +
      ")," +
      "day_summary AS (" +
      "  SELECT date(received_at) AS day, COUNT(*) AS n," +
      "    MIN(received_at) AS first_ts, MAX(received_at) AS last_ts," +
      "    ROUND((julianday(MAX(received_at)) - julianday(MIN(received_at))) * 1440) AS span_min" +
      "  FROM readings WHERE received_at >= ?" +
      "  GROUP BY date(received_at)" +
      ")" +
      "SELECT d.day, d.n, d.first_ts AS first, d.last_ts AS last, d.span_min," +
      "  COUNT(g.gap_min) AS gap_count," +
      "  MAX(g.gap_min) AS max_gap_min," +
      "  (SELECT g2.gap_start FROM gaps g2 WHERE g2.day = d.day ORDER BY g2.gap_min DESC LIMIT 1) AS biggest_gap_start," +
      "  (SELECT g2.gap_end FROM gaps g2 WHERE g2.day = d.day ORDER BY g2.gap_min DESC LIMIT 1) AS biggest_gap_end" +
      " FROM day_summary d LEFT JOIN gaps g ON g.day = d.day" +
      " GROUP BY d.day ORDER BY d.day DESC LIMIT 60",
      [time.cutoff(5184000000), time.cutoff(5184000000)],
      function(err, rows) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(rows || []));
      }
    );
    return true;
  }

  if (req.method === "POST" && req.url === "/api/debug/set-old-data") {
    var body = "";
    req.on("data", function(c) { body += c; });
    req.on("end", function() {
      try { state.includeOldData = !!JSON.parse(body).value; } catch(e) {}
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ includeOldData: state.includeOldData }));
    });
    return true;
  }

  if (req.method === "GET" && req.url === "/api/debug/old-data-setting") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ includeOldData: state.includeOldData, cutoffDate: state.DATA_CUTOFF }));
    return true;
  }

  if (req.method === "POST" && req.url === "/api/debug/fridge-test") {
    require("../services/fridge").testConnection(function(result) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    });
    return true;
  }

  if (req.method === "GET" && req.url === "/debug") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(DEBUG_HTML);
    return true;
  }

  return false;
};

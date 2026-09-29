var db = require("../db/setup");
var prices = require("../services/prices");
var time = require("../utils/time");

module.exports = function(req, res) {
  if (req.method === "GET" && req.url === "/api/costs") {
    prices.fetchPrices(function(err, priceData) {
      if (err) { priceData = {}; }
      var ep = priceData.electricity_eur_kwh || null;
      var gp = priceData.gas_eur_m3 || null;
      var periods = [
        { key: "hour",  ms: 3600000 },
        { key: "day",   ms: 86400000 },
        { key: "week",  ms: 604800000 },
        { key: "month", ms: 2592000000 }
      ];
      var results = {};
      var pending = periods.length;
      periods.forEach(function(p) {
        // "day" means the calendar day so far, not a rolling 24h window
        var where = p.key === "day" ? "date(received_at) = ?" : "received_at >= ?";
        var param = p.key === "day" ? time.todayAms() : time.effectiveCutoff(p.ms);
        db.get(
          "SELECT AVG(power_delivered_total_kw) as avg_kw," +
          " (julianday(MAX(received_at)) - julianday(MIN(received_at))) * 24 as hours," +
          " MAX(gas_m3) - MIN(gas_m3) as gas_used, COUNT(*) as n" +
          " FROM readings WHERE " + where,
          [param],
          function(err2, row) {
            var elec_kwh = (row && row.n > 1) ? row.avg_kw * row.hours : null;
            var gas_m3   = (row && row.n > 1) ? row.gas_used : null;
            results[p.key] = {
              elec_kwh:  elec_kwh,
              elec_cost: (elec_kwh != null && ep != null) ? elec_kwh * ep : null,
              gas_m3:    gas_m3,
              gas_cost:  (gas_m3  != null && gp != null) ? gas_m3  * gp : null
            };
            if (--pending === 0) {
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify(results));
            }
          }
        );
      });
    });
    return true;
  }

  if (req.method === "GET" && req.url === "/api/costs-daily") {
    prices.fetchPrices(function(err, priceData) {
      if (err) { priceData = {}; }
      var ep = priceData.electricity_eur_kwh || null;
      var gp = priceData.gas_eur_m3 || null;
      db.all(
        "SELECT date(received_at) as day," +
        " AVG(power_delivered_total_kw) as avg_kw," +
        " (julianday(MAX(received_at))-julianday(MIN(received_at)))*24 as hours," +
        " MAX(gas_m3)-MIN(gas_m3) as gas_used," +
        " COUNT(*) as n" +
        " FROM readings" +
        " WHERE received_at >= ? AND power_delivered_total_kw IS NOT NULL" +
        " GROUP BY day ORDER BY day ASC",
        [time.effectiveCutoff(2592000000)],
        function(err2, rows) {
          var result = (rows || []).map(function(row) {
            var elec_kwh = (row.n > 1 && row.avg_kw != null && row.hours != null) ? row.avg_kw * row.hours : null;
            var elec_cost = (elec_kwh != null && ep != null) ? elec_kwh * ep : null;
            var gas_cost = (row.gas_used != null && gp != null) ? row.gas_used * gp : null;
            return { day: row.day, elec_cost: elec_cost, gas_cost: gas_cost };
          });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        }
      );
    });
    return true;
  }

  if (req.method === "GET" && req.url === "/api/day-comparison") {
    var days = [
      { key: "today",     date: time.dateAms(0) },
      { key: "yesterday", date: time.dateAms(-86400000) },
      { key: "lastweek",  date: time.dateAms(-7 * 86400000) }
    ];
    var dcResults = {};
    var dcPending = days.length;
    days.forEach(function(d) {
      db.get(
        "SELECT AVG(power_delivered_total_kw) as avg_kw," +
        " (julianday(MAX(received_at)) - julianday(MIN(received_at)))*24 as hours," +
        " MAX(gas_m3)-MIN(gas_m3) as gas_used, COUNT(*) as n" +
        " FROM readings WHERE date(received_at) = ?",
        [d.date],
        function(err2, row) {
          var elec_kwh = (row && row.n > 1 && row.avg_kw != null && row.hours != null) ? row.avg_kw * row.hours : null;
          var gas_used = (row && row.n > 1) ? row.gas_used : null;
          dcResults[d.key] = { elec_kwh: elec_kwh, gas_used: gas_used };
          if (--dcPending === 0) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(dcResults));
          }
        }
      );
    });
    return true;
  }

  if (req.method === "GET" && req.url === "/api/night-usage") {
    db.get(
      "SELECT AVG(power_delivered_total_kw) as night_avg, AVG(current_l1+current_l2+current_l3) as night_amp" +
      " FROM readings" +
      " WHERE strftime('%H', received_at) BETWEEN '00' AND '05'" +
      " AND received_at >= ?" +
      " AND power_delivered_total_kw IS NOT NULL",
      [time.effectiveCutoff(604800000)],
      function(err, row) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(row || {}));
      }
    );
    return true;
  }

  if (req.method === "GET" && req.url === "/api/weekday-avg") {
    db.all(
      "SELECT strftime('%w', received_at) as dow, AVG(power_delivered_total_kw) as avg_del" +
      " FROM readings" +
      " WHERE received_at >= ?" +
      " AND power_delivered_total_kw IS NOT NULL" +
      " GROUP BY dow ORDER BY dow",
      [time.effectiveCutoff(5184000000)],
      function(err, rows) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(rows || []));
      }
    );
    return true;
  }

  return false;
};

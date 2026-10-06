var db = require("../db/setup");
var prices = require("../services/prices");
var time = require("../utils/time");

function json(res, data) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function nowAms() {
  return new Date().toLocaleString("sv-SE", { timeZone: "Europe/Amsterdam" }).replace(" ", "T");
}

function sum(rows, key) {
  return rows.reduce(function(t, r) { return t + (r[key] || 0); }, 0);
}

module.exports = function(req, res) {
  // Verwachte kosten voor de lopende kalendermaand, op basis van de dagen tot nu toe
  if (req.method === "GET" && req.url === "/api/insights/forecast") {
    prices.fetchPrices(function(err, priceData) {
      if (err) { priceData = {}; }
      var ep = priceData.electricity_eur_kwh || null;
      var gp = priceData.gas_eur_m3 || null;
      var today = time.todayAms();
      var monthStart = today.slice(0, 8) + "01T00:00:00";
      var floor = time.dataFloor();
      db.all(
        "SELECT date(received_at) as day," +
        " AVG(power_delivered_total_kw) as avg_kw," +
        " (julianday(MAX(received_at))-julianday(MIN(received_at)))*24 as hours," +
        " MAX(gas_m3)-MIN(gas_m3) as gas_used, COUNT(*) as n" +
        " FROM readings WHERE received_at >= ? AND power_delivered_total_kw IS NOT NULL" +
        " GROUP BY day ORDER BY day ASC",
        [monthStart > floor ? monthStart : floor],
        function(err2, rows) {
          var days = (rows || []).filter(function(r) { return r.n > 1; }).map(function(r) {
            return { day: r.day, kwh: (r.avg_kw || 0) * (r.hours || 0), gas: r.gas_used || 0 };
          });
          var full = days.filter(function(d) { return d.day < today; });
          var cur = days.filter(function(d) { return d.day === today; })[0] || { kwh: 0, gas: 0 };
          var year = parseInt(today.slice(0, 4), 10), month = parseInt(today.slice(5, 7), 10);
          var daysInMonth = new Date(year, month, 0).getDate();
          var daysAfterToday = daysInMonth - parseInt(today.slice(8, 10), 10);

          var kwhSoFar = sum(days, "kwh"), gasSoFar = sum(days, "gas");
          var out = {
            elec_kwh: kwhSoFar,
            gas_m3: gasSoFar,
            cost: (ep != null ? kwhSoFar * ep : 0) + (gp != null ? gasSoFar * gp : 0),
            days_measured: full.length,
            days_in_month: daysInMonth,
            forecast_kwh: null, forecast_gas: null, forecast_cost: null
          };
          if (full.length && ep != null) {
            var avgKwh = sum(full, "kwh") / full.length, avgGas = sum(full, "gas") / full.length;
            // vandaag telt als een gemiddelde dag zolang hij daar nog onder zit
            out.forecast_kwh = sum(full, "kwh") + Math.max(cur.kwh, avgKwh) + avgKwh * daysAfterToday;
            out.forecast_gas = sum(full, "gas") + Math.max(cur.gas, avgGas) + avgGas * daysAfterToday;
            out.forecast_cost = out.forecast_kwh * ep + (gp != null ? out.forecast_gas * gp : 0);
          }
          json(res, out);
        }
      );
    });
    return true;
  }

  // Verbruik van vandaag tot dit tijdstip, tegenover dezelfde weekdag in de afgelopen 60 dagen
  if (req.method === "GET" && req.url === "/api/insights/today-vs-normal") {
    var now = nowAms();
    var todayDate = now.slice(0, 10), clock = now.slice(11, 19);
    var dow = String(new Date(todayDate + "T12:00:00Z").getUTCDay());
    db.all(
      "SELECT date(received_at) as day, strftime('%w', received_at) as dow," +
      " AVG(power_delivered_total_kw) as avg_kw," +
      " (julianday(MAX(received_at))-julianday(MIN(received_at)))*24 as hours, COUNT(*) as n" +
      " FROM readings WHERE received_at >= ? AND time(received_at) <= ?" +
      " AND power_delivered_total_kw IS NOT NULL GROUP BY day",
      [time.effectiveCutoff(5184000000), clock],
      function(err, rows) {
        var days = (rows || []).filter(function(r) { return r.n > 1; }).map(function(r) {
          return { day: r.day, dow: r.dow, kwh: (r.avg_kw || 0) * (r.hours || 0) };
        });
        var todayRow = days.filter(function(d) { return d.day === todayDate; })[0];
        var past = days.filter(function(d) { return d.day !== todayDate; });
        var same = past.filter(function(d) { return d.dow === dow; });
        var basis = same.length >= 2 ? same : past;
        json(res, {
          today_kwh: todayRow ? todayRow.kwh : null,
          normal_kwh: basis.length ? sum(basis, "kwh") / basis.length : null,
          samples: basis.length,
          basis: same.length >= 2 ? "weekday" : "all"
        });
      }
    );
    return true;
  }

  return false;
};

var db = require("../db/setup");
var prices = require("../services/prices");
var time = require("../utils/time");

function json(res, data) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function nowAms() {
  return new Date().toLocaleString("sv-SE", { timeZone: "Europe/Amsterdam" });
}

// Verbruik en kosten per kalenderdag over de laatste `days` dagen (vandaag meegeteld).
// Stroom wordt per uur gerekend met de prijs van dat uur, gas per dag met de prijs van die dag.
// Voor uren zonder bewaarde prijs geldt de huidige prijs.
function dailyCosts(days, cb) {
  var since = time.dateAms(-(days - 1) * 86400000) + "T00:00:00";
  var floor = time.dataFloor();
  if (floor > since) since = floor;

  prices.fetchPrices(function(err, cur) {
    cur = cur || {};
    var ep = cur.electricity_eur_kwh != null ? cur.electricity_eur_kwh : null;
    var gp = cur.gas_eur_m3 != null ? cur.gas_eur_m3 : null;
    prices.priceMaps(since.slice(0, 10), function(maps) {
      db.all(
        "SELECT strftime('%Y-%m-%d %H', received_at) as h, AVG(power_delivered_total_kw) as avg_kw, COUNT(*) as n" +
        " FROM readings WHERE received_at >= ? AND power_delivered_total_kw IS NOT NULL" +
        " GROUP BY h ORDER BY h ASC",
        [since],
        function(err2, hourRows) {
          db.all(
            "SELECT date(received_at) as day, MAX(gas_m3) - MIN(gas_m3) as gas_used" +
            " FROM readings WHERE received_at >= ? AND gas_m3 IS NOT NULL GROUP BY day",
            [since],
            function(err3, gasRows) {
              var now = nowAms();
              var curHour = now.slice(0, 13);
              // het lopende uur telt alleen voor het deel dat al voorbij is
              var curFrac = (parseInt(now.slice(14, 16), 10) * 60 + parseInt(now.slice(17, 19), 10)) / 3600;
              var out = {};
              function day(d) {
                if (!out[d]) out[d] = { day: d, elec_kwh: null, elec_cost: null, gas_m3: null, gas_cost: null };
                return out[d];
              }
              (hourRows || []).forEach(function(r) {
                if (r.avg_kw == null) return;
                var kwh = r.avg_kw * (r.h === curHour ? curFrac : 1);
                var price = maps.elec[r.h] != null ? maps.elec[r.h] : ep;
                var d = day(r.h.slice(0, 10));
                d.elec_kwh = (d.elec_kwh || 0) + kwh;
                if (price != null) d.elec_cost = (d.elec_cost || 0) + kwh * price;
              });
              (gasRows || []).forEach(function(r) {
                if (r.gas_used == null) return;
                var price = maps.gas[r.day] != null ? maps.gas[r.day] : gp;
                var d = day(r.day);
                d.gas_m3 = r.gas_used;
                d.gas_cost = price != null ? r.gas_used * price : null;
              });
              cb(Object.keys(out).sort().map(function(k) { return out[k]; }));
            }
          );
        }
      );
    });
  });
}

function sumDays(rows) {
  var t = { elec_kwh: null, elec_cost: null, gas_m3: null, gas_cost: null };
  rows.forEach(function(r) {
    Object.keys(t).forEach(function(k) { if (r[k] != null) t[k] = (t[k] || 0) + r[k]; });
  });
  return t;
}

// Verbruik van één kalenderdag, optioneel alleen tot een kloktijd ("HH:MM:SS")
function dayUsage(date, untilClock, cb) {
  db.get(
    "SELECT AVG(power_delivered_total_kw) as avg_kw," +
    " (julianday(MAX(received_at)) - julianday(MIN(received_at)))*24 as hours," +
    " MAX(gas_m3)-MIN(gas_m3) as gas_used, COUNT(*) as n" +
    " FROM readings WHERE date(received_at) = ?" + (untilClock ? " AND time(received_at) <= ?" : ""),
    untilClock ? [date, untilClock] : [date],
    function(err, row) {
      var ok = row && row.n > 1;
      cb({
        elec_kwh: (ok && row.avg_kw != null && row.hours != null) ? row.avg_kw * row.hours : null,
        gas_used: ok ? row.gas_used : null
      });
    }
  );
}

module.exports = function(req, res) {
  if (req.method === "GET" && req.url === "/api/costs") {
    prices.fetchPrices(function(err, priceData) {
      if (err) { priceData = {}; }
      var ep = priceData.electricity_eur_kwh || null;
      var gp = priceData.gas_eur_m3 || null;
      // laatste 60 minuten, tegen de prijs van dit uur
      db.get(
        "SELECT AVG(power_delivered_total_kw) as avg_kw," +
        " (julianday(MAX(received_at)) - julianday(MIN(received_at))) * 24 as hours," +
        " MAX(gas_m3) - MIN(gas_m3) as gas_used, COUNT(*) as n" +
        " FROM readings WHERE received_at >= ?",
        [time.effectiveCutoff(3600000)],
        function(err2, row) {
          var elec_kwh = (row && row.n > 1) ? row.avg_kw * row.hours : null;
          var gas_m3   = (row && row.n > 1) ? row.gas_used : null;
          var hour = {
            elec_kwh:  elec_kwh,
            elec_cost: (elec_kwh != null && ep != null) ? elec_kwh * ep : null,
            gas_m3:    gas_m3,
            gas_cost:  (gas_m3  != null && gp != null) ? gas_m3  * gp : null
          };
          dailyCosts(30, function(days) {
            var today = time.todayAms();
            var weekStart = time.dateAms(-6 * 86400000);
            json(res, {
              hour:  hour,
              day:   sumDays(days.filter(function(d) { return d.day === today; })),
              week:  sumDays(days.filter(function(d) { return d.day >= weekStart; })),
              month: sumDays(days)
            });
          });
        }
      );
    });
    return true;
  }

  if (req.method === "GET" && req.url === "/api/costs-daily") {
    dailyCosts(30, function(days) {
      json(res, days.map(function(d) { return { day: d.day, elec_cost: d.elec_cost, gas_cost: d.gas_cost }; }));
    });
    return true;
  }

  if (req.method === "GET" && req.url === "/api/day-comparison") {
    var clock = nowAms().slice(11, 19);
    var days = [
      { key: "today",     date: time.dateAms(0) },
      { key: "yesterday", date: time.dateAms(-86400000) },
      { key: "lastweek",  date: time.dateAms(-7 * 86400000) }
    ];
    var dcResults = {};
    var dcPending = days.length * 2;
    function done() {
      if (--dcPending === 0) json(res, dcResults);
    }
    days.forEach(function(d) {
      dcResults[d.key] = {};
      dayUsage(d.date, null, function(u) {
        dcResults[d.key].elec_kwh = u.elec_kwh;
        dcResults[d.key].gas_used = u.gas_used;
        done();
      });
      // zelfde dag tot het huidige tijdstip, voor een eerlijke vergelijking met vandaag
      dayUsage(d.date, clock, function(u) {
        dcResults[d.key].elec_kwh_sofar = u.elec_kwh;
        dcResults[d.key].gas_used_sofar = u.gas_used;
        done();
      });
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
        json(res, row || {});
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
        json(res, rows || []);
      }
    );
    return true;
  }

  return false;
};

var db = require("../db/setup");
var prices = require("../services/prices");
var time = require("../utils/time");
var modules = require("../services/modules");

function json(res, data) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function nowAms() {
  return new Date().toLocaleString("sv-SE", { timeZone: "Europe/Amsterdam" });
}

// Verbruik en kosten per kalenderdag vanaf `since`, plus de losse uren: cb(days, hours).
// Stroom wordt per uur gerekend met de prijs van dat uur, gas per dag met de prijs van die dag.
// Voor uren zonder bewaarde prijs geldt de huidige prijs.
function usageSince(since, cb) {
  var floor = time.dataFloor();
  if (floor > since) since = floor;

  prices.fetchPrices(function(err, cur) {
    cur = cur || {};
    var ep = cur.electricity_eur_kwh != null ? cur.electricity_eur_kwh : null;
    var gp = cur.gas_eur_m3 != null ? cur.gas_eur_m3 : null;
    prices.priceMaps(since.slice(0, 10), function(maps) {
      db.all(
        "SELECT strftime('%Y-%m-%d %H', received_at) as h, AVG(power_delivered_total_kw) as avg_kw, COUNT(*) as n," +
        " AVG(power_delivered_l1_kw) as l1, AVG(power_delivered_l2_kw) as l2, AVG(power_delivered_l3_kw) as l3" +
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
              var out = {}, hours = [];
              function day(d) {
                if (!out[d]) out[d] = { day: d, elec_kwh: null, elec_cost: null, gas_m3: null, gas_cost: null };
                return out[d];
              }
              (hourRows || []).forEach(function(r) {
                if (r.avg_kw == null) return;
                var frac = r.h === curHour ? curFrac : 1;
                var kwh = r.avg_kw * frac;
                var price = maps.elec[r.h] != null ? maps.elec[r.h] : ep;
                var d = day(r.h.slice(0, 10));
                d.elec_kwh = (d.elec_kwh || 0) + kwh;
                if (price != null) d.elec_cost = (d.elec_cost || 0) + kwh * price;
                hours.push({ h: r.h, frac: frac, kwh: kwh, price: price, l1: (r.l1 || 0) * frac, l2: (r.l2 || 0) * frac, l3: (r.l3 || 0) * frac });
              });
              (gasRows || []).forEach(function(r) {
                if (r.gas_used == null) return;
                var price = maps.gas[r.day] != null ? maps.gas[r.day] : gp;
                var d = day(r.day);
                d.gas_m3 = r.gas_used;
                d.gas_cost = price != null ? r.gas_used * price : null;
              });
              cb(Object.keys(out).sort().map(function(k) { return out[k]; }), hours);
            }
          );
        }
      );
    });
  });
}

// Zelfde, over de laatste `days` dagen (vandaag meegeteld)
function dailyCosts(days, cb) {
  usageSince(time.dateAms(-(days - 1) * 86400000) + "T00:00:00", function(rows) { cb(rows); });
}

function dayTotal(d) {
  return (d.elec_cost || 0) + (d.gas_cost || 0);
}

// Alles voor de Kosten-pagina: maandtotalen, prognoses en waar het geld naartoe gaat.
// De verdeling (fasen, dagdelen, sluipverbruik) gaat over de laatste 30 dagen.
function costsOverview(cb) {
  var today = time.todayAms();
  var year = parseInt(today.slice(0, 4), 10), month = parseInt(today.slice(5, 7), 10);
  // elf maanden terug, vanaf de eerste van die maand
  var start = new Date(Date.UTC(year, month - 12, 1)).toISOString().slice(0, 10);
  var recentStart = time.dateAms(-29 * 86400000);

  usageSince(start + "T00:00:00", function(days, hours) {
    // staat de gasmodule uit, dan telt gas nergens mee
    if (!modules.isOn("gas")) days.forEach(function(d) { d.gas_m3 = null; d.gas_cost = null; });
    db.get(
      "SELECT AVG(power_delivered_total_kw) as night_avg FROM readings" +
      " WHERE strftime('%H', received_at) BETWEEN '00' AND '05'" +
      " AND received_at >= ? AND power_delivered_total_kw IS NOT NULL",
      [time.effectiveCutoff(604800000)],
      function(err, night) {
        var base = night && night.night_avg != null ? night.night_avg : null;

        var byMonth = {};
        days.forEach(function(d) {
          var m = d.day.slice(0, 7);
          if (!byMonth[m]) byMonth[m] = [];
          byMonth[m].push(d);
        });
        var months = Object.keys(byMonth).sort().map(function(m) {
          var t = sumDays(byMonth[m]);
          t.month = m; t.days = byMonth[m].length; t.first_day = byMonth[m][0].day;
          return t;
        });

        // Prognose: gemiddelde van de volledige dagen uit de laatste 30
        var recent = days.filter(function(d) { return d.day >= recentStart; });
        var full = recent.filter(function(d) { return d.day < today; });
        var cur = days.filter(function(d) { return d.day === today; })[0];
        var monthDays = byMonth[today.slice(0, 7)] || [];
        var monthSum = sumDays(monthDays);
        var daysInMonth = new Date(year, month, 0).getDate();
        var daysAfterToday = daysInMonth - parseInt(today.slice(8, 10), 10);
        var avg = null, forecastMonth = null;
        if (full.length) {
          var ft = sumDays(full);
          avg = { elec: (ft.elec_cost || 0) / full.length, gas: (ft.gas_cost || 0) / full.length, days: full.length };
          avg.total = avg.elec + avg.gas;
          var monthFull = monthDays.filter(function(d) { return d.day < today; }).reduce(function(t, d) { return t + dayTotal(d); }, 0);
          // vandaag telt als een gemiddelde dag zolang hij daar nog onder zit
          forecastMonth = monthFull + Math.max(cur ? dayTotal(cur) : 0, avg.total) + avg.total * daysAfterToday;
        }
        var priciest = full.slice().sort(function(a, b) { return dayTotal(b) - dayTotal(a); })[0];

        // Waar gaat de stroom heen
        var parts = [["Nacht", 0, 6], ["Ochtend", 6, 12], ["Middag", 12, 18], ["Avond", 18, 24]].map(function(p) {
          return { label: p[0], from: p[1], to: p[2], kwh: 0, cost: 0 };
        });
        var phases = [1, 2, 3].map(function(i) { return { label: "L" + i, kwh: 0, cost: 0 }; });
        var standby = { kwh: 0, cost: 0 }, kwhPriced = 0, costPriced = 0, priceSum = 0, priceN = 0, hoursN = 0;
        hours.forEach(function(x) {
          if (x.h.slice(0, 10) < recentStart) return;
          hoursN += x.frac;
          var hr = parseInt(x.h.slice(11), 10);
          var part = parts.filter(function(p) { return hr >= p.from && hr < p.to; })[0];
          var sb = base != null ? Math.min(x.kwh, base * x.frac) : 0;
          part.kwh += x.kwh;
          standby.kwh += sb;
          phases.forEach(function(p, i) { p.kwh += x["l" + (i + 1)]; });
          if (x.price == null) return;
          part.cost += x.kwh * x.price;
          standby.cost += sb * x.price;
          phases.forEach(function(p, i) { p.cost += x["l" + (i + 1)] * x.price; });
          kwhPriced += x.kwh; costPriced += x.kwh * x.price; priceSum += x.price; priceN++;
        });
        var rt = sumDays(recent);

        // Sluipverbruik per nacht (00–06 uur), laatste 14 nachten
        var nightStart = time.dateAms(-13 * 86400000), byNight = {};
        hours.forEach(function(x) {
          var d = x.h.slice(0, 10);
          if (d < nightStart || parseInt(x.h.slice(11), 10) >= 6) return;
          if (!byNight[d]) byNight[d] = { day: d, kwh: 0, hours: 0, cost: null };
          byNight[d].kwh += x.kwh; byNight[d].hours += x.frac;
          if (x.price != null) byNight[d].cost = (byNight[d].cost || 0) + x.kwh * x.price;
        });
        var nights = Object.keys(byNight).sort().map(function(d) {
          var n = byNight[d];
          return { day: d, kw: n.hours > 0 ? n.kwh / n.hours : null, kwh: n.kwh, cost: n.cost };
        });

        cb({
          today: today,
          months: months,
          month: { total: (monthSum.elec_cost || 0) + (monthSum.gas_cost || 0), elec: monthSum.elec_cost, gas: monthSum.gas_cost, days_in_month: daysInMonth },
          avg_day: avg,
          forecast_month: forecastMonth,
          forecast_year: avg ? avg.total * 365 : null,
          priciest_day: priciest ? { day: priciest.day, cost: dayTotal(priciest) } : null,
          recent: {
            days: recent.length, elec_kwh: rt.elec_kwh, elec_cost: rt.elec_cost, gas_m3: rt.gas_m3, gas_cost: rt.gas_cost,
            parts: parts, phases: phases, nights: nights,
            // gemeten uren omgerekend naar een heel jaar
            standby: base != null ? { kw: base, kwh: standby.kwh, cost: standby.cost, cost_year: hoursN > 0 ? standby.cost / hoursN * 8760 : null } : null,
            paid_per_kwh: kwhPriced > 0 ? costPriced / kwhPriced : null,
            avg_price: priceN ? priceSum / priceN : null
          }
        });
      }
    );
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

// Het overzicht leest een jaar aan metingen; de flows vragen het elke halve minuut, dus hooguit eens per kwartier vers
var overviewCache = { data: null, at: 0, waiting: null };
function cachedOverview(cb) {
  if (overviewCache.data && Date.now() - overviewCache.at < 15 * 60 * 1000) return cb(overviewCache.data);
  if (overviewCache.waiting) return overviewCache.waiting.push(cb);
  overviewCache.waiting = [cb];
  costsOverview(function(o) {
    var waiting = overviewCache.waiting;
    overviewCache = { data: o, at: Date.now(), waiting: null };
    waiting.forEach(function(w) { w(o); });
  });
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

  if (req.method === "GET" && req.url === "/api/costs-overview") {
    costsOverview(function(o) { json(res, o); });
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

module.exports.overview = cachedOverview;

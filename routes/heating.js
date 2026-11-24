var db = require("../db/setup");
var time = require("../utils/time");
var tado = require("../services/tado");
var weather = require("../services/weather");

// Stookefficiëntie op huisniveau. De ketel stuurt op de thermostaat in de woonkamer (de referentiekamer),
// dus we zetten het gasverbruik af tegen de warmtevraag van die kamer, gecorrigeerd voor de buitentemperatuur.
//
// Per dag:
//   gas        = gasverbruik (m³) uit de P1-meter (MAX-MIN van de meterstand die dag)
//   out_temp   = dag-gemiddelde buitentemperatuur (Open-Meteo)
//   set_avg    = gemiddelde gewenste woonkamertemperatuur (setpoint)
//   in_temp    = gemiddelde gemeten woonkamertemperatuur
//   heat_pct   = gemiddeld stookpercentage van de woonkamer
//   hdd        = graaddagen = max(0, set_avg - out_temp)  → hoeveel de kamer boven buiten gehouden moest worden
//   m3_per_hdd = gas / hdd  → de efficiëntie: m³ per graad-dag. Koude dagen vallen hier tegen elkaar weg,
//                             dus een oplopende waarde betekent écht minder efficiënt stoken (niet "koudere dag").
//
// Let op (v1, af te stellen met echte data): set_avg/in_temp/heat_pct zijn een gemiddelde over ongelijk
// verdeelde metingen (elke ~15 s tijdens stoken, ~30 min als het stil is), dus licht gewogen naar stookperiodes.

module.exports = function(req, res) {
  if (req.method === "GET" && req.url.indexOf("/api/heating/efficiency") === 0) {
    var days = 30;
    var qs = req.url.indexOf("?days=");
    if (qs !== -1) days = parseInt(req.url.slice(qs + 6).split("&")[0], 10) || 30;
    if (days < 1) days = 1;
    if (days > 90) days = 90;

    var room = tado.getHeatingReferenceRoom();
    var since = time.effectiveCutoff(days * 86400000);

    function fail() { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ room: room, days: [] })); }

    db.all(
      "SELECT date(received_at) as day, MAX(gas_m3) - MIN(gas_m3) as gas" +
      " FROM readings WHERE gas_m3 IS NOT NULL AND received_at >= ?" +
      " GROUP BY day",
      [since],
      function(err, gasRows) {
        if (err) return fail();
        db.all(
          "SELECT date(received_at) as day, AVG(setpoint_c) as set_avg, AVG(temp_c) as in_temp, AVG(heating_power) as heat_pct" +
          " FROM heating_readings WHERE room = ? AND received_at >= ?" +
          " GROUP BY day",
          [room, since],
          function(err2, heatRows) {
            if (err2) return fail();
            weather.fetchDailyMeanTemps(function(err3, tempMap) {
              tempMap = tempMap || {};
              var byDay = {};
              function row(d) { if (!byDay[d]) byDay[d] = { day: d, gas: null, out_temp: null, set_avg: null, in_temp: null, heat_pct: null, hdd: null, m3_per_hdd: null }; return byDay[d]; }

              (gasRows || []).forEach(function(r) { row(r.day).gas = r.gas != null ? Math.round(r.gas * 1000) / 1000 : null; });
              (heatRows || []).forEach(function(r) {
                var x = row(r.day);
                x.set_avg = r.set_avg != null ? Math.round(r.set_avg * 10) / 10 : null;
                x.in_temp = r.in_temp != null ? Math.round(r.in_temp * 10) / 10 : null;
                x.heat_pct = r.heat_pct != null ? Math.round(r.heat_pct) : null;
              });

              var out = Object.keys(byDay).sort().map(function(d) {
                var x = byDay[d];
                if (tempMap[d] != null) x.out_temp = Math.round(tempMap[d] * 10) / 10;
                if (x.set_avg != null && x.out_temp != null) x.hdd = Math.round(Math.max(0, x.set_avg - x.out_temp) * 10) / 10;
                // bij een te kleine kloof is gas/hdd onbetrouwbaar (grote uitschieters), dus pas vanaf ~1 graaddag
                if (x.hdd != null && x.hdd >= 1 && x.gas != null) x.m3_per_hdd = Math.round((x.gas / x.hdd) * 1000) / 1000;
                return x;
              });

              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ room: room, days: out }));
            });
          }
        );
      }
    );
    return true;
  }

  // Referentiekamer instellen (de kamer waar de thermostaat hangt): { room }
  if (req.method === "POST" && req.url === "/api/heating/reference-room") {
    var body = "";
    req.on("data", function(c) { body += c; });
    req.on("end", function() {
      var data;
      try { data = JSON.parse(body); } catch (e) { data = null; }
      var ok = data && tado.setHeatingReferenceRoom(data.room);
      res.writeHead(ok ? 200 : 400, { "Content-Type": "application/json" });
      res.end(JSON.stringify(ok ? { ok: true, room: tado.getHeatingReferenceRoom() } : { ok: false, error: "Ongeldige kamernaam" }));
    });
    return true;
  }

  return false;
};

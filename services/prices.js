var https = require("https");
var db = require("../db/setup");
var time = require("../utils/time");

// Uurprijzen worden bewaard, zodat kosten over eerdere dagen met de prijs van dat uur gerekend worden.
// hour = lokale tijd "YYYY-MM-DD HH"
db.run("CREATE TABLE IF NOT EXISTS price_hours (hour TEXT PRIMARY KEY, elec REAL, gas REAL)");

var dayCache = { date: null, hours: [], fetchedAt: 0 };

function total(p) {
  return p.marketPrice + p.marketPriceTax + p.sourcingMarkupPrice + p.energyTaxPrice;
}

function localHour(iso) {
  return new Date(iso).toLocaleString("sv-SE", { timeZone: "Europe/Amsterdam" }).slice(0, 13);
}

function nowHour() {
  return new Date().toLocaleString("sv-SE", { timeZone: "Europe/Amsterdam" }).slice(0, 13);
}

// Haalt alle uurprijzen van één dag op bij Frank Energie: [{ hour, elec, gas }]
function fetchDay(date, callback) {
  var body = JSON.stringify({
    query: '{ marketPrices(date: "' + date + '") {' +
      ' electricityPrices { from marketPrice marketPriceTax sourcingMarkupPrice energyTaxPrice }' +
      ' gasPrices { from marketPrice marketPriceTax sourcingMarkupPrice energyTaxPrice }' +
    ' } }'
  });

  var options = {
    hostname: "frank-graphql-prod.graphcdn.app",
    path: "/",
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
  };

  var req = https.request(options, function(res) {
    var chunks = "";
    res.on("data", function(c) { chunks += c; });
    res.on("end", function() {
      try {
        var mp = JSON.parse(chunks).data.marketPrices;
        var byHour = {};
        mp.electricityPrices.forEach(function(p) {
          if (p.from) byHour[localHour(p.from)] = { hour: localHour(p.from), elec: total(p), gas: null };
        });
        mp.gasPrices.forEach(function(p) {
          if (!p.from) return;
          var h = localHour(p.from);
          if (!byHour[h]) byHour[h] = { hour: h, elec: null, gas: null };
          byHour[h].gas = total(p);
        });
        var hours = Object.keys(byHour).sort().map(function(h) { return byHour[h]; });
        if (!hours.length) return callback(new Error("geen prijzen"));
        var stmt = db.prepare("INSERT OR REPLACE INTO price_hours (hour, elec, gas) VALUES (?,?,?)");
        hours.forEach(function(h) { stmt.run([h.hour, h.elec, h.gas]); });
        stmt.finalize();
        callback(null, hours);
      } catch (e) {
        callback(e);
      }
    });
  });
  req.on("error", callback);
  req.write(body);
  req.end();
}

function fetchPrices(callback) {
  var today = time.todayAms();

  function result() {
    var hours = dayCache.hours;
    var now = nowHour();
    var cur = hours.filter(function(h) { return h.hour === now; })[0];
    // Fallback: laatste bekende uur
    var withElec = hours.filter(function(h) { return h.elec != null; });
    var withGas  = hours.filter(function(h) { return h.gas != null; });
    return {
      electricity_eur_kwh: cur && cur.elec != null ? cur.elec : (withElec.length ? withElec[withElec.length - 1].elec : null),
      gas_eur_m3: cur && cur.gas != null ? cur.gas : (withGas.length ? withGas[withGas.length - 1].gas : null),
      electricity_label: "current hour (day-ahead)", gas_label: "today (daily)",
      hours: hours
    };
  }

  if (dayCache.date === today && Date.now() - dayCache.fetchedAt < 3600000) {
    return callback(null, result());
  }
  fetchDay(today, function(err, hours) {
    if (err) return callback(err);
    dayCache = { date: today, hours: hours, fetchedAt: Date.now() };
    callback(null, result());
  });
}

// Stroomprijs per uur voor vandaag en, zodra bekend (rond 13:00), morgen: { "YYYY-MM-DD HH": prijs }
var tomorrowCache = { date: null, hours: [], triedAt: 0 };
function upcoming(callback) {
  fetchPrices(function(err, p) {
    var map = {};
    ((p && p.hours) || []).forEach(function(h) { if (h.elec != null) map[h.hour] = h.elec; });
    var tomorrow = time.dateAms(86400000);
    function done() {
      tomorrowCache.hours.forEach(function(h) { if (h.elec != null) map[h.hour] = h.elec; });
      callback(map);
    }
    if (tomorrowCache.date === tomorrow && (tomorrowCache.hours.length || Date.now() - tomorrowCache.triedAt < 30 * 60 * 1000)) return done();
    if (parseInt(nowHour().slice(11), 10) < 13) return callback(map);
    tomorrowCache = { date: tomorrow, hours: [], triedAt: Date.now() };
    fetchDay(tomorrow, function(e, hours) {
      if (!e && hours) tomorrowCache.hours = hours.filter(function(h) { return h.hour.slice(0, 10) === tomorrow; });
      done();
    });
  });
}

// Bewaarde prijzen vanaf een dag: { elec: { "YYYY-MM-DD HH": prijs }, gas: { "YYYY-MM-DD": prijs } }
// De gasprijs van een dag is die van 12:00 (de gasdag wisselt om 06:00).
function priceMaps(sinceDay, callback) {
  db.all("SELECT hour, elec, gas FROM price_hours WHERE hour >= ?", [sinceDay + " 00"], function(err, rows) {
    var maps = { elec: {}, gas: {} };
    (rows || []).forEach(function(r) {
      if (r.elec != null) maps.elec[r.hour] = r.elec;
      if (r.gas != null && (r.hour.slice(11) === "12" || maps.gas[r.hour.slice(0, 10)] == null)) maps.gas[r.hour.slice(0, 10)] = r.gas;
    });
    callback(maps);
  });
}

// Vult ontbrekende dagen uit de afgelopen maand aan, één dag per halve seconde.
function backfill() {
  var floor = time.dataFloor().slice(0, 10);
  var days = [];
  for (var i = 1; i <= 31; i++) {
    var d = time.dateAms(-i * 86400000);
    if (d >= floor) days.push(d);
  }
  db.all("SELECT DISTINCT substr(hour, 1, 10) as day FROM price_hours", function(err, rows) {
    var have = {};
    (rows || []).forEach(function(r) { have[r.day] = true; });
    var missing = days.filter(function(d) { return !have[d]; });
    (function next() {
      var d = missing.shift();
      if (!d) return;
      fetchDay(d, function() { setTimeout(next, 500); });
    })();
  });
}

module.exports = {
  fetchPrices: fetchPrices,
  priceMaps: priceMaps,
  upcoming: upcoming,
  backfill: backfill,
  get priceCache() { return { data: dayCache.hours.length ? dayCache : null, fetchedAt: dayCache.fetchedAt }; }
};

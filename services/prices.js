var https = require("https");
var db = require("../db/setup");
var time = require("../utils/time");
var auth = require("./auth");

// Vast tarief: wie een vast energiecontract heeft, rekent kosten met de eigen contractprijs i.p.v. de
// dynamische day-ahead-prijzen. Staat het aan, dan leveren fetchPrices/priceMaps overal het vaste tarief,
// zodat de kosten niet van de marktprijs (of van Frank Energie's beschikbaarheid) afhangen.
function fixedTariffs() {
  var t = auth.readConfig().tariffs;
  if (t && t.fixed && t.elec_kwh > 0 && t.gas_m3 > 0) return { elec: t.elec_kwh, gas: t.gas_m3 };
  return null;
}
function getTariffs() {
  var t = auth.readConfig().tariffs || {};
  return { fixed: !!t.fixed, elec_kwh: t.elec_kwh != null ? t.elec_kwh : null, gas_m3: t.gas_m3 != null ? t.gas_m3 : null };
}
function setTariffs(obj) {
  if (!obj) return false;
  var cfg = auth.readConfig();
  if (!cfg.tariffs) cfg.tariffs = {};
  if (obj.fixed) {
    // komma of punt als decimaalteken toestaan
    var elec = Number(String(obj.elec_kwh).replace(",", ".")), gas = Number(String(obj.gas_m3).replace(",", "."));
    if (!(elec > 0 && elec < 5) || !(gas > 0 && gas < 10)) return false;
    cfg.tariffs = { fixed: true, elec_kwh: Math.round(elec * 10000) / 10000, gas_m3: Math.round(gas * 10000) / 10000 };
  } else {
    cfg.tariffs.fixed = false;
  }
  auth.writeConfig(cfg);
  dayCache.fetchedAt = 0; // forceer een verse prijsberekening
  return true;
}

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
    var fixed = fixedTariffs();
    var hours = dayCache.hours;
    var now = nowHour();
    var cur = hours.filter(function(h) { return h.hour === now; })[0];
    // Fallback: laatste bekende uur
    var withElec = hours.filter(function(h) { return h.elec != null; });
    var withGas  = hours.filter(function(h) { return h.gas != null; });
    return {
      electricity_eur_kwh: fixed ? fixed.elec : (cur && cur.elec != null ? cur.elec : (withElec.length ? withElec[withElec.length - 1].elec : null)),
      gas_eur_m3: fixed ? fixed.gas : (cur && cur.gas != null ? cur.gas : (withGas.length ? withGas[withGas.length - 1].gas : null)),
      electricity_label: fixed ? "vast tarief" : "current hour (day-ahead)", gas_label: fixed ? "vast tarief" : "today (daily)",
      fixed: !!fixed,
      hours: hours
    };
  }

  if (dayCache.date === today && Date.now() - dayCache.fetchedAt < 3600000) {
    return callback(null, result());
  }
  fetchDay(today, function(err, hours) {
    // op een vast tarief draaien de kosten op de contractprijs; een mislukte marktophaal mag ze niet blokkeren
    if (err) return fixedTariffs() ? callback(null, result()) : callback(err);
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
  // Vast tarief: geen bewaarde uurprijzen teruggeven, zodat de kosten overal op de vaste prijs (de fallback
  // electricity_eur_kwh/gas_eur_m3 uit fetchPrices) uitkomen i.p.v. op de marktprijs van dat uur/die dag.
  if (fixedTariffs()) return callback({ elec: {}, gas: {} });
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
  getTariffs: getTariffs,
  setTariffs: setTariffs,
  get priceCache() { return { data: dayCache.hours.length ? dayCache : null, fetchedAt: dayCache.fetchedAt }; }
};

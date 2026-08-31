/*
 * Simple local server for the GoonESP32-P1meter dongle.
 *
 * Receives JSON P1 readings via HTTP POST and stores them in SQLite.
 * Visit http://localhost:5000 for a live dashboard.
 *
 * Run with:
 *     npm install
 *     node app.js
 *
 * The ESP32 sketch expects this reachable at:
 *     http://192.168.178.10:5000/api/p1data
 */

var http = require("http");
var https = require("https");
var path = require("path");
var fs = require("fs");
var os = require("os");
var sqlite3 = require("sqlite3");

function getLocalIP() {
  var ifaces = os.networkInterfaces();
  for (var name of Object.keys(ifaces)) {
    for (var iface of ifaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return "localhost";
}
var LOCAL_IP = getLocalIP();
var WAN_IP = "ophalen…";

var DISCORD_WEBHOOK = "https://discord.com/api/webhooks/1542267218073616445/Q5m05IVLBKR5Au5CGnY54Rp-9NeHW5qyBZ6-QWLzYK6bEr8EA1aYDai14L363aljodxR";

function sendDiscord(message) {
  var body = JSON.stringify({ content: message });
  var url = new URL(DISCORD_WEBHOOK);
  var options = {
    hostname: url.hostname,
    path: url.pathname,
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
  };
  var req = https.request(options, function(res) { res.resume(); });
  req.on("error", function() {});
  req.write(body);
  req.end();
}

function fetchWanIP(callback) {
  https.get("https://api.ipify.org", function(res) {
    var data = "";
    res.on("data", function(c) { data += c; });
    res.on("end", function() { callback(null, data.trim()); });
  }).on("error", function(e) { callback(e); });
}

fetchWanIP(function(err, ip) {
  if (err) { WAN_IP = "onbekend"; return; }
  WAN_IP = ip;
  sendDiscord("✅ **VloedHub gestart** — WAN IP: http://" + WAN_IP + ":5000");
});

setInterval(function() {
  fetchWanIP(function(err, ip) {
    if (err || !ip) return;
    if (ip !== WAN_IP) {
      var old = WAN_IP;
      WAN_IP = ip;
      sendDiscord("⚠️ **WAN IP gewijzigd**\n~~`" + old + "`~~ → http://" + WAN_IP + ":5000");
    }
  });
}, 5 * 60 * 1000);

var priceCache = { data: null, fetchedAt: 0 };

var WEATHER_LAT = 51.57632;
var WEATHER_LON = 4.73906;
var WEATHER_LOCATION = "Princenhage, Breda";

var WEATHER_CODES = {
  0: ["Helder", "sun"], 1: ["Overwegend helder", "cloud-sun"], 2: ["Half bewolkt", "cloud-sun"], 3: ["Bewolkt", "cloud"],
  45: ["Mist", "smog"], 48: ["Mist", "smog"],
  51: ["Motregen", "cloud-rain"], 53: ["Motregen", "cloud-rain"], 55: ["Motregen", "cloud-rain"],
  56: ["IJzel", "icicles"], 57: ["IJzel", "icicles"],
  61: ["Regen", "cloud-rain"], 63: ["Regen", "cloud-rain"], 65: ["Zware regen", "cloud-showers-heavy"],
  66: ["IJzel", "icicles"], 67: ["IJzel", "icicles"],
  71: ["Sneeuw", "snowflake"], 73: ["Sneeuw", "snowflake"], 75: ["Zware sneeuw", "snowflake"],
  77: ["Sneeuwkorrels", "snowflake"],
  80: ["Buien", "cloud-rain"], 81: ["Buien", "cloud-rain"], 82: ["Zware buien", "cloud-showers-heavy"],
  85: ["Sneeuwbuien", "snowflake"], 86: ["Sneeuwbuien", "snowflake"],
  95: ["Onweer", "cloud-bolt"], 96: ["Onweer met hagel", "cloud-bolt"], 99: ["Onweer met hagel", "cloud-bolt"]
};

var weatherCache = { data: null, fetchedAt: 0 };

function fetchWeather(callback) {
  var now = Date.now();
  if (weatherCache.data && now - weatherCache.fetchedAt < 900000) {
    return callback(null, weatherCache.data);
  }

  var url = "https://api.open-meteo.com/v1/forecast?latitude=" + WEATHER_LAT +
    "&longitude=" + WEATHER_LON +
    "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m" +
    "&hourly=precipitation_probability&timezone=Europe%2FAmsterdam&forecast_days=1";

  https.get(url, function(res) {
    var chunks = "";
    res.on("data", function(c) { chunks += c; });
    res.on("end", function() {
      try {
        var json = JSON.parse(chunks);
        var cur = json.current;
        var code = WEATHER_CODES[cur.weather_code] || ["Onbekend", "question"];
        var precip = null;
        if (json.hourly && json.hourly.time) {
          var idx = json.hourly.time.indexOf(cur.time);
          if (idx !== -1) precip = json.hourly.precipitation_probability[idx];
        }
        var result = {
          temp: cur.temperature_2m,
          feels_like: cur.apparent_temperature,
          humidity: cur.relative_humidity_2m,
          wind_speed: cur.wind_speed_10m,
          precipitation_probability: precip,
          condition: code[0],
          icon: code[1],
          location: WEATHER_LOCATION
        };
        weatherCache = { data: result, fetchedAt: now };
        callback(null, result);
      } catch (e) {
        callback(e);
      }
    });
  }).on("error", callback);
}

function fetchPrices(callback) {
  var now = Date.now();
  if (priceCache.data && now - priceCache.fetchedAt < 3600000) {
    return callback(null, priceCache.data);
  }

  var today = new Date().toISOString().slice(0, 10);
  var body = JSON.stringify({
    query: '{ marketPrices(date: "' + today + '") {' +
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
        var json = JSON.parse(chunks);
        var mp = json.data.marketPrices;

        // Current hour in UTC to match Frank's timestamps
        var nowHour = new Date().toISOString().slice(0, 13);
        var elec = null;
        mp.electricityPrices.forEach(function(p) {
          if (p.from && p.from.slice(0, 13) === nowHour) {
            elec = p.marketPrice + p.marketPriceTax + p.sourcingMarkupPrice + p.energyTaxPrice;
          }
        });
        // Fallback: most recent electricity price
        if (elec === null && mp.electricityPrices.length > 0) {
          var last = mp.electricityPrices[mp.electricityPrices.length - 1];
          elec = last.marketPrice + last.marketPriceTax + last.sourcingMarkupPrice + last.energyTaxPrice;
        }

        var gas = null;
        if (mp.gasPrices.length > 0) {
          var gp = mp.gasPrices[0];
          gas = gp.marketPrice + gp.marketPriceTax + gp.sourcingMarkupPrice + gp.energyTaxPrice;
        }

        var result = { electricity_eur_kwh: elec, gas_eur_m3: gas,
          electricity_label: "current hour (day-ahead)", gas_label: "today (daily)" };
        priceCache = { data: result, fetchedAt: now };
        callback(null, result);
      } catch (e) {
        callback(e);
      }
    });
  });
  req.on("error", callback);
  req.write(body);
  req.end();
}

var PORT = 5000;
var db = new sqlite3.Database(path.join(__dirname, "p1_data.db"));

db.serialize(function() {
  db.run(
    "CREATE TABLE IF NOT EXISTS readings (" +
    "  id INTEGER PRIMARY KEY AUTOINCREMENT," +
    "  received_at TEXT NOT NULL," +
    "  device TEXT," +
    "  voltage_l1 REAL, voltage_l2 REAL, voltage_l3 REAL," +
    "  current_l1 REAL, current_l2 REAL, current_l3 REAL," +
    "  power_delivered_l1_kw REAL, power_delivered_l2_kw REAL, power_delivered_l3_kw REAL," +
    "  power_returned_l1_kw REAL, power_returned_l2_kw REAL, power_returned_l3_kw REAL," +
    "  power_delivered_total_kw REAL," +
    "  power_returned_total_kw REAL," +
    "  gas_m3 REAL," +
    "  raw TEXT NOT NULL" +
    ")"
  );

  // Migrate UTC timestamps to local time (Europe/Amsterdam = UTC+1/+2)
  // Only runs once: skips rows that are already in local time (no trailing Z, not starting with UTC offset)
  db.run(
    "UPDATE readings SET received_at = datetime(received_at, '+2 hours')" +
    " WHERE received_at LIKE '%Z' OR received_at LIKE '%+00:00'"
  );

  // Migrate older single-column schema if needed
  var oldCols = ["voltage_l1","voltage_l2","voltage_l3","current_l1","current_l2","current_l3",
    "power_delivered_l1_kw","power_delivered_l2_kw","power_delivered_l3_kw",
    "power_returned_l1_kw","power_returned_l2_kw","power_returned_l3_kw",
    "power_delivered_total_kw","power_returned_total_kw"];
  oldCols.forEach(function(col) {
    db.run("ALTER TABLE readings ADD COLUMN " + col + " REAL", function() {});
  });

  db.run(
    "CREATE TABLE IF NOT EXISTS wasmachine_cycles (" +
    "  id INTEGER PRIMARY KEY AUTOINCREMENT," +
    "  finished_at TEXT NOT NULL," +
    "  device TEXT" +
    ")"
  );

  db.run(
    "CREATE TABLE IF NOT EXISTS wasmachine_status (" +
    "  id INTEGER PRIMARY KEY CHECK (id = 1)," +
    "  state TEXT NOT NULL," +
    "  since TEXT NOT NULL," +
    "  device TEXT" +
    ")"
  );
});

function setWashStatus(state, device, callback) {
  var since = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Amsterdam' }).replace(' ', 'T');
  db.run(
    "INSERT INTO wasmachine_status (id, state, since, device) VALUES (1, ?, ?, ?)" +
    " ON CONFLICT(id) DO UPDATE SET state = excluded.state, since = excluded.since, device = excluded.device",
    [state, since, device || null],
    function(err) {
      if (callback) callback(err, since);
    }
  );
}

function logReading(data, callback) {
  var received_at = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Amsterdam' }).replace(' ', 'T');
  var n = function(v) { return v != null ? v : null; };

  db.run(
    "INSERT INTO readings (" +
    "  received_at, device," +
    "  voltage_l1, voltage_l2, voltage_l3," +
    "  current_l1, current_l2, current_l3," +
    "  power_delivered_l1_kw, power_delivered_l2_kw, power_delivered_l3_kw," +
    "  power_returned_l1_kw, power_returned_l2_kw, power_returned_l3_kw," +
    "  power_delivered_total_kw, power_returned_total_kw," +
    "  gas_m3, raw" +
    ") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [
      received_at,
      n(data.device),
      n(data.voltage_l1), n(data.voltage_l2), n(data.voltage_l3),
      n(data.current_l1), n(data.current_l2), n(data.current_l3),
      n(data.power_delivered_l1_kw), n(data.power_delivered_l2_kw), n(data.power_delivered_l3_kw),
      n(data.power_returned_l1_kw), n(data.power_returned_l2_kw), n(data.power_returned_l3_kw),
      n(data.power_delivered_total_kw), n(data.power_returned_total_kw),
      n(data.gas_m3),
      JSON.stringify(data)
    ],
    function(err) {
      if (err) return callback(err);
      console.log(
        "[" + received_at + "] " + (data.device || "unknown") + " - " +
        "delivered=" + data.power_delivered_total_kw + "kW " +
        "returned=" + data.power_returned_total_kw + "kW " +
        "gas=" + data.gas_m3 + "m3"
      );
      callback(null);
    }
  );
}

function logWashCycle(data, callback) {
  var finished_at = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Amsterdam' }).replace(' ', 'T');
  db.run(
    "INSERT INTO wasmachine_cycles (finished_at, device) VALUES (?,?)",
    [finished_at, data.device || null],
    function(err) {
      if (err) return callback(err);
      console.log("[" + finished_at + "] Wasmachine klaar (" + (data.device || "unknown") + ")");
      callback(null, finished_at);
    }
  );
}

// Returns a naive Amsterdam-local datetime string (matches how received_at is stored)
function cutoff(ms) {
  return new Date(Date.now() - ms).toLocaleString('sv-SE', { timeZone: 'Europe/Amsterdam' }).replace(' ', 'T');
}
function todayAms() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Amsterdam' }).slice(0, 10);
}
function dateAms(offsetMs) {
  return new Date(Date.now() + offsetMs).toLocaleString('sv-SE', { timeZone: 'Europe/Amsterdam' }).slice(0, 10);
}

// Data completeness cutoff: data before this date was only logged when the app was running
var includeOldData = false;
var DATA_CUTOFF = '2026-08-27T00:00:00';

// Returns the later of (now - ms) or DATA_CUTOFF, unless old data is included
function effectiveCutoff(ms) {
  var rel = cutoff(ms);
  if (includeOldData) return rel;
  return rel > DATA_CUTOFF ? rel : DATA_CUTOFF;
}
// Absolute floor for all-time queries
function dataFloor() {
  return includeOldData ? '2000-01-01T00:00:00' : DATA_CUTOFF;
}

var HTML = "<!DOCTYPE html>\n<html lang='nl'>\n<head>\n<meta charset='UTF-8'>\n<meta name='viewport' content='width=device-width,initial-scale=1,viewport-fit=cover'>\n<meta name='apple-mobile-web-app-capable' content='yes'>\n<meta name='apple-mobile-web-app-status-bar-style' content='black-translucent'>\n<title>VloedHub</title>\n<link rel='stylesheet' href='https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css'>\n<link rel='preconnect' href='https://fonts.googleapis.com'>\n<link rel='preconnect' href='https://fonts.gstatic.com' crossorigin>\n<link href='https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap' rel='stylesheet'>\n<style>\n:root{--bg:#0C0F1D;--surface:#141728;--border:rgba(255,255,255,0.06);--text:#F1F5F9;--muted:#4A5880;--dim:#3D4D6A;--purple:#A855F7;--pl:#C084FC;--green:#22C55E;--orange:#F97316;--blue:#38BDF8;--yellow:#FBBF24;--red:#F87171;--nav-h:64px;--header-h:52px}\n*{box-sizing:border-box;margin:0;padding:0}\nhtml,body{height:100%}\nbody{font-family:'Poppins',system-ui,sans-serif;background:var(--bg);color:var(--text);height:100vh;display:flex;flex-direction:column;overflow:hidden}\n.app-header{height:var(--header-h);flex-shrink:0;display:flex;align-items:center;justify-content:space-between;padding:0 1rem;background:rgba(12,15,29,0.97);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid var(--border);z-index:10}\n.app-title{display:flex;align-items:center;gap:0.5rem;font-size:1.05rem;font-weight:700;letter-spacing:-0.01em}\n.header-right{display:flex;align-items:center;gap:0.5rem}\n.updated-text{font-size:0.62rem;color:var(--dim)}\n.icon-link{display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;background:rgba(255,255,255,0.05);border:1px solid var(--border);color:var(--muted);text-decoration:none;font-size:0.85rem;transition:background 0.15s,color 0.15s}\n.icon-link:hover{background:rgba(168,85,247,0.15);color:var(--pl)}\n.screens-outer{flex:1;overflow:hidden;position:relative}\n.screens-track{display:flex;width:600%;height:100%;transition:transform 0.38s cubic-bezier(0.4,0,0.2,1);will-change:transform}\n.screen{width:16.6667%;height:100%;overflow-y:auto;overflow-x:hidden;padding:0.75rem 0.85rem calc(var(--nav-h) + 0.85rem);-webkit-overflow-scrolling:touch;display:flex;flex-direction:column;gap:0.6rem}\n.screen::-webkit-scrollbar{display:none}\n.screen{scrollbar-width:none}\n.bottom-nav{height:var(--nav-h);flex-shrink:0;display:flex;background:rgba(20,23,40,0.97);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-top:1px solid var(--border)}\n.nav-item{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.18rem;background:none;border:none;cursor:pointer;color:var(--dim);font-family:inherit;transition:color 0.2s;position:relative;overflow:hidden;-webkit-tap-highlight-color:transparent;padding:0}\n.nav-item.active{color:var(--pl)}\n.nav-item::before{content:'';position:absolute;top:0;left:50%;transform:translateX(-50%);width:0;height:2px;background:var(--purple);border-radius:0 0 2px 2px;transition:width 0.25s cubic-bezier(0.4,0,0.2,1)}\n.nav-item.active::before{width:36px}\n.nav-icon{font-size:1.35rem;line-height:1;transition:transform 0.2s}\n.nav-item.active .nav-icon{transform:scale(1.12)}\n.nav-label{font-size:0.52rem;font-weight:600;letter-spacing:0.05em;text-transform:uppercase}\n@keyframes ripple{to{transform:scale(4);opacity:0}}\n.ripple-circle{position:absolute;border-radius:50%;background:rgba(168,85,247,0.2);width:36px;height:36px;margin:-18px;animation:ripple 0.45s ease forwards;pointer-events:none}\n.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 8px var(--green);animation:pulse 2s infinite}\n@keyframes pulse{0%,100%{opacity:1;box-shadow:0 0 8px var(--green)}50%{opacity:0.35;box-shadow:0 0 2px var(--green)}}\n@keyframes valueFlash{0%{}40%{color:#fff;transform:scale(1.06)}100%{transform:scale(1)}}\n.flash{animation:valueFlash 0.5s ease}\n@keyframes slideUp{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}\n.screen-entering>*{animation:slideUp 0.35s ease forwards;opacity:0}\n.screen-entering>*:nth-child(1){animation-delay:0.04s}\n.screen-entering>*:nth-child(2){animation-delay:0.09s}\n.screen-entering>*:nth-child(3){animation-delay:0.14s}\n.screen-entering>*:nth-child(4){animation-delay:0.19s}\n.screen-entering>*:nth-child(5){animation-delay:0.24s}\n.screen-entering>*:nth-child(6){animation-delay:0.29s}\n.screen-entering>*:nth-child(7){animation-delay:0.34s}\n.delivered{color:var(--purple)}.returned{color:var(--green)}.gas-c{color:var(--orange)}.voltage{color:var(--blue)}\n.power-hero{background:var(--surface);border:1px solid rgba(168,85,247,0.2);border-radius:20px;padding:1.25rem 1.25rem 1rem;display:flex;flex-direction:column;gap:0.25rem;position:relative;overflow:hidden;box-shadow:0 4px 32px rgba(168,85,247,0.08)}\n.power-hero::after{content:'';position:absolute;top:-50px;right:-50px;width:200px;height:200px;background:radial-gradient(circle,rgba(168,85,247,0.12) 0%,transparent 70%);pointer-events:none}\n.power-label{font-size:0.58rem;text-transform:uppercase;color:var(--muted);letter-spacing:0.1em;font-weight:600}\n.power-value{font-size:clamp(2.8rem,13vw,4.5rem);font-weight:700;letter-spacing:-0.04em;color:var(--pl);line-height:1}\n.power-value .unit{font-size:1.1rem;color:var(--muted);font-weight:400;margin-left:0.15rem}\n.power-sub{font-size:0.68rem;color:var(--muted)}\n.info-strip{display:grid;grid-template-columns:repeat(3,1fr);gap:0.5rem}\n.info-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:0.7rem 0.8rem;display:flex;flex-direction:column;transition:transform 0.2s,box-shadow 0.2s}\n.info-card:active{transform:scale(0.97)}\n.info-label{font-size:0.52rem;text-transform:uppercase;color:var(--dim);letter-spacing:0.07em;font-weight:600;margin-bottom:0.25rem}\n.info-value{font-size:1.15rem;font-weight:700;letter-spacing:-0.02em}\n.info-sub{font-size:0.58rem;color:var(--muted);margin-top:0.15rem}\n.card-unit{font-size:0.65rem;color:var(--muted);margin-left:0.1rem;font-weight:400}\n.phase-row{display:grid;grid-template-columns:repeat(3,1fr);gap:0.5rem}\n.phase-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:0.7rem 0.8rem;transition:transform 0.2s}\n.phase-card:active{transform:scale(0.97)}\n.phase-name{font-size:0.6rem;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:var(--dim);margin-bottom:0.3rem}\n.phase-power{font-size:1rem;font-weight:700;color:var(--pl)}\n.phase-volt{font-size:0.7rem;color:var(--blue);margin-top:0.18rem}\n.phase-amp{font-size:0.62rem;color:var(--muted);margin-top:0.05rem}\n.phase-bar-track{height:3px;background:rgba(255,255,255,0.07);border-radius:2px;margin-top:0.45rem;overflow:hidden}\n.phase-bar-fill{height:100%;border-radius:2px;background:linear-gradient(90deg,var(--purple),var(--pl));transition:width 0.6s cubic-bezier(0.4,0,0.2,1)}\n.log-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;overflow:hidden}\n.log-header{padding:0.75rem 0.85rem 0.4rem;display:flex;align-items:center;justify-content:space-between}\n.log-table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}\n.log-table{width:100%;border-collapse:collapse;font-size:0.7rem}\n.log-table th{text-align:left;padding:0.3rem 0.85rem;color:var(--dim);font-size:0.55rem;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;border-bottom:1px solid rgba(255,255,255,0.06);white-space:nowrap}\n.log-table td{padding:0.27rem 0.85rem;color:#94A3B8;border-bottom:1px solid rgba(255,255,255,0.03);white-space:nowrap}\n.log-table tr:last-child td{border-bottom:none}\n.chart-card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:0.85rem 1rem;display:flex;flex-direction:column;gap:0.5rem;min-height:230px}\n.chart-header{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.35rem}\n.chart-title{font-size:0.58rem;text-transform:uppercase;color:var(--dim);letter-spacing:0.08em;font-weight:600}\n.chart-wrap{flex:1;position:relative;min-height:170px}\n.tab-bar{display:flex;gap:0.3rem;flex-wrap:wrap}\n.tab{background:transparent;border:1px solid rgba(255,255,255,0.08);color:var(--muted);border-radius:20px;padding:0.16rem 0.6rem;font-size:0.6rem;cursor:pointer;font-family:inherit;font-weight:600;transition:all 0.2s;-webkit-tap-highlight-color:transparent}\n.tab.active{background:rgba(168,85,247,0.2);border-color:rgba(168,85,247,0.5);color:var(--pl)}\n.cost-table{width:100%;border-collapse:collapse;font-size:0.71rem}\n.cost-table th{text-align:left;padding:0.25rem 0.5rem;color:var(--dim);font-size:0.56rem;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;border-bottom:1px solid rgba(255,255,255,0.06)}\n.cost-table td{padding:0.27rem 0.5rem;color:#94A3B8;border-bottom:1px solid rgba(255,255,255,0.03)}\n.cost-table tr:last-child td{border-bottom:none}\n.cost-table .num{text-align:right;font-variant-numeric:tabular-nums}\n.compare-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:0.5rem}\n.compare-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:0.75rem 0.85rem;transition:transform 0.2s}\n.compare-card:active{transform:scale(0.97)}\n.compare-title{font-size:0.52rem;text-transform:uppercase;color:var(--dim);letter-spacing:0.07em;font-weight:600;margin-bottom:0.5rem}\n.compare-row{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:0.2rem}\n.compare-label{font-size:0.6rem;color:var(--muted)}\n.compare-value{font-size:0.78rem;font-weight:600;font-variant-numeric:tabular-nums}\n.delta-up{color:var(--red);font-size:0.6rem;margin-left:0.2rem}\n.delta-down{color:var(--green);font-size:0.6rem;margin-left:0.2rem}\n.delta-same{color:var(--dim);font-size:0.6rem;margin-left:0.2rem}\n.card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:0.85rem 1rem}\n.section-title{font-size:0.58rem;text-transform:uppercase;color:var(--dim);letter-spacing:0.09em;font-weight:600}\n.stats-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:0.5rem}\n.stat-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:0.7rem 0.85rem;transition:transform 0.2s}\n.stat-card:active{transform:scale(0.97)}\n.stat-label{font-size:0.54rem;text-transform:uppercase;color:var(--dim);letter-spacing:0.07em;font-weight:600;margin-bottom:0.25rem}\n.stat-value{font-size:1.05rem;font-weight:700;letter-spacing:-0.02em}\n.stat-unit{font-size:0.58rem;color:var(--muted);margin-left:0.1rem}\n.safety-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:0.5rem}\n.heatmap-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;margin-top:0.5rem}\n.heatmap{display:grid;grid-template-columns:1.8rem repeat(24,1fr);gap:2px;font-size:0.47rem;min-width:340px}\n.hm-label{color:var(--dim);display:flex;align-items:center;justify-content:flex-end;padding-right:4px;font-weight:600}\n.hm-hour-label{color:var(--dim);text-align:center;padding-bottom:2px}\n.hm-cell{height:16px;border-radius:2px}\n.cheap-hours-grid{display:flex;flex-wrap:wrap;gap:0.3rem;margin-top:0.4rem}\n.hour-cheap{background:rgba(34,197,94,0.15);color:#4ADE80;border:1px solid rgba(34,197,94,0.3);border-radius:20px;padding:0.15rem 0.5rem;font-size:0.62rem;font-weight:600}\n.hour-mid{background:rgba(251,191,36,0.12);color:#FDE68A;border:1px solid rgba(251,191,36,0.25);border-radius:20px;padding:0.15rem 0.5rem;font-size:0.62rem;font-weight:600}\n.hour-exp{background:rgba(248,113,113,0.1);color:#FCA5A5;border:1px solid rgba(248,113,113,0.2);border-radius:20px;padding:0.15rem 0.5rem;font-size:0.62rem;font-weight:600}\n.ip-badge{font-size:0.58rem;color:var(--dim);border:1px solid var(--border);border-radius:20px;padding:0.1rem 0.5rem;white-space:nowrap}\n.ip-row{display:flex;gap:0.4rem;flex-wrap:wrap;align-items:center}.weather-card{background:linear-gradient(135deg,#1E2340,#141728);border:1px solid var(--border);border-radius:20px;padding:1rem 1.1rem;display:flex;flex-direction:column;gap:0.75rem}.weather-top{display:flex;align-items:center;justify-content:space-between;gap:0.5rem}.weather-cond{display:flex;align-items:center;gap:0.6rem}.weather-icon{font-size:2.2rem;line-height:1}.weather-desc{font-size:0.85rem;font-weight:600;color:var(--text)}.weather-loc{font-size:0.62rem;color:var(--muted);margin-top:0.1rem}.weather-temp{font-size:2.4rem;font-weight:700;letter-spacing:-0.03em;color:var(--text)}.weather-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:0.4rem;border-top:1px solid var(--border);padding-top:0.65rem}.weather-stat{display:flex;align-items:center;gap:0.4rem}.weather-stat-icon{font-size:1rem}.weather-stat-value{font-size:0.72rem;font-weight:700;color:var(--text)}.weather-stat-label{font-size:0.5rem;color:var(--dim);text-transform:uppercase;letter-spacing:0.04em}.wash-status-pill{display:inline-flex;align-items:center;gap:0.4rem;padding:0.4rem 0.8rem;border-radius:20px;font-size:0.72rem;font-weight:600;border:1px solid var(--border);color:var(--dim);background:rgba(255,255,255,0.03);align-self:flex-start}.wash-status-pill.running{color:#38BDF8;border-color:rgba(56,189,248,0.4);background:rgba(56,189,248,0.1)}.wash-status-pill.done{color:#22C55E;border-color:rgba(34,197,94,0.4);background:rgba(34,197,94,0.1)}.wash-status-pill.running i{animation:wash-spin 1.5s linear infinite}@keyframes wash-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}\n@media(min-width:720px){\n  body{flex-direction:row;height:100vh}\n  .app-header{display:none}\n  .bottom-nav{width:64px;height:100%;flex-direction:column;padding:1rem 0;border-top:none;border-right:1px solid var(--border);order:-1;flex-shrink:0}\n  .nav-item{flex:0 0 auto;height:60px;width:100%;border-radius:0}\n  .nav-label{display:none}\n  .nav-item::before{top:50%;left:0;transform:translateY(-50%);width:3px;height:0;border-radius:0 2px 2px 0;transition:height 0.25s cubic-bezier(0.4,0,0.2,1)}\n  .nav-item.active::before{width:3px;height:36px}\n  .screens-outer{flex:1}\n  .stats-grid{grid-template-columns:repeat(3,1fr)}\n  .safety-grid{grid-template-columns:repeat(4,1fr)}\n}\n</style>\n<script src='https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js'></script>\n</head>\n<body>\n<header class='app-header'>\n  <div class='app-title'><span class='dot'></span>VloedHub</div>\n  <div class='header-right'>\n    <span class='updated-text' id='updated'>Wachten op data…</span>\n    <a href='/debug' class='icon-link' title='Debug'><i class='fa-solid fa-gear'></i></a>\n  </div>\n</header>\n<div class='screens-outer' id='screens-outer'>\n<div class='screens-track' id='screens-track'>\n\n<!-- SCREEN 0: LIVE -->\n<div class='screen screen-entering' id='screen-0'>\n  <div class='ip-row'>\n    <span class='ip-badge'><i class='fa-solid fa-server'></i> " + LOCAL_IP + ":5000</span>\n    <span class='ip-badge' id='wan-ip-badge'><i class='fa-solid fa-globe'></i> …</span>\n  </div>\n  <div class='weather-card'><div class='weather-top'><div class='weather-cond'><span class='weather-icon' id='weather-icon'>—</span><div><div class='weather-desc' id='weather-desc'>Laden…</div><div class='weather-loc'>Princenhage, Breda</div></div></div><div class='weather-temp' id='weather-temp'>—°</div></div><div class='weather-stats'><div class='weather-stat'><span class='weather-stat-icon'><i class='fa-solid fa-temperature-half'></i></span><div><div class='weather-stat-value' id='weather-feels'>—°C</div><div class='weather-stat-label'>Gevoelstemp.</div></div></div><div class='weather-stat'><span class='weather-stat-icon'><i class='fa-solid fa-droplet'></i></span><div><div class='weather-stat-value' id='weather-precip'>—%</div><div class='weather-stat-label'>Neerslag</div></div></div><div class='weather-stat'><span class='weather-stat-icon'><i class='fa-solid fa-water'></i></span><div><div class='weather-stat-value' id='weather-humidity'>—%</div><div class='weather-stat-label'>Vochtigheid</div></div></div><div class='weather-stat'><span class='weather-stat-icon'><i class='fa-solid fa-wind'></i></span><div><div class='weather-stat-value' id='weather-wind'>—</div><div class='weather-stat-label'>Wind</div></div></div></div></div>\n  <div class='power-hero'>\n    <div class='power-label'>Huidig verbruik</div>\n    <div class='power-value delivered' id='del-total'>—<span class='unit'>kW</span></div>\n    <div class='power-sub' id='price-elec'>— €/kWh</div>\n  </div>\n  <div class='info-strip'>\n    <div class='info-card'>\n      <div class='info-label'>Kosten vandaag</div>\n      <div class='info-value' style='color:var(--yellow)' id='hero-cost-today'>—<span class='card-unit'>€</span></div>\n    </div>\n    <div class='info-card'>\n      <div class='info-label'>Gas</div>\n      <div class='info-value gas-c' id='gas'>—<span class='card-unit'>m³</span></div>\n      <div class='info-sub' id='price-gas'>— €/m³</div>\n    </div>\n    <div class='info-card'>\n      <div class='info-label'>Metingen</div>\n      <div class='info-value' id='stat-readings'>—</div>\n      <div class='info-sub'>vandaag</div>\n    </div>\n  </div>\n  <div class='phase-row'>\n    <div class='phase-card'>\n      <div class='phase-name'>L1</div>\n      <div class='phase-power' id='del-l1'>—<span class='card-unit'>kW</span></div>\n      <div class='phase-volt' id='v-l1'>—<span class='card-unit'>V</span></div>\n      <div class='phase-amp' id='a-l1'>—<span class='card-unit'>A</span></div>\n      <div class='phase-bar-track'><div class='phase-bar-fill' id='bar-l1' style='width:0%'></div></div>\n    </div>\n    <div class='phase-card'>\n      <div class='phase-name'>L2</div>\n      <div class='phase-power' id='del-l2'>—<span class='card-unit'>kW</span></div>\n      <div class='phase-volt' id='v-l2'>—<span class='card-unit'>V</span></div>\n      <div class='phase-amp' id='a-l2'>—<span class='card-unit'>A</span></div>\n      <div class='phase-bar-track'><div class='phase-bar-fill' id='bar-l2' style='width:0%'></div></div>\n    </div>\n    <div class='phase-card'>\n      <div class='phase-name'>L3</div>\n      <div class='phase-power' id='del-l3'>—<span class='card-unit'>kW</span></div>\n      <div class='phase-volt' id='v-l3'>—<span class='card-unit'>V</span></div>\n      <div class='phase-amp' id='a-l3'>—<span class='card-unit'>A</span></div>\n      <div class='phase-bar-track'><div class='phase-bar-fill' id='bar-l3' style='width:0%'></div></div>\n    </div>\n  </div>\n  <div class='log-card'>\n    <div class='log-header'><span class='section-title'>Recente metingen</span></div>\n    <div class='log-table-wrap'>\n      <table class='log-table'>\n        <thead><tr><th>Tijd</th><th>Verbruik (kW)</th><th>Gas (m³)</th></tr></thead>\n        <tbody id='rows'></tbody>\n      </table>\n    </div>\n  </div>\n</div>\n\n<!-- SCREEN 1: VERLOOP -->\n<div class='screen' id='screen-1'>\n  <div class='chart-card'>\n    <div class='chart-header'>\n      <span class='chart-title'>Elektra verloop</span>\n      <div class='tab-bar'>\n        <button class='tab active' data-range='day' onclick='loadChart(\"day\",this)'>Dag</button>\n        <button class='tab' data-range='week' onclick='loadChart(\"week\",this)'>Week</button>\n        <button class='tab' data-range='month' onclick='loadChart(\"month\",this)'>Maand</button>\n      </div>\n    </div>\n    <div class='chart-wrap'><canvas id='chart'></canvas></div>\n  </div>\n  <div class='chart-card'>\n    <div class='chart-header'><span class='chart-title'>Piekuren (gem. per uur)</span></div>\n    <div class='chart-wrap'><canvas id='chart-peaks'></canvas></div>\n  </div>\n  <div class='chart-card'>\n    <div class='chart-header'><span class='chart-title'>Weekdaggemiddelde (60 dgn)</span></div>\n    <div class='chart-wrap'><canvas id='chart-weekday'></canvas></div>\n  </div>\n</div>\n\n<!-- SCREEN 2: KOSTEN -->\n<div class='screen' id='screen-2'>\n  <div class='compare-grid'>\n    <div class='compare-card'>\n      <div class='compare-title'>Vandaag</div>\n      <div class='compare-row'><span class='compare-label'>Stroom</span><span class='compare-value' id='cmp-today-elec'>—</span></div>\n      <div class='compare-row'><span class='compare-label'>Gas</span><span class='compare-value' id='cmp-today-gas'>—</span></div>\n      <div class='compare-row'><span class='compare-label'>Verwacht</span><span class='compare-value' id='cmp-today-exp' style='color:var(--yellow)'>—</span></div>\n    </div>\n    <div class='compare-card'>\n      <div class='compare-title'>Gisteren</div>\n      <div class='compare-row'><span class='compare-label'>Stroom</span><span class='compare-value' id='cmp-yest-elec'>—</span></div>\n      <div class='compare-row'><span class='compare-label'>Gas</span><span class='compare-value' id='cmp-yest-gas'>—</span></div>\n    </div>\n    <div class='compare-card'>\n      <div class='compare-title'>Vr. week</div>\n      <div class='compare-row'><span class='compare-label'>Stroom</span><span class='compare-value' id='cmp-week-elec'>—</span></div>\n      <div class='compare-row'><span class='compare-label'>Gas</span><span class='compare-value' id='cmp-week-gas'>—</span></div>\n    </div>\n  </div>\n  <div class='card'>\n    <div class='section-title' style='margin-bottom:0.5rem'>Geschatte kosten <span style='color:var(--dim);font-size:0.55rem;font-weight:400'>(stroom = huidig uur · gas = vandaag)</span></div>\n    <table class='cost-table'>\n      <thead><tr><th>Periode</th><th class='num'>kWh</th><th class='num'>Stroom €</th><th class='num'>m³</th><th class='num'>Gas €</th></tr></thead>\n      <tbody id='cost-rows'><tr><td colspan='5' style='color:var(--dim);padding:0.3rem 0.5rem'>Laden…</td></tr></tbody>\n    </table>\n  </div>\n  <div class='chart-card'>\n    <div class='chart-header'><span class='chart-title'>Kosten per dag (30 dgn)</span></div>\n    <div class='chart-wrap'><canvas id='chart-costs-daily'></canvas></div>\n  </div>\n  <div class='card'>\n    <div class='section-title'>Goedkoopste uren vandaag</div>\n    <div class='cheap-hours-grid' id='cheap-hours-grid'></div>\n  </div>\n</div>\n\n<!-- SCREEN 3: GAS -->\n<div class='screen' id='screen-3'>\n  <div class='chart-card'>\n    <div class='chart-header'><span class='chart-title'>Faseverdeling (gem. + piek, 7 dgn)</span></div>\n    <div class='chart-wrap'><canvas id='chart-phases'></canvas></div>\n  </div>\n  <div class='chart-card'>\n    <div class='chart-header'><span class='chart-title'>Gas dagverbruik (30 dgn)</span></div>\n    <div class='chart-wrap'><canvas id='chart-gas'></canvas></div>\n  </div>\n  <div class='chart-card'>\n    <div class='chart-header'><span class='chart-title'>Gas per maand</span></div>\n    <div class='chart-wrap'><canvas id='chart-gas-monthly'></canvas></div>\n  </div>\n</div>\n\n<!-- SCREEN 4: INFO -->\n<div class='screen' id='screen-4'>\n  <div class='stats-grid'>\n    <div class='stat-card'><div class='stat-label'>Gem. verbruik vandaag</div><div class='stat-value delivered' id='stat-avg-del'>—<span class='stat-unit'>kW</span></div></div>\n    <div class='stat-card'><div class='stat-label'>Piekverbruik vandaag</div><div class='stat-value delivered' id='stat-max-del'>—<span class='stat-unit'>kW</span></div></div>\n    <div class='stat-card'><div class='stat-label'>Gem. spanning</div><div class='stat-value voltage' id='stat-avg-v'>—<span class='stat-unit'>V</span></div></div>\n    <div class='stat-card'><div class='stat-label'>Meest actieve fase</div><div class='stat-value voltage' id='stat-top-phase'>—</div></div>\n    <div class='stat-card'><div class='stat-label'>Spanning min–max</div><div class='stat-value' id='stat-voltage-range'>—<span class='stat-unit'>V</span></div></div>\n    <div class='stat-card'><div class='stat-label'>Metingen vandaag</div><div class='stat-value' id='stat-readings-info'>—</div></div>\n  </div>\n  <div class='safety-grid'>\n    <div class='stat-card'><div class='stat-label'>Spanningsdips (7 dgn)</div><div class='stat-value' id='saf-dips' style='color:var(--red)'>—</div></div>\n    <div class='stat-card'><div class='stat-label'>Max stroom L1/L2/L3</div><div class='stat-value voltage' id='saf-max-amp'>—</div></div>\n    <div class='stat-card'><div class='stat-label'>Nachtverbruik standby</div><div class='stat-value' style='color:var(--purple)' id='saf-night'>—<span class='stat-unit'>kW</span></div></div>\n    <div class='stat-card'><div class='stat-label'>CO₂ vandaag (est.)</div><div class='stat-value' id='saf-co2'>—<span class='stat-unit'>kg</span></div></div>\n  </div>\n  <div class='card'>\n    <div style='display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.4rem;margin-bottom:0.5rem'>\n      <span class='section-title'>Heatmap (uur × weekdag)</span>\n      <div class='tab-bar'>\n        <button class='tab active' data-hm='alltime' onclick='loadHeatmap(\"alltime\",this)'>Alles</button>\n        <button class='tab' data-hm='year' onclick='loadHeatmap(\"year\",this)'>Jaar</button>\n        <button class='tab' data-hm='month' onclick='loadHeatmap(\"month\",this)'>Maand</button>\n        <button class='tab' data-hm='day' onclick='loadHeatmap(\"day\",this)'>Dag</button>\n      </div>\n    </div>\n    <div class='heatmap-wrap'><div class='heatmap' id='heatmap'></div></div>\n  </div>\n</div>\n\n<!-- SCREEN 5: WASMACHINE --><div class='screen' id='screen-5'><div class='wash-status-pill idle' id='wash-status-pill'><i class='fa-solid fa-moon' id='wash-status-icon'></i><span id='wash-status-text'>Laden…</span></div><div class='power-hero'><div class='power-label'>Totaal wasbeurten</div><div class='power-value' style='color:var(--blue)' id='wash-total'>—</div><div class='power-sub' id='wash-last'>Laatste: —</div></div><div class='stats-grid'><div class='stat-card'><div class='stat-label'>Vandaag</div><div class='stat-value' id='wash-today'>—</div></div><div class='stat-card'><div class='stat-label'>Deze week</div><div class='stat-value' id='wash-week'>—</div></div><div class='stat-card'><div class='stat-label'>Deze maand</div><div class='stat-value' id='wash-month'>—</div></div></div><div class='chart-card'><div class='chart-header'><span class='chart-title'>Wasbeurten per weekdag</span></div><div class='chart-wrap'><canvas id='chart-wash-weekday'></canvas></div></div><div class='log-card'><div class='log-header'><span class='section-title'>Recente wasbeurten</span></div><div class='log-table-wrap'><table class='log-table'><thead><tr><th>Tijd</th><th>Apparaat</th></tr></thead><tbody id='wash-rows'></tbody></table></div></div></div></div><!-- /screens-track -->\n</div><!-- /screens-outer -->\n\n<nav class='bottom-nav'>\n  <button class='nav-item active' data-screen='0' onclick='showScreen(0,this)'>\n    <span class='nav-icon'><i class='fa-solid fa-bolt'></i></span><span class='nav-label'>Live</span>\n  </button>\n  <button class='nav-item' data-screen='1' onclick='showScreen(1,this)'>\n    <span class='nav-icon'><i class='fa-solid fa-chart-line'></i></span><span class='nav-label'>Verloop</span>\n  </button>\n  <button class='nav-item' data-screen='2' onclick='showScreen(2,this)'>\n    <span class='nav-icon'><i class='fa-solid fa-euro-sign'></i></span><span class='nav-label'>Kosten</span>\n  </button>\n  <button class='nav-item' data-screen='3' onclick='showScreen(3,this)'>\n    <span class='nav-icon'><i class='fa-solid fa-fire'></i></span><span class='nav-label'>Gas</span>\n  </button>\n  <button class='nav-item' data-screen='4' onclick='showScreen(4,this)'>\n    <span class='nav-icon'><i class='fa-solid fa-chart-column'></i></span><span class='nav-label'>Info</span>\n  </button>\n<button class='nav-item' data-screen='5' onclick='showScreen(5,this)'><span class='nav-icon'><i class='fa-solid fa-shirt'></i></span><span class='nav-label'>Was</span></button></nav>\n\n<script>\n// ── Screen navigation ──\nvar currentScreen = 0;\nvar screenTrack = document.getElementById('screens-track');\nvar screenLoaded = [true, false, false, false, false, false];\n\nfunction showScreen(n, btn, fromSwipe) {\n  currentScreen = n;\n  screenTrack.style.transition = fromSwipe\n    ? 'transform 0.3s cubic-bezier(0.4,0,0.2,1)'\n    : 'transform 0.38s cubic-bezier(0.4,0,0.2,1)';\n  screenTrack.style.transform = 'translateX(calc(-' + (100/6) + '% * ' + n + '))';\n  document.querySelectorAll('.nav-item').forEach(function(b) { b.classList.remove('active'); });\n  if (btn) {\n    btn.classList.add('active');\n  } else {\n    var nb = document.querySelector('.nav-item[data-screen=\"' + n + '\"]');\n    if (nb) nb.classList.add('active');\n  }\n  var screenEl = document.getElementById('screen-' + n);\n  if (screenEl) {\n    screenEl.classList.add('screen-entering');\n    setTimeout(function() { screenEl.classList.remove('screen-entering'); }, 450);\n  }\n  if (!screenLoaded[n]) {\n    screenLoaded[n] = true;\n    if (n === 1) { loadChart('day', document.querySelector('[data-range=\"day\"]')); loadPeaks(); loadWeekdayChart(); }\n    if (n === 2) { refreshCosts(); refreshComparison(); loadCostsDaily(); refreshCheapHours(); }\n    if (n === 3) { loadPhaseChart(); loadGasDaily(); loadGasMonthly(); }\n    if (n === 4) { refreshStats(); refreshSafety(); loadHeatmap('alltime', document.querySelector('[data-hm=\"alltime\"]')); } if (n === 5) { refreshWasmachine(); loadWashWeekdayChart(); }\n  }\n}\n\n// ── Touch swipe ──\nvar touchX0 = 0, touchY0 = 0, isSwiping = false;\nvar outerEl = document.getElementById('screens-outer');\nouterEl.addEventListener('touchstart', function(e) {\n  touchX0 = e.touches[0].clientX;\n  touchY0 = e.touches[0].clientY;\n  isSwiping = false;\n}, {passive: true});\nouterEl.addEventListener('touchmove', function(e) {\n  var dx = e.touches[0].clientX - touchX0;\n  var dy = e.touches[0].clientY - touchY0;\n  if (!isSwiping && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) { isSwiping = true; }\n  if (isSwiping) {\n    var pct = (currentScreen * (100/6)) - (dx / window.innerWidth * (100/6));\n    pct = Math.max(0, Math.min(500/6, pct));\n    screenTrack.style.transition = 'none';\n    screenTrack.style.transform = 'translateX(-' + pct + '%)';\n  }\n}, {passive: true});\nouterEl.addEventListener('touchend', function(e) {\n  var dx = e.changedTouches[0].clientX - touchX0;\n  if (isSwiping) {\n    if (dx < -50 && currentScreen < 5) showScreen(currentScreen + 1, null, true);\n    else if (dx > 50 && currentScreen > 0) showScreen(currentScreen - 1, null, true);\n    else showScreen(currentScreen, null, true);\n  }\n  isSwiping = false;\n}, {passive: true});\n\n// ── Ripple on nav ──\nfunction addRipple(btn, e) {\n  var rect = btn.getBoundingClientRect();\n  var x = (e.clientX !== undefined ? e.clientX : rect.left + rect.width / 2) - rect.left;\n  var y = (e.clientY !== undefined ? e.clientY : rect.top + rect.height / 2) - rect.top;\n  var r = document.createElement('div');\n  r.className = 'ripple-circle';\n  r.style.left = x + 'px';\n  r.style.top = y + 'px';\n  btn.appendChild(r);\n  setTimeout(function() { if (r.parentNode) r.parentNode.removeChild(r); }, 500);\n}\ndocument.querySelectorAll('.nav-item').forEach(function(btn) {\n  btn.addEventListener('click', function(e) { addRipple(btn, e); });\n});\n\n// ── Value flash ──\nfunction flashEl(id) {\n  var el = document.getElementById(id);\n  if (!el) return;\n  el.classList.remove('flash');\n  void el.offsetWidth;\n  el.classList.add('flash');\n  setTimeout(function() { el.classList.remove('flash'); }, 500);\n}\n\n// ── WAN IP ──\nfetch('/api/network-info').then(function(r) { return r.json(); }).then(function(d) {\n  var el = document.getElementById('wan-ip-badge');\n  if (el) el.innerHTML = '<i class=\"fa-solid fa-globe\"></i> ' + d.wan;\n}).catch(function() {});\n\n// ── Helpers ──\nfunction val(v, dec) { return v != null ? Number(v).toFixed(dec != null ? dec : 3) : '—'; }\nfunction setEl(id, html) { var el = document.getElementById(id); if (el) el.innerHTML = html; }\nfunction setCard(id, v, dec, unit) {\n  setEl(id, val(v, dec) + '<span class=\"card-unit\">' + unit + '</span>');\n}\n\n// ── Live refresh ──\nvar lastPowerVal = null;\nfunction refresh() {\n  fetch('/api/latest').then(function(r) { return r.json(); }).then(function(d) {\n    var l = d.latest;\n    if (!l) return;\n    if (lastPowerVal !== null && Math.abs(l.power_delivered_total_kw - lastPowerVal) > 0.01) flashEl('del-total');\n    lastPowerVal = l.power_delivered_total_kw;\n    setCard('del-total', l.power_delivered_total_kw, 3, 'kW');\n    setCard('gas',       l.gas_m3,                  3, 'm³');\n    setCard('del-l1', l.power_delivered_l1_kw, 3, 'kW');\n    setCard('del-l2', l.power_delivered_l2_kw, 3, 'kW');\n    setCard('del-l3', l.power_delivered_l3_kw, 3, 'kW');\n    setCard('v-l1', l.voltage_l1, 1, 'V');\n    setCard('v-l2', l.voltage_l2, 1, 'V');\n    setCard('v-l3', l.voltage_l3, 1, 'V');\n    setCard('a-l1', l.current_l1, 0, 'A');\n    setCard('a-l2', l.current_l2, 0, 'A');\n    setCard('a-l3', l.current_l3, 0, 'A');\n    var p1 = l.power_delivered_l1_kw || 0;\n    var p2 = l.power_delivered_l2_kw || 0;\n    var p3 = l.power_delivered_l3_kw || 0;\n    var pMax = Math.max(p1, p2, p3, 0.001);\n    var b1 = document.getElementById('bar-l1'); if (b1) b1.style.width = Math.round(p1/pMax*100) + '%';\n    var b2 = document.getElementById('bar-l2'); if (b2) b2.style.width = Math.round(p2/pMax*100) + '%';\n    var b3 = document.getElementById('bar-l3'); if (b3) b3.style.width = Math.round(p3/pMax*100) + '%';\n    var updEl = document.getElementById('updated');\n    if (updEl) {\n      var age = Math.round((Date.now() - new Date(l.received_at).getTime()) / 1000);\n      updEl.textContent = new Date(l.received_at).toLocaleTimeString('nl-NL', {hour12:false}) + ' (' + age + 's)';\n      updEl.style.color = age > 60 ? '#F87171' : age > 30 ? '#FBBF24' : '#3D4D6A';\n    }\n    var html = '';\n    for (var i = 0; i < d.recent.length; i++) {\n      var rec = d.recent[i];\n      html += '<tr><td>' + new Date(rec.received_at).toLocaleTimeString('nl-NL', {hour12:false}) + '</td>' +\n        '<td>' + val(rec.power_delivered_total_kw) + '</td>' +\n        '<td>' + val(rec.gas_m3) + '</td></tr>';\n    }\n    setEl('rows', html);\n  }).catch(function(e) { console.error('[refresh]', e); });\n}\nrefresh();\nsetInterval(refresh, 3000);\n\n// ── Chart ──\nvar chart = null;\nfunction loadChart(range, btn) {\n  document.querySelectorAll('[data-range]').forEach(function(t) { t.classList.remove('active'); });\n  if (btn) btn.classList.add('active');\n  fetch('/api/history?range=' + range).then(function(r) { return r.json(); }).then(function(rows) {\n    var labels = rows.map(function(r) { return r.period; });\n    var del    = rows.map(function(r) { return r.del != null ? Number(r.del).toFixed(3) : null; });\n    if (chart) chart.destroy();\n    chart = new Chart(document.getElementById('chart'), {\n      type: 'line',\n      data: { labels: labels, datasets: [\n        { label: 'Verbruik (kW)', data: del, borderColor: '#A855F7', backgroundColor: 'rgba(168,85,247,0.1)', tension: 0.3, pointRadius: 2, fill: true }\n      ]},\n      options: {\n        responsive: true, maintainAspectRatio: false,\n        interaction: { mode: 'index', intersect: false },\n        plugins: { legend: { labels: { color: '#94A3B8', boxWidth: 12, font: { size: 10 } } } },\n        scales: {\n          x: { ticks: { color: '#3D4D6A', maxRotation: 45, font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' } },\n          y: { ticks: { color: '#3D4D6A', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true }\n        }\n      }\n    });\n  }).catch(function() {});\n}\n\nfunction eur(v) { return v != null ? '€' + Number(v).toFixed(2) : '—'; }\nfunction num(v, d) { return v != null ? Number(v).toFixed(d != null ? d : 3) : '—'; }\n\n// ── Costs ──\nfunction refreshCosts() {\n  fetch('/api/costs').then(function(r) { return r.json(); }).then(function(c) {\n    var rows = [['Uur','hour'],['Dag','day'],['Week','week'],['Maand','month']];\n    setEl('cost-rows', rows.map(function(r) {\n      var d = c[r[1]];\n      return '<tr><td>' + r[0] + '</td><td class=\"num\">' + num(d.elec_kwh) + '</td><td class=\"num\">' + eur(d.elec_cost) + '</td><td class=\"num\">' + num(d.gas_m3) + '</td><td class=\"num\">' + eur(d.gas_cost) + '</td></tr>';\n    }).join(''));\n    var day = c.day;\n    if (day && (day.elec_cost != null || day.gas_cost != null)) {\n      var total = (day.elec_cost || 0) + (day.gas_cost || 0);\n      setEl('hero-cost-today', '€' + total.toFixed(2) + '<span class=\"card-unit\">/dag</span>');\n    }\n  }).catch(function() {});\n}\nrefreshCosts();\nsetInterval(refreshCosts, 60000);\n\n// ── Prices ──\nfunction refreshPrices() {\n  fetch('/api/prices').then(function(r) { return r.json(); }).then(function(p) {\n    if (p.electricity_eur_kwh != null)\n      setEl('price-elec', Number(p.electricity_eur_kwh).toFixed(4) + '<span class=\"card-unit\">€/kWh</span>');\n    if (p.gas_eur_m3 != null)\n      setEl('price-gas', Number(p.gas_eur_m3).toFixed(4) + '<span class=\"card-unit\">€/m³</span>');\n  }).catch(function() {});\n}\nrefreshPrices();\nsetInterval(refreshPrices, 900000);\n\n// ── Weather ──\nfunction refreshWeather() { fetch('/api/weather').then(function(r){return r.json();}).then(function(w) { if (!w || w.temp == null) return; setEl('weather-icon', '<i class=\"fa-solid fa-' + w.icon + '\"></i>'); setEl('weather-desc', w.condition); setEl('weather-temp', Math.round(w.temp) + '°'); setEl('weather-feels', Math.round(w.feels_like) + '°C'); setEl('weather-precip', (w.precipitation_probability != null ? w.precipitation_probability : '—') + '%'); setEl('weather-humidity', w.humidity + '%'); setEl('weather-wind', Math.round(w.wind_speed) + ' km/h'); }).catch(function(){}); }\nrefreshWeather();\nsetInterval(refreshWeather, 900000);\n\n// ── Stats ──\nfunction refreshStats() {\n  fetch('/api/stats').then(function(r) { return r.json(); }).then(function(s) {\n    if (!s || s.avg_del == null) return;\n    setEl('stat-avg-del', num(s.avg_del, 3) + '<span class=\"stat-unit\">kW</span>');\n    setEl('stat-max-del', num(s.max_del, 3) + '<span class=\"stat-unit\">kW</span>');\n    var phases = [['L1', s.avg_l1], ['L2', s.avg_l2], ['L3', s.avg_l3]];\n    var top = phases.filter(function(p) { return p[1] != null; }).sort(function(a,b) { return b[1]-a[1]; })[0];\n    var topEl = document.getElementById('stat-top-phase'); if (topEl) topEl.textContent = top ? top[0] : '—';\n    if (s.min_v1 != null && s.max_v1 != null) {\n      setEl('stat-voltage-range', num(s.min_v1,1) + '–' + num(s.max_v1,1) + '<span class=\"stat-unit\">V</span>');\n      setEl('stat-avg-v', num((s.min_v1+s.max_v1)/2,1) + '<span class=\"stat-unit\">V</span>');\n    }\n    var rd = s.total_readings != null ? s.total_readings : '—';\n    var rdEl = document.getElementById('stat-readings'); if (rdEl) rdEl.textContent = rd;\n    var rdEl2 = document.getElementById('stat-readings-info'); if (rdEl2) rdEl2.textContent = rd;\n  }).catch(function() {});\n}\nrefreshStats();\nsetInterval(refreshStats, 30000);\n\n// ── Peaks ──\nvar chartPeaks = null;\nfunction loadPeaks() {\n  fetch('/api/peaks').then(function(r) { return r.json(); }).then(function(rows) {\n    var byHour = {};\n    rows.forEach(function(r) { byHour[parseInt(r.hour,10)] = r; });\n    var labels = [], delData = [], counts = [];\n    for (var h = 0; h < 24; h++) {\n      labels.push(h + ':00');\n      var d = byHour[h];\n      delData.push(d && d.avg_del != null ? Number(d.avg_del).toFixed(3) : 0);\n      counts.push(d ? d.n : 0);\n    }\n    if (chartPeaks) chartPeaks.destroy();\n    chartPeaks = new Chart(document.getElementById('chart-peaks'), {\n      type: 'bar',\n      data: { labels: labels, datasets: [\n        { label: 'Gem. verbruik (kW)', data: delData, backgroundColor: 'rgba(168,85,247,0.55)', borderColor: '#A855F7', borderWidth: 1, borderRadius: 3 }\n      ]},\n      options: {\n        responsive: true, maintainAspectRatio: false,\n        plugins: { legend: { labels: { color: '#94A3B8', boxWidth: 10, font: { size: 10 } } }, tooltip: { callbacks: { afterLabel: function(ctx) { return 'Metingen: ' + counts[ctx.dataIndex]; } } } },\n        scales: { x: { ticks: { color: '#3D4D6A', maxRotation: 45, font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' } }, y: { ticks: { color: '#3D4D6A', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true } }\n      }\n    });\n  }).catch(function() {});\n}\n\n// ── Phase chart ──\nvar chartPhases = null;\nfunction loadPhaseChart() {\n  fetch('/api/phase-stats').then(function(r) { return r.json(); }).then(function(s) {\n    if (!s || s.avg_l1 == null) return;\n    if (chartPhases) chartPhases.destroy();\n    chartPhases = new Chart(document.getElementById('chart-phases'), {\n      type: 'bar',\n      data: { labels: ['L1','L2','L3'], datasets: [\n        { label: 'Gemiddeld (kW)', data: [s.avg_l1,s.avg_l2,s.avg_l3].map(function(v){return v!=null?Number(v).toFixed(3):0;}), backgroundColor: ['rgba(168,85,247,0.6)','rgba(56,189,248,0.6)','rgba(251,146,60,0.6)'], borderColor: ['#A855F7','#38BDF8','#F97316'], borderWidth: 1, borderRadius: 4 },\n        { label: 'Piek (kW)', data: [s.max_l1,s.max_l2,s.max_l3].map(function(v){return v!=null?Number(v).toFixed(3):0;}), backgroundColor: ['rgba(168,85,247,0.2)','rgba(56,189,248,0.2)','rgba(251,146,60,0.2)'], borderColor: ['#A855F7','#38BDF8','#F97316'], borderWidth: 1, borderRadius: 4 }\n      ]},\n      options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { labels: { color: '#94A3B8', boxWidth: 10, font: { size: 10 } } } }, scales: { x: { ticks: { color: '#3D4D6A', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true }, y: { ticks: { color: '#94A3B8', font: { size: 11, weight: '600' } }, grid: { color: 'rgba(255,255,255,0.04)' } } } }\n    });\n  }).catch(function() {});\n}\n\n// ── Gas daily ──\nvar chartGas = null;\nfunction loadGasDaily() {\n  fetch('/api/gas-daily').then(function(r) { return r.json(); }).then(function(rows) {\n    var labels = rows.map(function(r) { return r.day.slice(5); });\n    var data   = rows.map(function(r) { return r.gas_used != null ? Number(r.gas_used).toFixed(3) : 0; });\n    if (chartGas) chartGas.destroy();\n    chartGas = new Chart(document.getElementById('chart-gas'), {\n      type: 'bar',\n      data: { labels: labels, datasets: [{ label: 'Gas (m³)', data: data, backgroundColor: 'rgba(249,115,22,0.55)', borderColor: '#F97316', borderWidth: 1, borderRadius: 3 }] },\n      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#94A3B8', boxWidth: 10, font: { size: 10 } } } }, scales: { x: { ticks: { color: '#3D4D6A', maxRotation: 45, font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' } }, y: { ticks: { color: '#3D4D6A', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true } } }\n    });\n  }).catch(function() {});\n}\n\n// ── Day comparison ──\nfunction refreshComparison() {\n  fetch('/api/day-comparison').then(function(r){return r.json();}).then(function(c) {\n    var t = c.today, y = c.yesterday, w = c.lastweek;\n    function kwh(v) { return v != null ? num(v,2)+' kWh' : '—'; }\n    function m3(v)  { return v != null ? num(v,3)+' m³' : '—'; }\n    function delta(now, ref) {\n      if (now == null || ref == null || ref === 0) return '';\n      var pct = ((now - ref) / ref * 100);\n      var cls = pct > 5 ? 'delta-up' : pct < -5 ? 'delta-down' : 'delta-same';\n      return '<span class=\"'+cls+'\">'+(pct>0?'+':'')+pct.toFixed(0)+'%</span>';\n    }\n    setEl('cmp-today-elec', kwh(t && t.elec_kwh) + delta(t && t.elec_kwh, y && y.elec_kwh));\n    setEl('cmp-today-gas',  m3(t && t.gas_used)  + delta(t && t.gas_used,  y && y.gas_used));\n    setEl('cmp-yest-elec',  kwh(y && y.elec_kwh));\n    setEl('cmp-yest-gas',   m3(y && y.gas_used));\n    setEl('cmp-week-elec',  kwh(w && w.elec_kwh));\n    setEl('cmp-week-gas',   m3(w && w.gas_used));\n    if (t && t.elec_kwh != null) {\n      var h = new Date().getHours() + new Date().getMinutes()/60;\n      if (h > 0) setEl('cmp-today-exp', '~' + num(t.elec_kwh/h*24,2) + ' kWh/dag');\n    }\n  }).catch(function(){});\n}\n\n// ── Safety ──\nfunction refreshSafety() {\n  fetch('/api/voltage-dips').then(function(r){return r.json();}).then(function(s) {\n    if (!s) return;\n    var dipsEl = document.getElementById('saf-dips');\n    if (dipsEl) { dipsEl.textContent = s.dips != null ? s.dips : '—'; dipsEl.style.color = (s.dips > 0) ? '#F87171' : '#4ADE80'; }\n    if (s.max_a1 != null) setEl('saf-max-amp', num(s.max_a1,0)+'A / '+num(s.max_a2,0)+'A / '+num(s.max_a3,0)+'A<span class=\"stat-unit\"> max</span>');\n  }).catch(function(){});\n  fetch('/api/night-usage').then(function(r){return r.json();}).then(function(s) {\n    if (!s) return;\n    if (s.night_avg != null) setEl('saf-night', num(s.night_avg,3)+'<span class=\"stat-unit\">kW</span>');\n  }).catch(function(){});\n  fetch('/api/stats').then(function(r){return r.json();}).then(function(s) {\n    if (!s || s.avg_del == null) return;\n    var h = new Date().getHours() + new Date().getMinutes()/60;\n    var co2 = s.avg_del * h * 0.4;\n    setEl('saf-co2', num(co2,2)+'<span class=\"stat-unit\">kg</span>');\n  }).catch(function(){});\n}\n\n// ── Wasmachine ──\nvar chartWashWeekday = null;function loadWashWeekdayChart() { fetch('/api/wasmachine/weekday').then(function(r){return r.json();}).then(function(rows) { var dayNames = ['Zo','Ma','Di','Wo','Do','Vr','Za']; var byDow = {}; rows.forEach(function(r){ byDow[parseInt(r.dow,10)] = r; }); var labels = [], data = []; for (var d = 0; d < 7; d++) { labels.push(dayNames[d]); var r = byDow[d]; data.push(r ? r.n : 0); } if (chartWashWeekday) chartWashWeekday.destroy(); chartWashWeekday = new Chart(document.getElementById('chart-wash-weekday'), { type: 'bar', data: { labels: labels, datasets: [{ label: 'Aantal wasbeurten', data: data, backgroundColor: 'rgba(56,189,248,0.55)', borderColor: '#38BDF8', borderWidth: 1, borderRadius: 4 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#94A3B8', font: { size: 11, weight: '600' } }, grid: { color: 'rgba(255,255,255,0.04)' } }, y: { ticks: { color: '#3D4D6A', font: { size: 9 }, precision: 0 }, grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true } } } }); }).catch(function(){}); }\n\nfunction refreshWasmachine() { fetch('/api/wasmachine/stats').then(function(r){return r.json();}).then(function(s) { setEl('wash-total', s.total != null ? s.total : '—'); setEl('wash-today', s.today != null ? s.today : 0); setEl('wash-week', s.this_week != null ? s.this_week : 0); setEl('wash-month', s.this_month != null ? s.this_month : 0); var lastEl = document.getElementById('wash-last'); if (lastEl) lastEl.textContent = 'Laatste: ' + (s.last_finished_at ? new Date(s.last_finished_at).toLocaleString('nl-NL', {hour12:false}) : '—'); }).catch(function(){}); fetch('/api/wasmachine/recent?limit=25').then(function(r){return r.json();}).then(function(rows) { var html = rows.length ? rows.map(function(r) { return '<tr><td>' + new Date(r.finished_at).toLocaleString('nl-NL', {hour12:false}) + '</td><td>' + (r.device || '—') + '</td></tr>'; }).join('') : '<tr><td colspan=\"2\" style=\"color:var(--dim);padding:0.3rem 0.85rem\">Nog geen wasbeurten gelogd</td></tr>'; setEl('wash-rows', html); }).catch(function(){}); refreshWashStatus(); }\nfunction refreshWashStatus() { fetch('/api/wasmachine/status').then(function(r){return r.json();}).then(function(s) { var pill = document.getElementById('wash-status-pill'); var icon = document.getElementById('wash-status-icon'); var text = document.getElementById('wash-status-text'); if (!pill) return; var state = s.state || 'idle'; pill.className = 'wash-status-pill ' + state; var since = s.since ? new Date(s.since).toLocaleString('nl-NL', {hour12:false}) : null; if (state === 'running') { icon.className = 'fa-solid fa-rotate'; text.textContent = 'In gebruik' + (since ? ' sinds ' + since : ''); } else if (state === 'done') { icon.className = 'fa-solid fa-circle-check'; text.textContent = 'Klaar, nog leeghalen' + (since ? ' (' + since + ')' : ''); } else { icon.className = 'fa-solid fa-moon'; text.textContent = 'Inactief'; } }).catch(function(){}); }\n\n// ── Cheap hours ──\nfunction refreshCheapHours() {\n  fetch('/api/prices').then(function(r){return r.json();}).then(function(p) {\n    var grid = document.getElementById('cheap-hours-grid');\n    if (!grid) return;\n    if (p.electricity_eur_kwh != null) {\n      var price = p.electricity_eur_kwh;\n      var now = new Date().getHours();\n      var html = '<div style=\"font-size:0.7rem;color:#94A3B8;width:100%\">Huidig uur (' + now + ':00): <strong style=\"color:#FBBF24\">€' + price.toFixed(4) + '/kWh</strong></div>';\n      html += '<div style=\"font-size:0.62rem;color:#3D4D6A;width:100%;margin-top:0.3rem\">Tip: plan grote apparaten in de avond (vaak lager tarief)</div>';\n      grid.innerHTML = html;\n    }\n  }).catch(function(){});\n}\n\n// ── Weekday chart ──\nvar chartWeekday = null;\nfunction loadWeekdayChart() {\n  fetch('/api/weekday-avg').then(function(r){return r.json();}).then(function(rows) {\n    var dayNames = ['Zo','Ma','Di','Wo','Do','Vr','Za'];\n    var byDow = {};\n    rows.forEach(function(r){ byDow[parseInt(r.dow,10)] = r; });\n    var labels = [], data = [];\n    for (var d = 0; d < 7; d++) {\n      labels.push(dayNames[d]);\n      var r = byDow[d];\n      data.push(r && r.avg_del != null ? Number(r.avg_del).toFixed(3) : 0);\n    }\n    if (chartWeekday) chartWeekday.destroy();\n    chartWeekday = new Chart(document.getElementById('chart-weekday'), {\n      type: 'bar',\n      data: { labels: labels, datasets: [{ label: 'Gem. verbruik (kW)', data: data, backgroundColor: ['rgba(168,85,247,0.4)','rgba(168,85,247,0.6)','rgba(168,85,247,0.6)','rgba(168,85,247,0.6)','rgba(168,85,247,0.6)','rgba(168,85,247,0.6)','rgba(168,85,247,0.4)'], borderColor: '#A855F7', borderWidth: 1, borderRadius: 4 }] },\n      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#94A3B8', font: { size: 11, weight: '600' } }, grid: { color: 'rgba(255,255,255,0.04)' } }, y: { ticks: { color: '#3D4D6A', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true } } }\n    });\n  }).catch(function(){});\n}\n\n// ── Heatmap ──\nfunction loadHeatmap(range, btn) {\n  document.querySelectorAll('[data-hm]').forEach(function(t) { t.classList.remove('active'); });\n  if (btn) btn.classList.add('active');\n  fetch('/api/heatmap?range=' + (range || 'alltime')).then(function(r){return r.json();}).then(function(rows) {\n    var dayNames = ['Zo','Ma','Di','Wo','Do','Vr','Za'];\n    var grid = {}, maxVal = 0;\n    rows.forEach(function(r) {\n      var v = r.avg_del != null ? Number(r.avg_del) : 0;\n      grid[r.dow + '_' + parseInt(r.hour,10)] = v;\n      if (v > maxVal) maxVal = v;\n    });\n    if (maxVal === 0) maxVal = 1;\n    var html = '<div class=\"hm-label\"></div>';\n    for (var h = 0; h < 24; h++) html += '<div class=\"hm-hour-label\">' + h + '</div>';\n    for (var d = 0; d < 7; d++) {\n      html += '<div class=\"hm-label\">' + dayNames[d] + '</div>';\n      for (var h = 0; h < 24; h++) {\n        var v = grid[d + '_' + h] || 0;\n        var ratio = v / maxVal;\n        var r2 = Math.round(168 + ratio*(248-168)), g2 = Math.round(85 - ratio*85), b2 = Math.round(247 - ratio*100);\n        var alpha = 0.1 + ratio*0.8;\n        var bg = 'rgba('+r2+','+g2+','+b2+','+alpha.toFixed(2)+')';\n        html += '<div class=\"hm-cell\" style=\"background:'+bg+'\" title=\"'+dayNames[d]+' '+h+':00 — '+v.toFixed(3)+' kW\"></div>';\n      }\n    }\n    var hmEl = document.getElementById('heatmap'); if (hmEl) hmEl.innerHTML = html;\n  }).catch(function(){});\n}\n\n// ── Daily costs chart ──\nvar chartCostsDaily = null;\nfunction loadCostsDaily() {\n  fetch('/api/costs-daily').then(function(r){return r.json();}).then(function(rows) {\n    var labels  = rows.map(function(r){ return r.day.slice(5); });\n    var elecD   = rows.map(function(r){ return r.elec_cost != null ? Number(r.elec_cost).toFixed(2) : 0; });\n    var gasD    = rows.map(function(r){ return r.gas_cost  != null ? Number(r.gas_cost).toFixed(2)  : 0; });\n    if (chartCostsDaily) chartCostsDaily.destroy();\n    chartCostsDaily = new Chart(document.getElementById('chart-costs-daily'), {\n      type: 'bar',\n      data: { labels: labels, datasets: [\n        { label: 'Stroom (€)', data: elecD, backgroundColor: 'rgba(168,85,247,0.55)', borderColor: '#A855F7', borderWidth: 1, borderRadius: 3, stack: 'cost' },\n        { label: 'Gas (€)',    data: gasD,  backgroundColor: 'rgba(249,115,22,0.55)', borderColor: '#F97316', borderWidth: 1, borderRadius: 3, stack: 'cost' }\n      ]},\n      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#94A3B8', boxWidth: 10, font: { size: 10 } } } }, scales: { x: { ticks: { color: '#3D4D6A', maxRotation: 45, font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' }, stacked: true }, y: { ticks: { color: '#3D4D6A', font: { size: 9 }, callback: function(v){ return '€'+v; } }, grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true, stacked: true } } }\n    });\n  }).catch(function(){});\n}\n\n// ── Gas monthly ──\nvar chartGasMonthly = null;\nfunction loadGasMonthly() {\n  fetch('/api/gas-monthly').then(function(r){return r.json();}).then(function(rows) {\n    var labels = rows.map(function(r){ return r.month; });\n    var data   = rows.map(function(r){ return r.gas_used != null ? Number(r.gas_used).toFixed(2) : 0; });\n    if (chartGasMonthly) chartGasMonthly.destroy();\n    chartGasMonthly = new Chart(document.getElementById('chart-gas-monthly'), {\n      type: 'bar',\n      data: { labels: labels, datasets: [{ label: 'Gas (m³)', data: data, backgroundColor: 'rgba(249,115,22,0.55)', borderColor: '#F97316', borderWidth: 1, borderRadius: 4 }] },\n      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#3D4D6A', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' } }, y: { ticks: { color: '#3D4D6A', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true } } }\n    });\n  }).catch(function(){});\n}\n\n// ── Periodic refresh for non-active screens ──\nsetInterval(function() {\n  if (currentScreen === 1) { var a = document.querySelector('[data-range].active'); if(a) loadChart(a.dataset.range, a); }\n  if (currentScreen === 2) { refreshCosts(); refreshComparison(); }\n  if (currentScreen === 3) { loadPhaseChart(); loadGasDaily(); }\n  if (currentScreen === 4) { refreshStats(); refreshSafety(); } if (currentScreen === 5) { refreshWasmachine(); }\n}, 60000);\nsetInterval(function() {\n  if (currentScreen === 1) { loadPeaks(); loadWeekdayChart(); }\n  if (currentScreen === 3) { loadGasMonthly(); }\n  if (currentScreen === 2) { loadCostsDaily(); }\n  if (currentScreen === 5) { loadWashWeekdayChart(); }\n  if (currentScreen === 4) { var hb = document.querySelector('[data-hm].active'); loadHeatmap(hb ? hb.dataset.hm : 'alltime', hb || null); }\n}, 300000);\n</script>\n</body>\n</html>";

var server = http.createServer(function(req, res) {
  if (req.method === "POST" && req.url === "/api/p1data") {
    var contentType = req.headers["content-type"] || "";
    if (!contentType.includes("application/json")) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "expected application/json" }));
      return;
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
      logReading(data, function(err) {
        if (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "db error" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      });
    });
    return;
  }

  if (req.method === "POST" && req.url === "/api/wasmachine") {
    var contentTypeW = req.headers["content-type"] || "";
    if (!contentTypeW.includes("application/json")) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "expected application/json" }));
      return;
    }

    var bodyW = "";
    req.on("data", function(chunk) { bodyW += chunk; });
    req.on("end", function() {
      var dataW;
      try { dataW = JSON.parse(bodyW); }
      catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid JSON" }));
        return;
      }
      logWashCycle(dataW, function(err) {
        if (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "db error" }));
          return;
        }
        setWashStatus("done", dataW.device);
        sendDiscord("🧺 **Was is klaar!** (" + (dataW.device || "wasmachine") + ")");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      });
    });
    return;
  }

  if (req.method === "GET" && req.url === "/api/wasmachine/stats") {
    db.get(
      "SELECT COUNT(*) as total," +
      " SUM(CASE WHEN finished_at >= ? THEN 1 ELSE 0 END) as today," +
      " SUM(CASE WHEN finished_at >= ? THEN 1 ELSE 0 END) as this_week," +
      " SUM(CASE WHEN finished_at >= ? THEN 1 ELSE 0 END) as this_month," +
      " MAX(finished_at) as last_finished_at" +
      " FROM wasmachine_cycles",
      [todayAms() + "T00:00:00", cutoff(604800000), cutoff(2592000000)],
      function(err, row) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(row || {}));
      }
    );
    return;
  }

  if (req.method === "GET" && req.url.indexOf("/api/wasmachine/recent") === 0) {
    var limitW = 50;
    var qsW = req.url.indexOf("?limit=");
    if (qsW !== -1) limitW = parseInt(req.url.slice(qsW + 7), 10) || 50;
    db.all(
      "SELECT id, finished_at, device FROM wasmachine_cycles ORDER BY id DESC LIMIT ?",
      [limitW],
      function(err, rows) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(rows || []));
      }
    );
    return;
  }

  if (req.method === "GET" && req.url === "/api/wasmachine/weekday") {
    db.all(
      "SELECT strftime('%w', finished_at) as dow, COUNT(*) as n" +
      " FROM wasmachine_cycles" +
      " GROUP BY dow ORDER BY dow",
      function(err, rows) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(rows || []));
      }
    );
    return;
  }

  if (req.method === "POST" && req.url === "/api/wasmachine/start") {
    var contentTypeS = req.headers["content-type"] || "";
    if (!contentTypeS.includes("application/json")) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "expected application/json" }));
      return;
    }
    var bodyS = "";
    req.on("data", function(chunk) { bodyS += chunk; });
    req.on("end", function() {
      var dataS;
      try { dataS = JSON.parse(bodyS); }
      catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid JSON" }));
        return;
      }
      setWashStatus("running", dataS.device, function(err) {
        if (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "db error" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      });
    });
    return;
  }

  if (req.method === "POST" && req.url === "/api/wasmachine/reset") {
    var contentTypeR = req.headers["content-type"] || "";
    if (!contentTypeR.includes("application/json")) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "expected application/json" }));
      return;
    }
    var bodyR = "";
    req.on("data", function(chunk) { bodyR += chunk; });
    req.on("end", function() {
      var dataR;
      try { dataR = JSON.parse(bodyR); }
      catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid JSON" }));
        return;
      }
      setWashStatus("idle", dataR.device, function(err) {
        if (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "db error" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      });
    });
    return;
  }

  if (req.method === "GET" && req.url === "/api/wasmachine/status") {
    db.get("SELECT state, since, device FROM wasmachine_status WHERE id = 1", function(err, row) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(row || { state: "idle", since: null, device: null }));
    });
    return;
  }

  if (req.method === "GET" && req.url === "/api/weather") {
    fetchWeather(function(err, weather) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(err ? { error: "unavailable" } : weather));
    });
    return;
  }

  if (req.method === "GET" && req.url === "/api/prices") {
    fetchPrices(function(err, prices) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(err ? { error: "unavailable" } : prices));
    });
    return;
  }

  if (req.method === "GET" && req.url === "/api/costs") {
    fetchPrices(function(err, prices) {
      if (err) { prices = {}; }
      var ep = prices.electricity_eur_kwh || null;
      var gp = prices.gas_eur_m3 || null;
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
        var param = p.key === "day" ? todayAms() : effectiveCutoff(p.ms);
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
    return;
  }

  if (req.method === "GET" && req.url === "/api/latest") {
    db.get("SELECT * FROM readings ORDER BY id DESC LIMIT 1", function(err, latest) {
      db.all(
        "SELECT received_at, power_delivered_total_kw, power_returned_total_kw, gas_m3 FROM readings ORDER BY id DESC LIMIT 250",
        function(err2, recent) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ latest: latest || null, recent: recent || [] }));
        }
      );
    });
    return;
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
    var sinceParam = range === "day" ? (todayAms() + "T00:00:00") : effectiveCutoff(sinceMs);

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
    return;
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
      [dataFloor()],
      function(err, rows) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(rows || []));
      }
    );
    return;
  }

  if (req.method === "GET" && req.url === "/api/phase-stats") {
    db.get(
      "SELECT" +
      " AVG(power_delivered_l1_kw) as avg_l1, AVG(power_delivered_l2_kw) as avg_l2, AVG(power_delivered_l3_kw) as avg_l3," +
      " MAX(power_delivered_l1_kw) as max_l1, MAX(power_delivered_l2_kw) as max_l2, MAX(power_delivered_l3_kw) as max_l3" +
      " FROM readings" +
      " WHERE received_at >= ?" +
      " AND power_delivered_l1_kw IS NOT NULL",
      [effectiveCutoff(604800000)],
      function(err, row) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(row || {}));
      }
    );
    return;
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
      " MIN(voltage_l1) as min_v1, MAX(voltage_l1) as max_v1" +
      " FROM readings" +
      " WHERE date(received_at) = ?" +
      " AND power_delivered_total_kw IS NOT NULL",
      [todayAms()],
      function(err, row) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(row || {}));
      }
    );
    return;
  }

  if (req.method === "GET" && req.url === "/api/gas-daily") {
    db.all(
      "SELECT date(received_at) as day," +
      " MAX(gas_m3) - MIN(gas_m3) as gas_used" +
      " FROM readings" +
      " WHERE received_at >= ?" +
      " AND gas_m3 IS NOT NULL" +
      " GROUP BY date(received_at)" +
      " ORDER BY day ASC",
      [effectiveCutoff(2592000000)],
      function(err, rows) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(rows || []));
      }
    );
    return;
  }

  if (req.method === "GET" && req.url === "/api/day-comparison") {
    var days = [
      { key: "today",     date: dateAms(0) },
      { key: "yesterday", date: dateAms(-86400000) },
      { key: "lastweek",  date: dateAms(-7 * 86400000) }
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
    return;
  }

  if (req.method === "GET" && req.url === "/api/night-usage") {
    db.get(
      "SELECT AVG(power_delivered_total_kw) as night_avg, AVG(current_l1+current_l2+current_l3) as night_amp" +
      " FROM readings" +
      " WHERE strftime('%H', received_at) BETWEEN '00' AND '05'" +
      " AND received_at >= ?" +
      " AND power_delivered_total_kw IS NOT NULL",
      [effectiveCutoff(604800000)],
      function(err, row) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(row || {}));
      }
    );
    return;
  }

  if (req.method === "GET" && req.url === "/api/voltage-dips") {
    db.get(
      "SELECT COUNT(*) as dips, MIN(voltage_l1) as min_v, MAX(voltage_l1) as max_v," +
      " MAX(current_l1) as max_a1, MAX(current_l2) as max_a2, MAX(current_l3) as max_a3" +
      " FROM readings" +
      " WHERE received_at >= ?" +
      " AND (voltage_l1 < 207 OR voltage_l1 > 253 OR voltage_l2 < 207 OR voltage_l2 > 253 OR voltage_l3 < 207 OR voltage_l3 > 253)",
      [effectiveCutoff(604800000)],
      function(err, row) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(row || {}));
      }
    );
    return;
  }

  if (req.method === "GET" && req.url === "/api/weekday-avg") {
    db.all(
      "SELECT strftime('%w', received_at) as dow, AVG(power_delivered_total_kw) as avg_del" +
      " FROM readings" +
      " WHERE received_at >= ?" +
      " AND power_delivered_total_kw IS NOT NULL" +
      " GROUP BY dow ORDER BY dow",
      [effectiveCutoff(5184000000)],
      function(err, rows) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(rows || []));
      }
    );
    return;
  }

  if (req.method === "GET" && req.url.indexOf("/api/heatmap") === 0) {
    var hmQs = req.url.indexOf("?range=");
    var hmRange = hmQs !== -1 ? req.url.slice(hmQs + 7).split("&")[0] : "alltime";
    var hmWhere = "power_delivered_total_kw IS NOT NULL AND received_at >= ?";
    var hmParams = [];
    if (hmRange === "year")  { hmParams.push(effectiveCutoff(365*86400000)); }
    else if (hmRange === "month") { hmParams.push(effectiveCutoff(2592000000)); }
    else if (hmRange === "day")   { hmParams.push(effectiveCutoff(86400000)); }
    else { hmParams.push(dataFloor()); }
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
    return;
  }

  if (req.method === "GET" && req.url === "/api/gas-monthly") {
    db.all(
      "SELECT strftime('%Y-%m', received_at) as month, MAX(gas_m3)-MIN(gas_m3) as gas_used" +
      " FROM readings" +
      " WHERE gas_m3 IS NOT NULL AND received_at >= ?" +
      " GROUP BY month ORDER BY month ASC",
      [dataFloor()],
      function(err, rows) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(rows || []));
      }
    );
    return;
  }

  if (req.method === "GET" && req.url === "/api/costs-daily") {
    fetchPrices(function(err, prices) {
      if (err) { prices = {}; }
      var ep = prices.electricity_eur_kwh || null;
      var gp = prices.gas_eur_m3 || null;
      db.all(
        "SELECT date(received_at) as day," +
        " AVG(power_delivered_total_kw) as avg_kw," +
        " (julianday(MAX(received_at))-julianday(MIN(received_at)))*24 as hours," +
        " MAX(gas_m3)-MIN(gas_m3) as gas_used," +
        " COUNT(*) as n" +
        " FROM readings" +
        " WHERE received_at >= ? AND power_delivered_total_kw IS NOT NULL" +
        " GROUP BY day ORDER BY day ASC",
        [effectiveCutoff(2592000000)],
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
    return;
  }

  if (req.method === "GET" && req.url === "/api/debug/stats") {
    var dbPath = path.join(__dirname, "p1_data.db");
    var dbSize = 0;
    try { dbSize = fs.statSync(dbPath).size; } catch(e) {}
    db.get(
      "SELECT COUNT(*) as total, MIN(received_at) as first_entry, MAX(received_at) as last_entry," +
      " COUNT(DISTINCT date(received_at)) as days_with_data" +
      " FROM readings",
      function(err, row) {
        db.get(
          "SELECT COUNT(*) as today FROM readings WHERE date(received_at) = ?",
          [todayAms()],
          function(err2, today) {
            db.get(
              "SELECT COUNT(*) as last_hour FROM readings WHERE received_at >= ?",
              [cutoff(3600000)],
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
    return;
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
    return;
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
      [cutoff(5184000000), glMin],
      function(err, rows) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(rows || []));
      }
    );
    return;
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
      [cutoff(5184000000), cutoff(5184000000)],
      function(err, rows) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(rows || []));
      }
    );
    return;
  }

  if (req.method === "POST" && req.url === "/api/debug/set-old-data") {
    var body = "";
    req.on("data", function(c) { body += c; });
    req.on("end", function() {
      try { includeOldData = !!JSON.parse(body).value; } catch(e) {}
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ includeOldData: includeOldData }));
    });
    return;
  }

  if (req.method === "GET" && req.url === "/api/debug/old-data-setting") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ includeOldData: includeOldData, cutoffDate: DATA_CUTOFF }));
    return;
  }

  if (req.method === "GET" && req.url === "/debug") {
    var DEBUG_HTML = "<!DOCTYPE html><html lang='nl'><head>" +
      "<meta charset='UTF-8'><meta name='viewport' content='width=device-width,initial-scale=1'>" +
      "<title>VloedHub — Debug</title>" +
      "<link rel='preconnect' href='https://fonts.googleapis.com'>" +
      "<link href='https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap' rel='stylesheet'>" +
      "<style>" +
      "*{box-sizing:border-box;margin:0;padding:0}" +
      "body{font-family:'Poppins',system-ui,sans-serif;background:#0C0F1D;color:#F1F5F9;padding:1rem 1.25rem;min-height:100vh}" +
      "a{color:#A855F7;text-decoration:none;font-size:0.8rem}" +
      "h1{font-size:1.1rem;font-weight:600;margin-bottom:0.2rem}" +
      "h2{font-size:0.75rem;text-transform:uppercase;letter-spacing:0.08em;color:#3D4D6A;font-weight:600;margin:1.2rem 0 0.5rem}" +
      ".stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:0.5rem;margin-bottom:0.5rem}" +
      ".stat{background:#141728;border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:0.65rem 1rem}" +
      ".stat-label{font-size:0.58rem;text-transform:uppercase;color:#3D4D6A;letter-spacing:0.06em;font-weight:600;margin-bottom:0.25rem}" +
      ".stat-value{font-size:1.15rem;font-weight:700;color:#F1F5F9}" +
      ".stat-sub{font-size:0.62rem;color:#4A5880;margin-top:0.15rem}" +
      ".controls{display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.75rem}" +
      ".pill{background:transparent;border:1px solid rgba(255,255,255,0.1);color:#4A5880;border-radius:20px;padding:0.2rem 0.7rem;font-size:0.65rem;cursor:pointer;font-family:inherit;font-weight:500}" +
      ".pill.active{background:rgba(168,85,247,0.15);border-color:rgba(168,85,247,0.4);color:#C084FC}" +
      ".pill-green.active{background:rgba(34,197,94,0.15);border-color:rgba(34,197,94,0.4);color:#4ADE80}" +
      "input[type=text]{background:#141728;border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#F1F5F9;padding:0.25rem 0.6rem;font-size:0.72rem;font-family:inherit;width:220px;outline:none}" +
      "input[type=text]:focus{border-color:rgba(168,85,247,0.5)}" +
      ".table-wrap{overflow-x:auto;border-radius:12px;border:1px solid rgba(255,255,255,0.06);max-height:500px;overflow-y:auto}" +
      "table{width:100%;border-collapse:collapse;font-size:0.7rem}" +
      "thead th{position:sticky;top:0;background:#0C0F1D;text-align:left;padding:0.4rem 0.6rem;color:#3D4D6A;font-size:0.6rem;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;border-bottom:1px solid rgba(255,255,255,0.07);white-space:nowrap}" +
      "td{padding:0.28rem 0.6rem;border-bottom:1px solid rgba(255,255,255,0.03);color:#94A3B8;white-space:nowrap;font-variant-numeric:tabular-nums}" +
      "tr:last-child td{border-bottom:none}" +
      "tr:hover td{background:rgba(168,85,247,0.04)}" +
      ".del{color:#A855F7}.gas{color:#F97316}.volt{color:#38BDF8}" +
      ".gap-ok{color:#4ADE80}.gap-warn{color:#FBBF24}.gap-bad{color:#F87171}" +
      ".badge{display:inline-block;border-radius:4px;padding:0.05rem 0.35rem;font-size:0.6rem;font-weight:600}" +
      ".count{color:#3D4D6A;font-size:0.72rem;margin-left:0.5rem}" +
      ".header{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:1rem}" +
      "</style></head><body>" +
      "<div class='header'><div><h1>&#128736; VloedHub Debug</h1><span style='font-size:0.72rem;color:#3D4D6A'>Databasediagnose &amp; log-viewer</span></div><a href='/'>&#8592; Terug naar dashboard</a></div>" +

      "<div style='background:#141728;border:1px solid rgba(255,165,0,0.25);border-radius:12px;padding:0.75rem 1rem;margin-bottom:1rem;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem'>" +
      "<div>" +
      "<div style='font-size:0.65rem;text-transform:uppercase;color:#F97316;letter-spacing:0.07em;font-weight:600;margin-bottom:0.25rem'>&#9888; Data vóór 27-08-2026</div>" +
      "<div style='font-size:0.72rem;color:#94A3B8'>Data voor deze datum is onvolledig (app draaide niet altijd). Standaard wordt deze data uitgesloten.</div>" +
      "</div>" +
      "<div style='display:flex;align-items:center;gap:0.6rem'>" +
      "<span style='font-size:0.65rem;color:#4A5880' id='old-data-label'>Uitgesloten</span>" +
      "<button id='old-data-toggle' onclick='toggleOldData()' style='position:relative;width:44px;height:24px;border-radius:12px;border:none;cursor:pointer;background:#3D4D6A;transition:background 0.2s'>" +
      "<span id='old-data-knob' style='position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:left 0.2s'></span>" +
      "</button>" +
      "</div></div>" +

      "<h2>Database statistieken</h2>" +
      "<div class='stats-grid' id='stats-grid'><div class='stat'><div class='stat-label'>Laden…</div></div></div>" +

      "<h2>Connectiviteit per dag <span class='count' id='gaps-count'></span></h2>" +
      "<div class='table-wrap'>" +
      "<table><thead><tr><th>Datum</th><th>Metingen</th><th>Eerste meting</th><th>Laatste meting</th><th>Duur (min)</th><th>Gaten (&gt;2m)</th><th>Grootste gat</th><th>Gat tijdspan</th><th>Status</th></tr></thead>" +
      "<tbody id='gaps-body'><tr><td colspan='9' style='color:#3D4D6A;padding:0.5rem'>Laden…</td></tr></tbody></table></div>" +

      "<h2>Gaten detail <span class='count' id='gap-list-count'></span></h2>" +
      "<div class='controls'>" +
      "<span style='font-size:0.65rem;color:#4A5880'>Minimale gap:</span>" +
      "<button class='pill' onclick='loadGapList(1,this)'>1 min</button>" +
      "<button class='pill active' onclick='loadGapList(5,this)'>5 min</button>" +
      "<button class='pill' onclick='loadGapList(15,this)'>15 min</button>" +
      "<button class='pill' onclick='loadGapList(60,this)'>1 uur</button>" +
      "</div>" +
      "<div class='table-wrap'>" +
      "<table><thead><tr><th>Datum</th><th>Van</th><th>Tot</th><th>Duur (min)</th></tr></thead>" +
      "<tbody id='gap-list-body'><tr><td colspan='4' style='color:#3D4D6A;padding:0.5rem'>Laden…</td></tr></tbody></table></div>" +

      "<h2>Log-viewer <span class='count' id='logs-count'></span></h2>" +
      "<div class='controls'>" +
      "<span style='font-size:0.65rem;color:#4A5880'>Toon laatste:</span>" +
      "<button class='pill active' onclick='setLimit(50,this)'>50</button>" +
      "<button class='pill' onclick='setLimit(100,this)'>100</button>" +
      "<button class='pill' onclick='setLimit(500,this)'>500</button>" +
      "<button class='pill' onclick='setLimit(1000,this)'>1000</button>" +
      "<button class='pill' onclick='setLimit(0,this)'>Alles</button>" +
      "<input type='text' id='search' placeholder='Filter op tijd, waarde…' oninput='applyFilter()'>" +
      "<button class='pill pill-green active' onclick='toggleLive(this)' id='live-btn'>&#9679; Live</button>" +
      "</div>" +
      "<div class='table-wrap'>" +
      "<table><thead><tr><th>#</th><th>Tijd</th><th>Verbruik (kW)</th><th>L1</th><th>L2</th><th>L3</th><th>Gas (m&#179;)</th><th>V-L1</th><th>V-L2</th><th>V-L3</th><th>A-L1</th><th>A-L2</th><th>A-L3</th><th>Apparaat</th></tr></thead>" +
      "<tbody id='logs-body'><tr><td colspan='14' style='color:#3D4D6A;padding:0.5rem'>Laden…</td></tr></tbody></table></div>" +

      "<script>" +
      "var currentLimit=50, liveEnabled=true, liveTimer=null, allRows=[], filterStr='';" +
      "function applyOldDataState(enabled){" +
      "var btn=document.getElementById('old-data-toggle');" +
      "var knob=document.getElementById('old-data-knob');" +
      "var lbl=document.getElementById('old-data-label');" +
      "btn.style.background=enabled?'#A855F7':'#3D4D6A';" +
      "knob.style.left=enabled?'23px':'3px';" +
      "lbl.textContent=enabled?'Inbegrepen':'Uitgesloten';" +
      "lbl.style.color=enabled?'#C084FC':'#4A5880';}" +
      "function toggleOldData(){" +
      "fetch('/api/debug/old-data-setting').then(r=>r.json()).then(function(s){" +
      "return fetch('/api/debug/set-old-data',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({value:!s.includeOldData})});" +
      "}).then(r=>r.json()).then(function(s){applyOldDataState(s.includeOldData);loadStats();loadGaps();}).catch(function(){});}" +
      "fetch('/api/debug/old-data-setting').then(r=>r.json()).then(function(s){applyOldDataState(s.includeOldData);}).catch(function(){});" +
      "function n(v,d){return v!=null?Number(v).toFixed(d!=null?d:3):'—';}" +
      "function loadStats(){fetch('/api/debug/stats').then(r=>r.json()).then(function(s){" +
      "document.getElementById('stats-grid').innerHTML=" +
      "'<div class=\\'stat\\'><div class=\\'stat-label\\'>Totaal logs</div><div class=\\'stat-value\\'>'+s.total.toLocaleString()+'</div></div>'" +
      "+'<div class=\\'stat\\'><div class=\\'stat-label\\'>Eerste meting</div><div class=\\'stat-value\\' style=\\'font-size:0.75rem\\'>'+( s.first_entry ? new Date(s.first_entry).toLocaleString('nl-NL',{hour12:false}) : '—')+'</div></div>'" +
      "+'<div class=\\'stat\\'><div class=\\'stat-label\\'>Laatste meting</div><div class=\\'stat-value\\' style=\\'font-size:0.75rem\\'>'+( s.last_entry ? new Date(s.last_entry).toLocaleString('nl-NL',{hour12:false}) : '—')+'</div></div>'" +
      "+'<div class=\\'stat\\'><div class=\\'stat-label\\'>Dagen met data</div><div class=\\'stat-value\\'>'+s.days_with_data+'</div></div>'" +
      "+'<div class=\\'stat\\'><div class=\\'stat-label\\'>Vandaag</div><div class=\\'stat-value\\'>'+s.today.toLocaleString()+'</div><div class=\\'stat-sub\\'>Afgelopen uur: '+s.last_hour+'</div></div>'" +
      "+'<div class=\\'stat\\'><div class=\\'stat-label\\'>Gem. per dag</div><div class=\\'stat-value\\'>'+(s.avg_per_day?Math.round(s.avg_per_day).toLocaleString():'—')+'</div></div>'" +
      "+'<div class=\\'stat\\'><div class=\\'stat-label\\'>Database grootte</div><div class=\\'stat-value\\'>'+s.db_size_mb+' MB</div></div>';" +
      "}).catch(function(){});}" +

      "function loadGaps(){fetch('/api/debug/gaps').then(r=>r.json()).then(function(rows){" +
      "document.getElementById('gaps-count').textContent='('+rows.length+' dagen)';" +
      "document.getElementById('gaps-body').innerHTML=rows.map(function(r){" +
      "var status,cls;if(r.n<10){status='Weinig data';cls='gap-bad';}else if(r.span_min<1380){status='Gaten';cls='gap-warn';}else{status='OK';cls='gap-ok';}" +
      "var gapCls=r.max_gap_min>60?'gap-bad':r.max_gap_min>10?'gap-warn':'gap-ok';" +
      "var gapSpan=r.biggest_gap_start&&r.biggest_gap_end?r.biggest_gap_start+' – '+r.biggest_gap_end:'—';" +
      "var tOpts={hour12:false};" +
      "return '<tr><td>'+r.day+'</td><td>'+r.n.toLocaleString()+'</td><td>'+(r.first?new Date(r.first).toLocaleTimeString('nl-NL',tOpts):'—')+'</td><td>'+(r.last?new Date(r.last).toLocaleTimeString('nl-NL',tOpts):'—')+'</td><td>'+(r.span_min||0)+'</td><td>'+(r.gap_count||0)+'</td><td class=\\''+gapCls+'\\'>'+( r.max_gap_min?r.max_gap_min+' min':'—')+'</td><td style=\\'color:#94A3B8\\'>'+gapSpan+'</td><td class=\\''+cls+'\\'><b>'+status+'</b></td></tr>';" +
      "}).join('');}).catch(function(){});}" +

      "var currentGapMin=5;" +
      "function loadGapList(min,btn){currentGapMin=min;" +
      "document.querySelectorAll('.controls .pill').forEach(function(b){if(['1 min','5 min','15 min','1 uur'].includes(b.textContent))b.classList.remove('active');});" +
      "if(btn)btn.classList.add('active');" +
      "fetch('/api/debug/gap-list?min='+min).then(r=>r.json()).then(function(rows){" +
      "document.getElementById('gap-list-count').textContent='('+rows.length+' gaten)';" +
      "document.getElementById('gap-list-body').innerHTML=rows.length?rows.map(function(r){" +
      "var cls=r.gap_min>60?'gap-bad':r.gap_min>10?'gap-warn':'gap-ok';" +
      "return '<tr><td>'+r.day+'</td><td>'+r.gap_start+'</td><td>'+r.gap_end+'</td><td class=\\''+cls+'\\'>'+r.gap_min+'</td></tr>';" +
      "}).join(''):'<tr><td colspan=\\'4\\' style=\\'color:#4ADE80;padding:0.5rem\\'>Geen gaten gevonden ✓</td></tr>';" +
      "}).catch(function(){});}" +

      "function loadLogs(){fetch('/api/debug/logs?limit='+currentLimit).then(r=>r.json()).then(function(rows){" +
      "allRows=rows;document.getElementById('logs-count').textContent=currentLimit===0?'('+rows.length+' — alle rijen)':'('+rows.length+' van '+currentLimit+' gevraagd)';" +
      "applyFilter();" +
      "}).catch(function(){});}" +

      "function applyFilter(){" +
      "filterStr=document.getElementById('search').value.toLowerCase();" +
      "var rows=filterStr?allRows.filter(function(r){return JSON.stringify(r).toLowerCase().includes(filterStr);}):allRows;" +
      "document.getElementById('logs-body').innerHTML=rows.map(function(r){" +
      "return '<tr><td style=\\'color:#3D4D6A\\'>'+r.id+'</td><td>'+new Date(r.received_at).toLocaleString('nl-NL',{hour12:false})+'</td>'" +
      "+'<td class=\\'del\\'>'+n(r.power_delivered_total_kw)+'</td>'" +
      "+'<td class=\\'del\\'>'+n(r.power_delivered_l1_kw)+'</td>'" +
      "+'<td class=\\'del\\'>'+n(r.power_delivered_l2_kw)+'</td>'" +
      "+'<td class=\\'del\\'>'+n(r.power_delivered_l3_kw)+'</td>'" +
      "+'<td class=\\'gas\\'>'+n(r.gas_m3)+'</td>'" +
      "+'<td class=\\'volt\\'>'+n(r.voltage_l1,1)+'</td>'" +
      "+'<td class=\\'volt\\'>'+n(r.voltage_l2,1)+'</td>'" +
      "+'<td class=\\'volt\\'>'+n(r.voltage_l3,1)+'</td>'" +
      "+'<td>'+n(r.current_l1,0)+'</td>'" +
      "+'<td>'+n(r.current_l2,0)+'</td>'" +
      "+'<td>'+n(r.current_l3,0)+'</td>'" +
      "+'<td style=\\'color:#3D4D6A\\'>'+( r.device||'—')+'</td></tr>';" +
      "}).join('');}" +

      "function setLimit(n,btn){currentLimit=n;document.querySelectorAll('.pill').forEach(function(b){if(['50','100','500','1000','Alles'].includes(b.textContent))b.classList.remove('active');});btn.classList.add('active');if(n===0&&liveEnabled){var lb=document.getElementById('live-btn');liveEnabled=false;lb.textContent='\\u25CB Paused';lb.classList.remove('active');clearInterval(liveTimer);}loadLogs();}" +
      "function toggleLive(btn){liveEnabled=!liveEnabled;btn.textContent=liveEnabled?'\\u25CF Live':'\\u25CB Paused';btn.classList.toggle('active',liveEnabled);if(liveEnabled)startLive();else{clearInterval(liveTimer);}}" +
      "function startLive(){liveTimer=setInterval(function(){loadStats();loadLogs();},5000);}" +

      "loadStats();loadGaps();loadGapList(5,document.querySelector('.controls .pill.active'));loadLogs();startLive();" +
      "</script></body></html>";
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(DEBUG_HTML);
    return;
  }

  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(HTML);
    return;
  }

  if (req.method === "GET" && req.url === "/api/network-info") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ lan: LOCAL_IP, wan: WAN_IP }));
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, "0.0.0.0", function() {
  console.log("Server listening on http://0.0.0.0:" + PORT);
});

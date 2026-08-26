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
var sqlite3 = require("sqlite3");

var priceCache = { data: null, fetchedAt: 0 };

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
});

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

var HTML = "<!DOCTYPE html>\n" +
"<html lang=\"en\">\n" +
"<head>\n" +
"  <meta charset=\"UTF-8\" />\n" +
"  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />\n" +
"  <title>VloedHub \u2014 P1 Live</title>\n" +
"  <link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n" +
"  <link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>\n" +
"  <link href=\"https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap\" rel=\"stylesheet\">\n" +
"  <style>\n" +
"    * { box-sizing: border-box; margin: 0; padding: 0; }\n" +
"    html, body { margin: 0; }\n" +
"    body { font-family: 'Poppins', system-ui, sans-serif; background: #0C0F1D; color: #F1F5F9; padding: 0.6rem 0.75rem; display: flex; flex-direction: column; gap: 0.35rem; min-height: 100vh; overflow-y: auto; }\n" +
"    .header { display: flex; align-items: baseline; justify-content: space-between; }\n" +
"    h1 { font-size: 1.2rem; font-weight: 600; letter-spacing: -0.01em; }\n" +
"    .updated { color: #3D4D6A; font-size: 0.75rem; }\n" +
"    .section-title { font-size: 0.6rem; text-transform: uppercase; color: #3D4D6A; letter-spacing: 0.1em; font-weight: 600; margin-bottom: 0.35rem; }\n" +
"    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: 0.5rem; }\n" +
"    .cards-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem; }\n" +
"    .cards-6 { display: grid; grid-template-columns: repeat(6, 1fr); gap: 0.5rem; }\n" +
"    .card { background: #141728; border: 1px solid rgba(255,255,255,0.06); border-radius: 14px; padding: 0.75rem 1rem; }\n" +
"    .card-label { font-size: 0.62rem; text-transform: uppercase; color: #4A5880; letter-spacing: 0.06em; margin-bottom: 0.3rem; font-weight: 500; }\n" +
"    .card-value { font-size: 2rem; font-weight: 700; letter-spacing: -0.02em; }\n" +
"    .card-value.small { font-size: clamp(1rem, 2.2vw, 1.4rem); }\n" +
"    .card-unit { font-size: 0.65rem; color: #4A5880; margin-left: 0.15rem; font-weight: 400; }\n" +
"    .delivered { color: #A855F7; }\n" +
"    .returned { color: #22C55E; }\n" +
"    .gas { color: #F97316; }\n" +
"    .voltage { color: #38BDF8; }\n" +
"    .top-section { flex: 0 0 50%; min-height: 0; overflow: hidden; display: flex; flex-direction: column; gap: 0.35rem; }\n" +
"    .cost-table { width: 100%; border-collapse: collapse; font-size: 0.72rem; }\n" +
"    .cost-table th { text-align: left; padding: 0.2rem 0.5rem; color: #3D4D6A; font-weight: 600; border-bottom: 1px solid rgba(255,255,255,0.05); }\n" +
"    .cost-table td { padding: 0.2rem 0.5rem; color: #94A3B8; border-bottom: 1px solid rgba(255,255,255,0.03); }\n" +
"    .cost-table tr:last-child td { border-bottom: none; }\n" +
"    .cost-table .num { text-align: right; font-variant-numeric: tabular-nums; }\n" +
"    .cost-wrap { background: #141728; border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; padding: 0.4rem 0.2rem; }\n" +
"    .bottom-row { flex-shrink: 0; min-height: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }\n" +
"    .bottom-col { display: flex; flex-direction: column; min-height: 0; }\n" +
"    .chart-card { background: #141728; border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; padding: 0.6rem; flex: 1; min-height: 0; display: flex; flex-direction: column; }\n" +
"    .chart-wrap { position: relative; flex: 1; min-height: 0; }\n" +
"    .tab-bar { display: flex; gap: 0.35rem; margin-bottom: 0.5rem; }\n" +
"    .tab { background: transparent; border: 1px solid rgba(255,255,255,0.08); color: #4A5880; border-radius: 20px; padding: 0.18rem 0.65rem; font-size: 0.65rem; cursor: pointer; font-family: 'Poppins', system-ui, sans-serif; font-weight: 500; }\n" +
"    .tab.active { background: rgba(168,85,247,0.15); border-color: rgba(168,85,247,0.4); color: #C084FC; }\n" +
"    .log-wrap { flex: 1; min-height: 0; overflow-y: auto; overflow-x: auto; border-radius: 12px; border: 1px solid rgba(255,255,255,0.06); }\n" +
"    table { width: 100%; border-collapse: collapse; font-size: 0.75rem; }\n" +
"    thead th { position: sticky; top: 0; background: #141728; z-index: 1; }\n" +
"    th { text-align: left; padding: 0.35rem 0.6rem; color: #3D4D6A; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; }\n" +
"    td { padding: 0.3rem 0.6rem; border-bottom: 1px solid rgba(255,255,255,0.03); color: #94A3B8; white-space: nowrap; }\n" +
"    tr:last-child td { border-bottom: none; }\n" +
"    .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #22C55E; margin-right: 0.4rem; animation: pulse 2s infinite; }\n" +
"    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }\n" +
"    /* Hero cards */\n" +
"    .hero { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem; flex-shrink: 0; }\n" +
"    .hero-card { background: #141728; border: 1px solid rgba(255,255,255,0.06); border-radius: 14px; overflow: hidden; display: flex; flex-direction: column; }\n" +
"    .accent-bar { height: 3px; width: 100%; }\n" +
"    .delivered-bar { background: linear-gradient(90deg,#A855F7,#C084FC); }\n" +
"    .returned-bar { background: linear-gradient(90deg,#22C55E,#4ADE80); }\n" +
"    .gas-bar { background: linear-gradient(90deg,#F97316,#FB923C); }\n" +
"    .hero-content { padding: 0.9rem 1.1rem; flex: 1; display: flex; flex-direction: column; justify-content: center; }\n" +
"    .hero-label { font-size: 0.6rem; text-transform: uppercase; color: #4A5880; letter-spacing: 0.1em; font-weight: 600; margin-bottom: 0.4rem; }\n" +
"    .hero-value { font-size: clamp(1.5rem, 2.8vw, 2.4rem); font-weight: 700; letter-spacing: -0.03em; line-height: 1; }\n" +
"    .hero-value .card-unit { font-size: 0.85rem; color: #4A5880; font-weight: 400; margin-left: 0.2rem; vertical-align: middle; }\n" +
"    .hero-sub { margin-top: 0.5rem; font-size: 0.7rem; color: #4A5880; }\n" +
"    .hero-sub .card-unit { font-size: 0.65rem; }\n" +
"    /* Middle row */\n" +
"    .middle { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; flex-shrink: 0; }\n" +
"    .phases-block { background: #141728; border: 1px solid rgba(255,255,255,0.06); border-radius: 14px; padding: 0.65rem 1rem; }\n" +
"    .costs-block { background: #141728; border: 1px solid rgba(255,255,255,0.06); border-radius: 14px; padding: 0.65rem 1rem; display: flex; flex-direction: column; }\n" +
"    .phase-table { width: 100%; border-collapse: collapse; font-size: 0.74rem; }\n" +
"    .phase-table th { text-align: center; padding: 0.15rem 0.4rem 0.3rem; color: #3D4D6A; font-size: 0.58rem; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; border-bottom: 1px solid rgba(255,255,255,0.05); }\n" +
"    .phase-table th:first-child { text-align: left; width: 5.5rem; }\n" +
"    .phase-table td { padding: 0.25rem 0.4rem; text-align: center; font-variant-numeric: tabular-nums; border-bottom: 1px solid rgba(255,255,255,0.03); color: #94A3B8; }\n" +
"    .phase-table td:first-child { text-align: left; color: #3D4D6A; font-size: 0.58rem; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; }\n" +
"    .phase-table tr:last-child td { border-bottom: none; }\n" +
"    .phase-table .card-unit { font-size: 0.58rem; color: #3D4D6A; margin-left: 0.1rem; }\n" +
"    /* Stats strip */\n" +
"    .stats-strip { display: grid; grid-template-columns: repeat(6, 1fr); gap: 0.5rem; }\n" +
"    .stat-card { background: #141728; border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; padding: 0.6rem 0.85rem; }\n" +
"    .stat-label { font-size: 0.58rem; text-transform: uppercase; color: #3D4D6A; letter-spacing: 0.06em; font-weight: 600; margin-bottom: 0.3rem; }\n" +
"    .stat-value { font-size: 1.1rem; font-weight: 700; letter-spacing: -0.02em; }\n" +
"    .stat-unit { font-size: 0.6rem; color: #4A5880; margin-left: 0.1rem; }\n" +
"    /* Charts grid */\n" +
"    .charts-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }\n" +
"    .chart-block { background: #141728; border: 1px solid rgba(255,255,255,0.06); border-radius: 14px; padding: 0.75rem 1rem; display: flex; flex-direction: column; min-height: 240px; }\n" +
"    .chart-block-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem; }\n" +
"    .chart-block-title { font-size: 0.6rem; text-transform: uppercase; color: #3D4D6A; letter-spacing: 0.1em; font-weight: 600; }\n" +
"    /* Day comparison */\n" +
"    .compare-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem; }\n" +
"    .compare-card { background: #141728; border: 1px solid rgba(255,255,255,0.06); border-radius: 14px; padding: 0.7rem 1rem; }\n" +
"    .compare-title { font-size: 0.58rem; text-transform: uppercase; color: #3D4D6A; letter-spacing: 0.08em; font-weight: 600; margin-bottom: 0.5rem; }\n" +
"    .compare-row-item { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 0.2rem; }\n" +
"    .compare-label { font-size: 0.65rem; color: #4A5880; }\n" +
"    .compare-value { font-size: 0.85rem; font-weight: 600; color: #F1F5F9; font-variant-numeric: tabular-nums; }\n" +
"    .delta-up { color: #F87171; font-size: 0.65rem; margin-left: 0.3rem; }\n" +
"    .delta-down { color: #4ADE80; font-size: 0.65rem; margin-left: 0.3rem; }\n" +
"    .delta-same { color: #3D4D6A; font-size: 0.65rem; margin-left: 0.3rem; }\n" +
"    /* Safety / voltage section */\n" +
"    .safety-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.5rem; }\n" +
"    .safety-card { background: #141728; border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; padding: 0.6rem 0.85rem; }\n" +
"    /* Cheap hours */\n" +
"    .cheap-hours-grid { display: flex; flex-wrap: wrap; gap: 0.3rem; margin-top: 0.4rem; }\n" +
"    .hour-pill { font-size: 0.62rem; font-weight: 600; border-radius: 20px; padding: 0.15rem 0.5rem; }\n" +
"    .hour-cheap { background: rgba(34,197,94,0.15); color: #4ADE80; border: 1px solid rgba(34,197,94,0.3); }\n" +
"    .hour-mid { background: rgba(251,191,36,0.12); color: #FDE68A; border: 1px solid rgba(251,191,36,0.25); }\n" +
"    .hour-exp { background: rgba(248,113,113,0.1); color: #FCA5A5; border: 1px solid rgba(248,113,113,0.2); }\n" +
"    /* Heatmap */\n" +
"    .heatmap-wrap { overflow-x: auto; margin-top: 0.4rem; }\n" +
"    .heatmap { display: grid; grid-template-columns: 2rem repeat(24, 1fr); gap: 2px; font-size: 0.5rem; }\n" +
"    .hm-label { color: #3D4D6A; display: flex; align-items: center; justify-content: flex-end; padding-right: 4px; font-weight: 600; }\n" +
"    .hm-hour-label { color: #3D4D6A; text-align: center; padding-bottom: 2px; }\n" +
"    .hm-cell { height: 18px; border-radius: 2px; cursor: default; }\n" +
"    @media (max-width: 640px) { .hero { grid-template-columns: 1fr; } .middle { grid-template-columns: 1fr; } .stats-strip { grid-template-columns: repeat(3, 1fr); } .charts-grid { grid-template-columns: 1fr; } .bottom-row { grid-template-columns: 1fr; } .compare-row { grid-template-columns: 1fr; } .safety-row { grid-template-columns: repeat(2, 1fr); } }\n" +
"  </style>\n" +
"  <script src=\"https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js\"></script>\n" +
"</head>\n" +
"<body>\n" +
"  <div class=\"header\">\n" +
"    <h1><span class=\"dot\"></span>VloedHub</h1>\n" +
"    <div style=\"display:flex;align-items:center;gap:1rem\">\n" +
"      <span class=\"updated\" id=\"updated\">Wachten op data\u2026</span>\n" +
"      <a href=\"/debug\" style=\"font-size:0.62rem;color:#3D4D6A;text-decoration:none;border:1px solid rgba(255,255,255,0.07);border-radius:20px;padding:0.15rem 0.55rem\" title=\"Debug pagina\">&#128736; Debug</a>\n" +
"    </div>\n" +
"  </div>\n" +
"\n" +
"  <div class=\"hero\">\n" +
"    <div class=\"hero-card\">\n" +
"      <div class=\"accent-bar delivered-bar\"></div>\n" +
"      <div class=\"hero-content\">\n" +
"        <div class=\"hero-label\">Verbruik</div>\n" +
"        <div class=\"hero-value delivered\" id=\"del-total\">\u2014<span class=\"card-unit\">kW</span></div>\n" +
"        <div class=\"hero-sub\" id=\"price-elec\">\u2014 <span class=\"card-unit\">\u20ac/kWh</span></div>\n" +
"      </div>\n" +
"    </div>\n" +
"    <div class=\"hero-card\">\n" +
"      <div class=\"accent-bar\" style=\"background:linear-gradient(90deg,#FBBF24,#FDE68A)\"></div>\n" +
"      <div class=\"hero-content\">\n" +
"        <div class=\"hero-label\">Kosten vandaag</div>\n" +
"        <div class=\"hero-value\" style=\"color:#FBBF24\" id=\"hero-cost-today\">\u2014<span class=\"card-unit\">\u20ac</span></div>\n" +
"        <div class=\"hero-sub\">Stroom + gas</div>\n" +
"      </div>\n" +
"    </div>\n" +
"    <div class=\"hero-card\">\n" +
"      <div class=\"accent-bar gas-bar\"></div>\n" +
"      <div class=\"hero-content\">\n" +
"        <div class=\"hero-label\">Gas</div>\n" +
"        <div class=\"hero-value gas\" id=\"gas\">\u2014<span class=\"card-unit\">m\u00b3</span></div>\n" +
"        <div class=\"hero-sub\" id=\"price-gas\">\u2014 <span class=\"card-unit\">\u20ac/m\u00b3</span></div>\n" +
"      </div>\n" +
"    </div>\n" +
"  </div>\n" +
"\n" +
"  <div class=\"middle\">\n" +
"    <div class=\"phases-block\">\n" +
"      <p class=\"section-title\">Per fase</p>\n" +
"      <table class=\"phase-table\">\n" +
"        <thead><tr><th></th><th>L1</th><th>L2</th><th>L3</th></tr></thead>\n" +
"        <tbody>\n" +
"          <tr>\n" +
"            <td>Verbruik</td>\n" +
"            <td class=\"delivered\" id=\"del-l1\">\u2014<span class=\"card-unit\">kW</span></td>\n" +
"            <td class=\"delivered\" id=\"del-l2\">\u2014<span class=\"card-unit\">kW</span></td>\n" +
"            <td class=\"delivered\" id=\"del-l3\">\u2014<span class=\"card-unit\">kW</span></td>\n" +
"          </tr>\n" +
"          <tr>\n" +
"            <td>Spanning</td>\n" +
"            <td class=\"voltage\" id=\"v-l1\">\u2014<span class=\"card-unit\">V</span></td>\n" +
"            <td class=\"voltage\" id=\"v-l2\">\u2014<span class=\"card-unit\">V</span></td>\n" +
"            <td class=\"voltage\" id=\"v-l3\">\u2014<span class=\"card-unit\">V</span></td>\n" +
"          </tr>\n" +
"          <tr>\n" +
"            <td>Stroom</td>\n" +
"            <td id=\"a-l1\">\u2014<span class=\"card-unit\">A</span></td>\n" +
"            <td id=\"a-l2\">\u2014<span class=\"card-unit\">A</span></td>\n" +
"            <td id=\"a-l3\">\u2014<span class=\"card-unit\">A</span></td>\n" +
"          </tr>\n" +
"        </tbody>\n" +
"      </table>\n" +
"    </div>\n" +
"    <div class=\"costs-block\">\n" +
"      <p class=\"section-title\">Geschatte kosten <span style=\"color:#2A3550;font-weight:400\">(stroom = huidig uur \u00b7 gas = vandaag)</span></p>\n" +
"      <div class=\"cost-wrap\" style=\"flex:1\">\n" +
"        <table class=\"cost-table\">\n" +
"          <thead><tr><th>Periode</th><th class=\"num\">Stroom (kWh)</th><th class=\"num\">Stroom \u20ac</th><th class=\"num\">Gas (m\u00b3)</th><th class=\"num\">Gas \u20ac</th></tr></thead>\n" +
"          <tbody id=\"cost-rows\"><tr><td colspan=\"5\" style=\"color:#3D4D6A;padding:0.3rem 0.5rem\">Laden\u2026</td></tr></tbody>\n" +
"        </table>\n" +
"      </div>\n" +
"    </div>\n" +
"  </div>\n" +
"\n" +
"  <!-- Day comparison -->\n" +
"  <div class=\"compare-row\">\n" +
"    <div class=\"compare-card\">\n" +
"      <div class=\"compare-title\">Vandaag</div>\n" +
"      <div class=\"compare-row-item\"><span class=\"compare-label\">Stroom</span><span class=\"compare-value\" id=\"cmp-today-elec\">\u2014</span></div>\n" +
"      <div class=\"compare-row-item\"><span class=\"compare-label\">Gas</span><span class=\"compare-value\" id=\"cmp-today-gas\">\u2014</span></div>\n" +
"      <div class=\"compare-row-item\"><span class=\"compare-label\">Verwacht totaal</span><span class=\"compare-value\" id=\"cmp-today-exp\" style=\"color:#FBBF24\">\u2014</span></div>\n" +
"    </div>\n" +
"    <div class=\"compare-card\">\n" +
"      <div class=\"compare-title\">Gisteren</div>\n" +
"      <div class=\"compare-row-item\"><span class=\"compare-label\">Stroom</span><span class=\"compare-value\" id=\"cmp-yest-elec\">\u2014</span></div>\n" +
"      <div class=\"compare-row-item\"><span class=\"compare-label\">Gas</span><span class=\"compare-value\" id=\"cmp-yest-gas\">\u2014</span></div>\n" +
"    </div>\n" +
"    <div class=\"compare-card\">\n" +
"      <div class=\"compare-title\">Vorige week zelfde dag</div>\n" +
"      <div class=\"compare-row-item\"><span class=\"compare-label\">Stroom</span><span class=\"compare-value\" id=\"cmp-week-elec\">\u2014</span></div>\n" +
"      <div class=\"compare-row-item\"><span class=\"compare-label\">Gas</span><span class=\"compare-value\" id=\"cmp-week-gas\">\u2014</span></div>\n" +
"    </div>\n" +
"  </div>\n" +
"\n" +
"  <!-- Stats strip -->\n" +
"  <div class=\"stats-strip\">\n" +
"    <div class=\"stat-card\">\n" +
"      <div class=\"stat-label\">Gem. verbruik vandaag</div>\n" +
"      <div class=\"stat-value delivered\" id=\"stat-avg-del\">\u2014<span class=\"stat-unit\">kW</span></div>\n" +
"    </div>\n" +
"    <div class=\"stat-card\">\n" +
"      <div class=\"stat-label\">Piekverbruik vandaag</div>\n" +
"      <div class=\"stat-value delivered\" id=\"stat-max-del\">\u2014<span class=\"stat-unit\">kW</span></div>\n" +
"    </div>\n" +
"    <div class=\"stat-card\">\n" +
"      <div class=\"stat-label\">Gem. spanning</div>\n" +
"      <div class=\"stat-value voltage\" id=\"stat-avg-v\">\u2014<span class=\"stat-unit\">V</span></div>\n" +
"    </div>\n" +
"    <div class=\"stat-card\">\n" +
"      <div class=\"stat-label\">Meest actieve fase</div>\n" +
"      <div class=\"stat-value voltage\" id=\"stat-top-phase\">\u2014</div>\n" +
"    </div>\n" +
"    <div class=\"stat-card\">\n" +
"      <div class=\"stat-label\">Spanning (min\u2013max)</div>\n" +
"      <div class=\"stat-value\" id=\"stat-voltage-range\">\u2014<span class=\"stat-unit\">V</span></div>\n" +
"    </div>\n" +
"    <div class=\"stat-card\">\n" +
"      <div class=\"stat-label\">Metingen vandaag</div>\n" +
"      <div class=\"stat-value\" id=\"stat-readings\">\u2014</div>\n" +
"    </div>\n" +
"  </div>\n" +
"\n" +
"  <!-- Safety / voltage -->\n" +
"  <div class=\"safety-row\">\n" +
"    <div class=\"safety-card\">\n" +
"      <div class=\"stat-label\">Spanningsdips (7 dgn)</div>\n" +
"      <div class=\"stat-value\" id=\"saf-dips\" style=\"color:#F87171\">\u2014</div>\n" +
"    </div>\n" +
"    <div class=\"safety-card\">\n" +
"      <div class=\"stat-label\">Max. stroom L1 / L2 / L3</div>\n" +
"      <div class=\"stat-value voltage\" id=\"saf-max-amp\">\u2014</div>\n" +
"    </div>\n" +
"    <div class=\"safety-card\">\n" +
"      <div class=\"stat-label\">Nachtverbruik standby</div>\n" +
"      <div class=\"stat-value\" id=\"saf-night\" style=\"color:#A855F7\">\u2014<span class=\"stat-unit\">kW</span></div>\n" +
"    </div>\n" +
"    <div class=\"safety-card\">\n" +
"      <div class=\"stat-label\">CO\u2082 vandaag (est.)</div>\n" +
"      <div class=\"stat-value\" id=\"saf-co2\" style=\"color:#94A3B8\">\u2014<span class=\"stat-unit\">kg</span></div>\n" +
"    </div>\n" +
"  </div>\n" +
"\n" +
"  <!-- Charts grid 2x2 -->\n" +
"  <div class=\"charts-grid\">\n" +
"    <!-- Elektra verloop (existing line chart) -->\n" +
"    <div class=\"chart-block\">\n" +
"      <div class=\"chart-block-header\">\n" +
"        <span class=\"chart-block-title\">Elektra verloop</span>\n" +
"        <div class=\"tab-bar\" style=\"margin-bottom:0\">\n" +
"          <button class=\"tab active\" data-range=\"day\" onclick=\"loadChart('day',this)\">Dag</button>\n" +
"          <button class=\"tab\" data-range=\"week\" onclick=\"loadChart('week',this)\">Week</button>\n" +
"          <button class=\"tab\" data-range=\"month\" onclick=\"loadChart('month',this)\">Maand</button>\n" +
"        </div>\n" +
"      </div>\n" +
"      <div class=\"chart-wrap\"><canvas id=\"chart\"></canvas></div>\n" +
"    </div>\n" +
"\n" +
"    <!-- Piekuren staafdiagram -->\n" +
"    <div class=\"chart-block\">\n" +
"      <div class=\"chart-block-header\">\n" +
"        <span class=\"chart-block-title\">Piekuren (gem. per uur, alle data)</span>\n" +
"      </div>\n" +
"      <div class=\"chart-wrap\"><canvas id=\"chart-peaks\"></canvas></div>\n" +
"    </div>\n" +
"\n" +
"    <!-- Faseverdeling horizontale bar -->\n" +
"    <div class=\"chart-block\">\n" +
"      <div class=\"chart-block-header\">\n" +
"        <span class=\"chart-block-title\">Faseverdeling (gem. + piek, 7 dgn)</span>\n" +
"      </div>\n" +
"      <div class=\"chart-wrap\"><canvas id=\"chart-phases\"></canvas></div>\n" +
"    </div>\n" +
"\n" +
"    <!-- Gas dagverbruik -->\n" +
"    <div class=\"chart-block\">\n" +
"      <div class=\"chart-block-header\">\n" +
"        <span class=\"chart-block-title\">Gas dagverbruik (30 dgn)</span>\n" +
"      </div>\n" +
"      <div class=\"chart-wrap\"><canvas id=\"chart-gas\"></canvas></div>\n" +
"    </div>\n" +
"\n" +
"    <!-- Goedkoopste uren vandaag -->\n" +
"    <div class=\"chart-block\">\n" +
"      <div class=\"chart-block-header\">\n" +
"        <span class=\"chart-block-title\">Goedkoopste uren vandaag</span>\n" +
"      </div>\n" +
"      <div class=\"cheap-hours-grid\" id=\"cheap-hours-grid\"></div>\n" +
"    </div>\n" +
"\n" +
"    <!-- Weekdaggemiddelde -->\n" +
"    <div class=\"chart-block\">\n" +
"      <div class=\"chart-block-header\">\n" +
"        <span class=\"chart-block-title\">Weekdaggemiddelde (60 dgn)</span>\n" +
"      </div>\n" +
"      <div class=\"chart-wrap\"><canvas id=\"chart-weekday\"></canvas></div>\n" +
"    </div>\n" +
"\n" +
"    <!-- Heatmap -->\n" +
"    <div class=\"chart-block\" style=\"grid-column: 1 / -1;\">\n" +
"      <div class=\"chart-block-header\">\n" +
"        <span class=\"chart-block-title\">Verbruik heatmap (uur \u00d7 weekdag)</span>\n" +
"        <div class=\"tab-bar\" style=\"margin-bottom:0\">\n" +
"          <button class=\"tab active\" data-hm=\"alltime\" onclick=\"loadHeatmap('alltime',this)\">Alles</button>\n" +
"          <button class=\"tab\" data-hm=\"year\" onclick=\"loadHeatmap('year',this)\">Jaar</button>\n" +
"          <button class=\"tab\" data-hm=\"month\" onclick=\"loadHeatmap('month',this)\">Maand</button>\n" +
"          <button class=\"tab\" data-hm=\"day\" onclick=\"loadHeatmap('day',this)\">Dag</button>\n" +
"        </div>\n" +
"      </div>\n" +
"      <div class=\"heatmap-wrap\"><div class=\"heatmap\" id=\"heatmap\"></div></div>\n" +
"    </div>\n" +
"\n" +
"    <!-- Kosten per dag -->\n" +
"    <div class=\"chart-block\">\n" +
"      <div class=\"chart-block-header\">\n" +
"        <span class=\"chart-block-title\">Kosten per dag (30 dgn)</span>\n" +
"      </div>\n" +
"      <div class=\"chart-wrap\"><canvas id=\"chart-costs-daily\"></canvas></div>\n" +
"    </div>\n" +
"\n" +
"    <!-- Gas per maand -->\n" +
"    <div class=\"chart-block\">\n" +
"      <div class=\"chart-block-header\">\n" +
"        <span class=\"chart-block-title\">Gas per maand</span>\n" +
"      </div>\n" +
"      <div class=\"chart-wrap\"><canvas id=\"chart-gas-monthly\"></canvas></div>\n" +
"    </div>\n" +
"  </div>\n" +
"\n" +
"  <!-- Recent log -->\n" +
"  <div>\n" +
"    <p class=\"section-title\" style=\"margin-top:0.35rem\">Recente metingen</p>\n" +
"    <div class=\"log-wrap\" style=\"max-height:200px\">\n" +
"      <table>\n" +
"        <thead><tr><th>Tijd</th><th>Verbruik (kW)</th><th>Gas (m\u00b3)</th></tr></thead>\n" +
"        <tbody id=\"rows\"></tbody>\n" +
"      </table>\n" +
"    </div>\n" +
"  </div>\n" +
"\n" +
"  <script>\n" +
"    function val(v, dec) { return v != null ? Number(v).toFixed(dec != null ? dec : 3) : '\u2014'; }\n" +
"    function setEl(id, html) { var el = document.getElementById(id); if (el) el.innerHTML = html; }\n" +
"    function setCard(id, v, dec, unit) {\n" +
"      setEl(id, val(v, dec) + '<span class=\"card-unit\">' + unit + '</span>');\n" +
"    }\n" +
"    var lastUpdateTime = null;\n" +
"    function refresh() {\n" +
"      fetch('/api/latest').then(function(r) { return r.json(); }).then(function(d) {\n" +
"        var l = d.latest;\n" +
"        if (!l) return;\n" +
"        lastUpdateTime = Date.now();\n" +
"        setCard('del-total', l.power_delivered_total_kw, 3, 'kW');\n" +
"        setCard('gas',       l.gas_m3,                  3, 'm\u00b3');\n" +
"        setCard('del-l1', l.power_delivered_l1_kw, 3, 'kW');\n" +
"        setCard('del-l2', l.power_delivered_l2_kw, 3, 'kW');\n" +
"        setCard('del-l3', l.power_delivered_l3_kw, 3, 'kW');\n" +
"        setCard('v-l1', l.voltage_l1, 1, 'V');\n" +
"        setCard('v-l2', l.voltage_l2, 1, 'V');\n" +
"        setCard('v-l3', l.voltage_l3, 1, 'V');\n" +
"        setCard('a-l1', l.current_l1, 0, 'A');\n" +
"        setCard('a-l2', l.current_l2, 0, 'A');\n" +
"        setCard('a-l3', l.current_l3, 0, 'A');\n" +
"        var updEl = document.getElementById('updated');\n" +
"        if (updEl) {\n" +
"          var age = Math.round((Date.now() - new Date(l.received_at).getTime()) / 1000);\n" +
"          updEl.textContent = 'Bijgewerkt: ' + new Date(l.received_at).toLocaleTimeString('nl-NL', {hour12:false}) + ' (' + age + 's geleden)';\n" +
"          updEl.style.color = age > 60 ? '#F87171' : age > 30 ? '#FBBF24' : '#3D4D6A';\n" +
"        }\n" +
"        var html = '';\n" +
"        for (var i = 0; i < d.recent.length; i++) {\n" +
"          var r = d.recent[i];\n" +
"          html += '<tr><td>' + new Date(r.received_at).toLocaleTimeString('nl-NL', {hour12:false}) + '</td>' +\n" +
"            '<td>' + val(r.power_delivered_total_kw) + '</td>' +\n" +
"            '<td>' + val(r.gas_m3)                   + '</td></tr>';\n" +
"        }\n" +
"        setEl('rows', html);\n" +
"      }).catch(function(e) { console.error('[refresh]', e); });\n" +
"    }\n" +
"    refresh();\n" +
"    setInterval(refresh, 3000);\n" +
"\n" +
"    var chart = null;\n" +
"    function loadChart(range, btn) {\n" +
"      document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });\n" +
"      if (btn) btn.classList.add('active');\n" +
"      fetch('/api/history?range=' + range).then(function(r) { return r.json(); }).then(function(rows) {\n" +
"        var labels = rows.map(function(r) { return r.period; });\n" +
"        var del    = rows.map(function(r) { return r.del != null ? Number(r.del).toFixed(3) : null; });\n" +
"        if (chart) chart.destroy();\n" +
"        chart = new Chart(document.getElementById('chart'), {\n" +
"          type: 'line',\n" +
"          data: {\n" +
"            labels: labels,\n" +
"            datasets: [\n" +
"              { label: 'Verbruik (kW)', data: del, borderColor: '#A855F7', backgroundColor: 'rgba(168,85,247,0.1)', tension: 0.3, pointRadius: 2, fill: true }\n" +
"            ]\n" +
"          },\n" +
"          options: {\n" +
"            responsive: true, maintainAspectRatio: false,\n" +
"            interaction: { mode: 'index', intersect: false },\n" +
"            plugins: { legend: { labels: { color: '#94A3B8', boxWidth: 12 } } },\n" +
"            scales: {\n" +
"              x: { ticks: { color: '#3D4D6A', maxRotation: 45 }, grid: { color: 'rgba(255,255,255,0.04)' } },\n" +
"              y: { ticks: { color: '#3D4D6A' }, grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true }\n" +
"            }\n" +
"          }\n" +
"        });\n" +
"      }).catch(function() {});\n" +
"    }\n" +
"    function eur(v) { return v != null ? '\u20ac' + Number(v).toFixed(2) : '\u2014'; }\n" +
"    function num(v, d) { return v != null ? Number(v).toFixed(d != null ? d : 3) : '\u2014'; }\n" +
"    function refreshCosts() {\n" +
"      fetch('/api/costs').then(function(r) { return r.json(); }).then(function(c) {\n" +
"        var rows = [['Uur','hour'],['Dag','day'],['Week','week'],['Maand','month']];\n" +
"        document.getElementById('cost-rows').innerHTML = rows.map(function(r) {\n" +
"          var d = c[r[1]];\n" +
"          return '<tr><td>' + r[0] + '</td>' +\n" +
"            '<td class=\"num\">' + num(d.elec_kwh) + '</td>' +\n" +
"            '<td class=\"num\">' + eur(d.elec_cost) + '</td>' +\n" +
"            '<td class=\"num\">' + num(d.gas_m3)    + '</td>' +\n" +
"            '<td class=\"num\">' + eur(d.gas_cost)  + '</td></tr>';\n" +
"        }).join('');\n" +
"        var day = c.day;\n" +
"        if (day && (day.elec_cost != null || day.gas_cost != null)) {\n" +
"          var total = (day.elec_cost || 0) + (day.gas_cost || 0);\n" +
"          document.getElementById('hero-cost-today').innerHTML = '\u20ac' + total.toFixed(2) + '<span class=\"card-unit\">/dag</span>';\n" +
"        }\n" +
"      }).catch(function() {});\n" +
"    }\n" +
"    refreshCosts();\n" +
"    setInterval(refreshCosts, 60000);\n" +
"\n" +
"    function refreshPrices() {\n" +
"      fetch('/api/prices').then(function(r) { return r.json(); }).then(function(p) {\n" +
"        if (p.electricity_eur_kwh != null)\n" +
"          document.getElementById('price-elec').innerHTML = Number(p.electricity_eur_kwh).toFixed(4) + '<span class=\"card-unit\">\u20ac/kWh</span>';\n" +
"        if (p.gas_eur_m3 != null)\n" +
"          document.getElementById('price-gas').innerHTML = Number(p.gas_eur_m3).toFixed(4) + '<span class=\"card-unit\">\u20ac/m\u00b3</span>';\n" +
"      }).catch(function() {});\n" +
"    }\n" +
"    refreshPrices();\n" +
"    setInterval(refreshPrices, 900000);\n" +
"\n" +
"    // Stats\n" +
"    function refreshStats() {\n" +
"      fetch('/api/stats').then(function(r) { return r.json(); }).then(function(s) {\n" +
"        if (!s || s.avg_del == null) return;\n" +
"        document.getElementById('stat-avg-del').innerHTML = num(s.avg_del, 3) + '<span class=\"stat-unit\">kW</span>';\n" +
"        document.getElementById('stat-max-del').innerHTML = num(s.max_del, 3) + '<span class=\"stat-unit\">kW</span>';\n" +
"        var phases = [['L1', s.avg_l1], ['L2', s.avg_l2], ['L3', s.avg_l3]];\n" +
"        var top = phases.filter(function(p) { return p[1] != null; }).sort(function(a,b) { return b[1]-a[1]; })[0];\n" +
"        document.getElementById('stat-top-phase').textContent = top ? top[0] : '\u2014';\n" +
"        if (s.min_v1 != null && s.max_v1 != null)\n" +
"          document.getElementById('stat-voltage-range').innerHTML = num(s.min_v1,1) + '\u2013' + num(s.max_v1,1) + '<span class=\"stat-unit\">V</span>';\n" +
"        if (s.min_v1 != null && s.max_v1 != null)\n" +
"          document.getElementById('stat-avg-v').innerHTML = num((s.min_v1 + s.max_v1) / 2, 1) + '<span class=\"stat-unit\">V</span>';\n" +
"        document.getElementById('stat-readings').textContent = s.total_readings != null ? s.total_readings : '\u2014';\n" +
"      }).catch(function() {});\n" +
"    }\n" +
"    refreshStats();\n" +
"    setInterval(refreshStats, 30000);\n" +
"\n" +
"    // Peaks bar chart\n" +
"    var chartPeaks = null;\n" +
"    function loadPeaks() {\n" +
"      fetch('/api/peaks').then(function(r) { return r.json(); }).then(function(rows) {\n" +
"        var byHour = {};\n" +
"        rows.forEach(function(r) { byHour[parseInt(r.hour, 10)] = r; });\n" +
"        var labels = [], delData = [], counts = [];\n" +
"        for (var h = 0; h < 24; h++) {\n" +
"          labels.push(h + ':00');\n" +
"          var d = byHour[h];\n" +
"          delData.push(d && d.avg_del != null ? Number(d.avg_del).toFixed(3) : 0);\n" +
"          counts.push(d ? d.n : 0);\n" +
"        }\n" +
"        if (chartPeaks) chartPeaks.destroy();\n" +
"        chartPeaks = new Chart(document.getElementById('chart-peaks'), {\n" +
"          type: 'bar',\n" +
"          data: { labels: labels, datasets: [\n" +
"            { label: 'Gem. verbruik (kW)', data: delData, backgroundColor: 'rgba(168,85,247,0.55)', borderColor: '#A855F7', borderWidth: 1, borderRadius: 3 }\n" +
"          ]},\n" +
"          options: {\n" +
"            responsive: true, maintainAspectRatio: false,\n" +
"            plugins: {\n" +
"              legend: { labels: { color: '#94A3B8', boxWidth: 10, font: { size: 10 } } },\n" +
"              tooltip: { callbacks: { afterLabel: function(ctx) { return 'Metingen: ' + counts[ctx.dataIndex]; } } }\n" +
"            },\n" +
"            scales: {\n" +
"              x: { ticks: { color: '#3D4D6A', maxRotation: 45, font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' } },\n" +
"              y: { ticks: { color: '#3D4D6A', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true }\n" +
"            }\n" +
"          }\n" +
"        });\n" +
"      }).catch(function() {});\n" +
"    }\n" +
"    loadPeaks();\n" +
"    setInterval(loadPeaks, 300000);\n" +
"\n" +
"    // Phase distribution\n" +
"    var chartPhases = null;\n" +
"    function loadPhaseChart() {\n" +
"      fetch('/api/phase-stats').then(function(r) { return r.json(); }).then(function(s) {\n" +
"        if (!s || s.avg_l1 == null) return;\n" +
"        if (chartPhases) chartPhases.destroy();\n" +
"        chartPhases = new Chart(document.getElementById('chart-phases'), {\n" +
"          type: 'bar',\n" +
"          data: {\n" +
"            labels: ['L1', 'L2', 'L3'],\n" +
"            datasets: [\n" +
"              { label: 'Gemiddeld (kW)', data: [s.avg_l1, s.avg_l2, s.avg_l3].map(function(v) { return v != null ? Number(v).toFixed(3) : 0; }),\n" +
"                backgroundColor: ['rgba(168,85,247,0.6)','rgba(56,189,248,0.6)','rgba(251,146,60,0.6)'],\n" +
"                borderColor: ['#A855F7','#38BDF8','#F97316'], borderWidth: 1, borderRadius: 4 },\n" +
"              { label: 'Piek (kW)', data: [s.max_l1, s.max_l2, s.max_l3].map(function(v) { return v != null ? Number(v).toFixed(3) : 0; }),\n" +
"                backgroundColor: ['rgba(168,85,247,0.2)','rgba(56,189,248,0.2)','rgba(251,146,60,0.2)'],\n" +
"                borderColor: ['#A855F7','#38BDF8','#F97316'], borderWidth: 1, borderRadius: 4 }\n" +
"            ]\n" +
"          },\n" +
"          options: {\n" +
"            responsive: true, maintainAspectRatio: false,\n" +
"            indexAxis: 'y',\n" +
"            plugins: { legend: { labels: { color: '#94A3B8', boxWidth: 10, font: { size: 10 } } } },\n" +
"            scales: {\n" +
"              x: { ticks: { color: '#3D4D6A', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true },\n" +
"              y: { ticks: { color: '#94A3B8', font: { size: 11, weight: '600' } }, grid: { color: 'rgba(255,255,255,0.04)' } }\n" +
"            }\n" +
"          }\n" +
"        });\n" +
"      }).catch(function() {});\n" +
"    }\n" +
"    loadPhaseChart();\n" +
"    setInterval(loadPhaseChart, 300000);\n" +
"\n" +
"    // Gas daily\n" +
"    var chartGas = null;\n" +
"    function loadGasDaily() {\n" +
"      fetch('/api/gas-daily').then(function(r) { return r.json(); }).then(function(rows) {\n" +
"        var labels = rows.map(function(r) { return r.day.slice(5); }); // MM-DD\n" +
"        var data = rows.map(function(r) { return r.gas_used != null ? Number(r.gas_used).toFixed(3) : 0; });\n" +
"        if (chartGas) chartGas.destroy();\n" +
"        chartGas = new Chart(document.getElementById('chart-gas'), {\n" +
"          type: 'bar',\n" +
"          data: { labels: labels, datasets: [\n" +
"            { label: 'Gas (m\u00b3)', data: data, backgroundColor: 'rgba(249,115,22,0.55)', borderColor: '#F97316', borderWidth: 1, borderRadius: 3 }\n" +
"          ]},\n" +
"          options: {\n" +
"            responsive: true, maintainAspectRatio: false,\n" +
"            plugins: { legend: { labels: { color: '#94A3B8', boxWidth: 10, font: { size: 10 } } } },\n" +
"            scales: {\n" +
"              x: { ticks: { color: '#3D4D6A', maxRotation: 45, font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' } },\n" +
"              y: { ticks: { color: '#3D4D6A', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true }\n" +
"            }\n" +
"          }\n" +
"        });\n" +
"      }).catch(function() {});\n" +
"    }\n" +
"    loadGasDaily();\n" +
"    setInterval(loadGasDaily, 300000);\n" +
"\n" +
"    // Day comparison\n" +
"    function refreshComparison() {\n" +
"      fetch('/api/day-comparison').then(function(r){return r.json();}).then(function(c) {\n" +
"        var t = c.today, y = c.yesterday, w = c.lastweek;\n" +
"        function kwh(v) { return v != null ? num(v,2)+' kWh' : '\u2014'; }\n" +
"        function m3(v)  { return v != null ? num(v,3)+' m\u00b3' : '\u2014'; }\n" +
"        function delta(now, ref) {\n" +
"          if (now == null || ref == null || ref === 0) return '';\n" +
"          var pct = ((now - ref) / ref * 100);\n" +
"          var cls = pct > 5 ? 'delta-up' : pct < -5 ? 'delta-down' : 'delta-same';\n" +
"          return '<span class=\"'+cls+'\">'+(pct>0?'+':'')+pct.toFixed(0)+'%</span>';\n" +
"        }\n" +
"        document.getElementById('cmp-today-elec').innerHTML = kwh(t && t.elec_kwh) + delta(t && t.elec_kwh, y && y.elec_kwh);\n" +
"        document.getElementById('cmp-today-gas').innerHTML  = m3(t && t.gas_used)  + delta(t && t.gas_used,  y && y.gas_used);\n" +
"        document.getElementById('cmp-yest-elec').innerHTML  = kwh(y && y.elec_kwh);\n" +
"        document.getElementById('cmp-yest-gas').innerHTML   = m3(y && y.gas_used);\n" +
"        document.getElementById('cmp-week-elec').innerHTML  = kwh(w && w.elec_kwh);\n" +
"        document.getElementById('cmp-week-gas').innerHTML   = m3(w && w.gas_used);\n" +
"        if (t && t.elec_kwh != null) {\n" +
"          var h = new Date().getHours() + (new Date().getMinutes()/60);\n" +
"          if (h > 0) {\n" +
"            var expElec = t.elec_kwh / h * 24;\n" +
"            document.getElementById('cmp-today-exp').textContent = '~' + num(expElec,2) + ' kWh/dag';\n" +
"          }\n" +
"        }\n" +
"      }).catch(function(){});\n" +
"    }\n" +
"    refreshComparison();\n" +
"    setInterval(refreshComparison, 60000);\n" +
"\n" +
"    // Safety / night usage / CO2\n" +
"    function refreshSafety() {\n" +
"      fetch('/api/voltage-dips').then(function(r){return r.json();}).then(function(s) {\n" +
"        if (!s) return;\n" +
"        var dipsEl = document.getElementById('saf-dips');\n" +
"        dipsEl.textContent = s.dips != null ? s.dips : '\u2014';\n" +
"        dipsEl.style.color = (s.dips > 0) ? '#F87171' : '#4ADE80';\n" +
"        if (s.max_a1 != null)\n" +
"          document.getElementById('saf-max-amp').innerHTML =\n" +
"            num(s.max_a1,0)+'A / '+num(s.max_a2,0)+'A / '+num(s.max_a3,0)+'A <span class=\"stat-unit\">max</span>';\n" +
"      }).catch(function(){});\n" +
"      fetch('/api/night-usage').then(function(r){return r.json();}).then(function(s) {\n" +
"        if (!s) return;\n" +
"        if (s.night_avg != null)\n" +
"          document.getElementById('saf-night').innerHTML = num(s.night_avg,3)+'<span class=\"stat-unit\">kW</span>';\n" +
"      }).catch(function(){});\n" +
"      fetch('/api/stats').then(function(r){return r.json();}).then(function(s) {\n" +
"        if (!s || s.avg_del == null) return;\n" +
"        var h = new Date().getHours() + new Date().getMinutes()/60;\n" +
"        var kwh = s.avg_del * h;\n" +
"        var co2 = kwh * 0.4;\n" +
"        document.getElementById('saf-co2').innerHTML = num(co2,2)+'<span class=\"stat-unit\">kg</span>';\n" +
"      }).catch(function(){});\n" +
"    }\n" +
"    refreshSafety();\n" +
"    setInterval(refreshSafety, 60000);\n" +
"\n" +
"    // Cheap hours\n" +
"    function refreshCheapHours() {\n" +
"      fetch('/api/prices').then(function(r){return r.json();}).then(function(p) {\n" +
"        var grid = document.getElementById('cheap-hours-grid');\n" +
"        if (!grid) return;\n" +
"        if (p.electricity_eur_kwh != null) {\n" +
"          var price = p.electricity_eur_kwh;\n" +
"          var now = new Date().getHours();\n" +
"          var html = '<div style=\"font-size:0.7rem;color:#94A3B8;width:100%\">Huidig uur (' + now + ':00): <strong style=\"color:#FBBF24\">\u20ac' + price.toFixed(4) + '/kWh</strong></div>';\n" +
"          html += '<div style=\"font-size:0.62rem;color:#3D4D6A;width:100%;margin-top:0.3rem\">Tip: plan grote apparaten in de avond (vaak lager tarief)</div>';\n" +
"          grid.innerHTML = html;\n" +
"        }\n" +
"      }).catch(function(){});\n" +
"    }\n" +
"    refreshCheapHours();\n" +
"\n" +
"    // Weekday average bar chart\n" +
"    var chartWeekday = null;\n" +
"    function loadWeekdayChart() {\n" +
"      fetch('/api/weekday-avg').then(function(r){return r.json();}).then(function(rows) {\n" +
"        var dayNames = ['Zo','Ma','Di','Wo','Do','Vr','Za'];\n" +
"        var byDow = {};\n" +
"        rows.forEach(function(r){ byDow[parseInt(r.dow,10)] = r; });\n" +
"        var labels = [], data = [];\n" +
"        for (var d = 0; d < 7; d++) {\n" +
"          labels.push(dayNames[d]);\n" +
"          var r = byDow[d];\n" +
"          data.push(r && r.avg_del != null ? Number(r.avg_del).toFixed(3) : 0);\n" +
"        }\n" +
"        if (chartWeekday) chartWeekday.destroy();\n" +
"        chartWeekday = new Chart(document.getElementById('chart-weekday'), {\n" +
"          type: 'bar',\n" +
"          data: { labels: labels, datasets: [{\n" +
"            label: 'Gem. verbruik (kW)', data: data,\n" +
"            backgroundColor: ['rgba(168,85,247,0.4)','rgba(168,85,247,0.6)','rgba(168,85,247,0.6)','rgba(168,85,247,0.6)','rgba(168,85,247,0.6)','rgba(168,85,247,0.6)','rgba(168,85,247,0.4)'],\n" +
"            borderColor: '#A855F7', borderWidth: 1, borderRadius: 4\n" +
"          }]},\n" +
"          options: {\n" +
"            responsive: true, maintainAspectRatio: false,\n" +
"            plugins: { legend: { display: false } },\n" +
"            scales: {\n" +
"              x: { ticks: { color: '#94A3B8', font: { size: 11, weight: '600' } }, grid: { color: 'rgba(255,255,255,0.04)' } },\n" +
"              y: { ticks: { color: '#3D4D6A', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true }\n" +
"            }\n" +
"          }\n" +
"        });\n" +
"      }).catch(function(){});\n" +
"    }\n" +
"    loadWeekdayChart();\n" +
"    setInterval(loadWeekdayChart, 600000);\n" +
"\n" +
"    // Heatmap\n" +
"    function loadHeatmap(range, btn) {\n" +
"      document.querySelectorAll('[data-hm]').forEach(function(t) { t.classList.remove('active'); });\n" +
"      if (btn) btn.classList.add('active');\n" +
"      fetch('/api/heatmap?range=' + (range || 'alltime')).then(function(r){return r.json();}).then(function(rows) {\n" +
"        var dayNames = ['Zo','Ma','Di','Wo','Do','Vr','Za'];\n" +
"        var grid = {};\n" +
"        var maxVal = 0;\n" +
"        rows.forEach(function(r) {\n" +
"          var key = r.dow + '_' + parseInt(r.hour, 10);\n" +
"          var v = r.avg_del != null ? Number(r.avg_del) : 0;\n" +
"          grid[key] = v;\n" +
"          if (v > maxVal) maxVal = v;\n" +
"        });\n" +
"        if (maxVal === 0) maxVal = 1;\n" +
"        var html = '<div class=\"hm-label\"></div>';\n" +
"        for (var h = 0; h < 24; h++) html += '<div class=\"hm-hour-label\">' + h + '</div>';\n" +
"        for (var d = 0; d < 7; d++) {\n" +
"          html += '<div class=\"hm-label\">' + dayNames[d] + '</div>';\n" +
"          for (var h = 0; h < 24; h++) {\n" +
"            var v = grid[d + '_' + h] || 0;\n" +
"            var ratio = v / maxVal;\n" +
"            var r2 = Math.round(168 + (ratio * (248-168)));\n" +
"            var g2 = Math.round(85  - (ratio * 85));\n" +
"            var b2 = Math.round(247 - (ratio * 100));\n" +
"            var alpha = 0.1 + ratio * 0.8;\n" +
"            var bg = 'rgba('+r2+','+g2+','+b2+','+alpha.toFixed(2)+')';\n" +
"            html += '<div class=\"hm-cell\" style=\"background:'+bg+'\" title=\"'+dayNames[d]+' '+h+':00 \u2014 '+v.toFixed(3)+' kW\"></div>';\n" +
"          }\n" +
"        }\n" +
"        document.getElementById('heatmap').innerHTML = html;\n" +
"      }).catch(function(){});\n" +
"    }\n" +
"    loadHeatmap('alltime', null);\n" +
"    setInterval(function() { loadHeatmap('alltime', null); }, 300000);\n" +
"\n" +
"    // Daily costs chart\n" +
"    var chartCostsDaily = null;\n" +
"    function loadCostsDaily() {\n" +
"      fetch('/api/costs-daily').then(function(r){return r.json();}).then(function(rows) {\n" +
"        var labels = rows.map(function(r){ return r.day.slice(5); });\n" +
"        var elecData = rows.map(function(r){ return r.elec_cost != null ? Number(r.elec_cost).toFixed(2) : 0; });\n" +
"        var gasData  = rows.map(function(r){ return r.gas_cost  != null ? Number(r.gas_cost).toFixed(2)  : 0; });\n" +
"        if (chartCostsDaily) chartCostsDaily.destroy();\n" +
"        chartCostsDaily = new Chart(document.getElementById('chart-costs-daily'), {\n" +
"          type: 'bar',\n" +
"          data: { labels: labels, datasets: [\n" +
"            { label: 'Stroom (\u20ac)', data: elecData, backgroundColor: 'rgba(168,85,247,0.55)', borderColor: '#A855F7', borderWidth: 1, borderRadius: 3, stack: 'cost' },\n" +
"            { label: 'Gas (\u20ac)',    data: gasData,  backgroundColor: 'rgba(249,115,22,0.55)', borderColor: '#F97316', borderWidth: 1, borderRadius: 3, stack: 'cost' }\n" +
"          ]},\n" +
"          options: {\n" +
"            responsive: true, maintainAspectRatio: false,\n" +
"            plugins: { legend: { labels: { color: '#94A3B8', boxWidth: 10, font: { size: 10 } } } },\n" +
"            scales: {\n" +
"              x: { ticks: { color: '#3D4D6A', maxRotation: 45, font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' }, stacked: true },\n" +
"              y: { ticks: { color: '#3D4D6A', font: { size: 9 }, callback: function(v){ return '\u20ac'+v; } }, grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true, stacked: true }\n" +
"            }\n" +
"          }\n" +
"        });\n" +
"      }).catch(function(){});\n" +
"    }\n" +
"    loadCostsDaily();\n" +
"    setInterval(loadCostsDaily, 300000);\n" +
"\n" +
"    // Monthly gas chart\n" +
"    var chartGasMonthly = null;\n" +
"    function loadGasMonthly() {\n" +
"      fetch('/api/gas-monthly').then(function(r){return r.json();}).then(function(rows) {\n" +
"        var labels = rows.map(function(r){ return r.month; });\n" +
"        var data   = rows.map(function(r){ return r.gas_used != null ? Number(r.gas_used).toFixed(2) : 0; });\n" +
"        if (chartGasMonthly) chartGasMonthly.destroy();\n" +
"        chartGasMonthly = new Chart(document.getElementById('chart-gas-monthly'), {\n" +
"          type: 'bar',\n" +
"          data: { labels: labels, datasets: [{\n" +
"            label: 'Gas (m\u00b3)', data: data,\n" +
"            backgroundColor: 'rgba(249,115,22,0.55)', borderColor: '#F97316', borderWidth: 1, borderRadius: 4\n" +
"          }]},\n" +
"          options: {\n" +
"            responsive: true, maintainAspectRatio: false,\n" +
"            plugins: { legend: { display: false } },\n" +
"            scales: {\n" +
"              x: { ticks: { color: '#3D4D6A', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' } },\n" +
"              y: { ticks: { color: '#3D4D6A', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true }\n" +
"            }\n" +
"          }\n" +
"        });\n" +
"      }).catch(function(){});\n" +
"    }\n" +
"    loadGasMonthly();\n" +
"    setInterval(loadGasMonthly, 600000);\n" +
"\n" +
"    loadChart('day', null);\n" +
"    setInterval(function() {\n" +
"      var active = document.querySelector('.tab.active');\n" +
"      if (active) loadChart(active.dataset.range, null);\n" +
"    }, 60000);\n" +
"  </script>\n" +
"</body>\n" +
"</html>";

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
        { key: "hour",  since: "'-1 hour'" },
        { key: "day",   since: "'-24 hours'" },
        { key: "week",  since: "'-7 days'" },
        { key: "month", since: "'-30 days'" }
      ];
      var results = {};
      var pending = periods.length;
      periods.forEach(function(p) {
        db.get(
          "SELECT AVG(power_delivered_total_kw) as avg_kw," +
          " (julianday(MAX(received_at)) - julianday(MIN(received_at))) * 24 as hours," +
          " MAX(gas_m3) - MIN(gas_m3) as gas_used, COUNT(*) as n" +
          " FROM readings WHERE received_at >= datetime('now', " + p.since + ")",
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

    var interval, since, fmt;
    if (range === "week") {
      since = "'-7 days'"; fmt = "'%Y-%m-%d'";
    } else if (range === "month") {
      since = "'-30 days'"; fmt = "'%Y-%m-%d'";
    } else {
      since = "'-24 hours'"; fmt = "'%Y-%m-%d %H:00'";
    }

    var sql =
      "SELECT strftime(" + fmt + ", received_at, 'localtime') as period," +
      " AVG(power_delivered_total_kw) as del," +
      " AVG(power_returned_total_kw) as ret" +
      " FROM readings" +
      " WHERE received_at >= datetime('now'," + since + ")" +
      " GROUP BY period ORDER BY period ASC";

    db.all(sql, function(err, rows) {
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
      " WHERE power_delivered_total_kw IS NOT NULL" +
      " GROUP BY strftime('%H', received_at)" +
      " ORDER BY hour",
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
      " WHERE received_at >= datetime('now', '-7 days')" +
      " AND power_delivered_l1_kw IS NOT NULL",
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
      " WHERE date(received_at, 'localtime') = date('now', 'localtime')" +
      " AND power_delivered_total_kw IS NOT NULL",
      function(err, row) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(row || {}));
      }
    );
    return;
  }

  if (req.method === "GET" && req.url === "/api/gas-daily") {
    db.all(
      "SELECT date(received_at, 'localtime') as day," +
      " MAX(gas_m3) - MIN(gas_m3) as gas_used" +
      " FROM readings" +
      " WHERE received_at >= datetime('now', '-30 days')" +
      " AND gas_m3 IS NOT NULL" +
      " GROUP BY date(received_at, 'localtime')" +
      " ORDER BY day ASC",
      function(err, rows) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(rows || []));
      }
    );
    return;
  }

  if (req.method === "GET" && req.url === "/api/day-comparison") {
    var days = [
      { key: "today",    offset: "''" },
      { key: "yesterday", offset: "'-1 day'" },
      { key: "lastweek", offset: "'-7 days'" }
    ];
    var dcResults = {};
    var dcPending = days.length;
    days.forEach(function(d) {
      db.get(
        "SELECT AVG(power_delivered_total_kw) as avg_kw," +
        " (julianday(MAX(received_at)) - julianday(MIN(received_at)))*24 as hours," +
        " MAX(gas_m3)-MIN(gas_m3) as gas_used, COUNT(*) as n" +
        " FROM readings WHERE date(received_at, 'localtime') = date('now', 'localtime', " + d.offset + ")",
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
      " AND received_at >= datetime('now','-7 days')" +
      " AND power_delivered_total_kw IS NOT NULL",
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
      " WHERE received_at >= datetime('now','-7 days')" +
      " AND (voltage_l1 < 207 OR voltage_l1 > 253 OR voltage_l2 < 207 OR voltage_l2 > 253 OR voltage_l3 < 207 OR voltage_l3 > 253)",
      function(err, row) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(row || {}));
      }
    );
    return;
  }

  if (req.method === "GET" && req.url === "/api/weekday-avg") {
    db.all(
      "SELECT strftime('%w', received_at, 'localtime') as dow, AVG(power_delivered_total_kw) as avg_del" +
      " FROM readings" +
      " WHERE received_at >= datetime('now','-60 days')" +
      " AND power_delivered_total_kw IS NOT NULL" +
      " GROUP BY dow ORDER BY dow",
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
    var hmWhere = "power_delivered_total_kw IS NOT NULL";
    if (hmRange === "year")  hmWhere += " AND received_at >= datetime('now','-1 year')";
    if (hmRange === "month") hmWhere += " AND received_at >= datetime('now','-30 days')";
    if (hmRange === "day")   hmWhere += " AND received_at >= datetime('now','-1 day')";
    db.all(
      "SELECT strftime('%w', received_at) as dow, strftime('%H', received_at) as hour," +
      " AVG(power_delivered_total_kw) as avg_del, COUNT(*) as n" +
      " FROM readings WHERE " + hmWhere +
      " GROUP BY dow, hour",
      function(err, rows) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(rows || []));
      }
    );
    return;
  }

  if (req.method === "GET" && req.url === "/api/gas-monthly") {
    db.all(
      "SELECT strftime('%Y-%m', received_at, 'localtime') as month, MAX(gas_m3)-MIN(gas_m3) as gas_used" +
      " FROM readings" +
      " WHERE gas_m3 IS NOT NULL" +
      " GROUP BY month ORDER BY month ASC",
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
        "SELECT date(received_at, 'localtime') as day," +
        " AVG(power_delivered_total_kw) as avg_kw," +
        " (julianday(MAX(received_at))-julianday(MIN(received_at)))*24 as hours," +
        " MAX(gas_m3)-MIN(gas_m3) as gas_used," +
        " COUNT(*) as n" +
        " FROM readings" +
        " WHERE received_at >= datetime('now','-30 days') AND power_delivered_total_kw IS NOT NULL" +
        " GROUP BY day ORDER BY day ASC",
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
          "SELECT COUNT(*) as today FROM readings WHERE date(received_at, 'localtime') = date('now', 'localtime')",
          function(err2, today) {
            db.get(
              "SELECT COUNT(*) as last_hour FROM readings WHERE received_at >= datetime('now', '-1 hour')",
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
    var limit = Math.min(parseInt(limitMatch ? limitMatch[1] : "100", 10), 5000);
    var offset = parseInt(offsetMatch ? offsetMatch[1] : "0", 10);
    db.all(
      "SELECT id, received_at, device, power_delivered_total_kw, gas_m3," +
      " power_delivered_l1_kw, power_delivered_l2_kw, power_delivered_l3_kw," +
      " voltage_l1, voltage_l2, voltage_l3, current_l1, current_l2, current_l3" +
      " FROM readings ORDER BY id DESC LIMIT ? OFFSET ?",
      [limit, offset],
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
      "  FROM readings WHERE received_at >= datetime('now', '-60 days')" +
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
      [glMin],
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
      "  FROM readings WHERE received_at >= datetime('now', '-60 days')" +
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
      "  FROM readings WHERE received_at >= datetime('now', '-60 days')" +
      "  GROUP BY date(received_at)" +
      ")" +
      "SELECT d.day, d.n, d.first_ts AS first, d.last_ts AS last, d.span_min," +
      "  COUNT(g.gap_min) AS gap_count," +
      "  MAX(g.gap_min) AS max_gap_min," +
      "  (SELECT g2.gap_start FROM gaps g2 WHERE g2.day = d.day ORDER BY g2.gap_min DESC LIMIT 1) AS biggest_gap_start," +
      "  (SELECT g2.gap_end FROM gaps g2 WHERE g2.day = d.day ORDER BY g2.gap_min DESC LIMIT 1) AS biggest_gap_end" +
      " FROM day_summary d LEFT JOIN gaps g ON g.day = d.day" +
      " GROUP BY d.day ORDER BY d.day DESC LIMIT 60",
      function(err, rows) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(rows || []));
      }
    );
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
      "<input type='text' id='search' placeholder='Filter op tijd, waarde…' oninput='applyFilter()'>" +
      "<button class='pill pill-green active' onclick='toggleLive(this)' id='live-btn'>&#9679; Live</button>" +
      "</div>" +
      "<div class='table-wrap'>" +
      "<table><thead><tr><th>#</th><th>Tijd</th><th>Verbruik (kW)</th><th>L1</th><th>L2</th><th>L3</th><th>Gas (m&#179;)</th><th>V-L1</th><th>V-L2</th><th>V-L3</th><th>A-L1</th><th>A-L2</th><th>A-L3</th><th>Apparaat</th></tr></thead>" +
      "<tbody id='logs-body'><tr><td colspan='14' style='color:#3D4D6A;padding:0.5rem'>Laden…</td></tr></tbody></table></div>" +

      "<script>" +
      "var currentLimit=50, liveEnabled=true, liveTimer=null, allRows=[], filterStr='';" +
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
      "allRows=rows;document.getElementById('logs-count').textContent='('+rows.length+' van '+currentLimit+' gevraagd)';" +
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

      "function setLimit(n,btn){currentLimit=n;document.querySelectorAll('.pill').forEach(function(b){if(['50','100','500','1000'].includes(b.textContent))b.classList.remove('active');});btn.classList.add('active');loadLogs();}" +
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

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, "0.0.0.0", function() {
  console.log("Server listening on http://0.0.0.0:" + PORT);
});

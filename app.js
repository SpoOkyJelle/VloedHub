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
  var received_at = new Date().toISOString();
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
"    @media (max-width: 640px) { .hero { grid-template-columns: 1fr; } .middle { grid-template-columns: 1fr; } .stats-strip { grid-template-columns: repeat(3, 1fr); } .charts-grid { grid-template-columns: 1fr; } .bottom-row { grid-template-columns: 1fr; } }\n" +
"  </style>\n" +
"  <script src=\"https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js\"></script>\n" +
"</head>\n" +
"<body>\n" +
"  <div class=\"header\">\n" +
"    <h1><span class=\"dot\"></span>VloedHub</h1>\n" +
"    <span class=\"updated\" id=\"updated\">Wachten op data\u2026</span>\n" +
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
"        <span class=\"chart-block-title\">Piekuren (gem. per uur, 30 dgn)</span>\n" +
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
"    function setCard(id, v, dec, unit) {\n" +
"      document.getElementById(id).innerHTML = val(v, dec) + '<span class=\"card-unit\">' + unit + '</span>';\n" +
"    }\n" +
"    function refresh() {\n" +
"      fetch('/api/latest').then(function(r) { return r.json(); }).then(function(d) {\n" +
"        var l = d.latest;\n" +
"        if (!l) return;\n" +
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
"        document.getElementById('updated').textContent = 'Last updated: ' + new Date(l.received_at).toLocaleTimeString();\n" +
"        var html = '';\n" +
"        for (var i = 0; i < d.recent.length; i++) {\n" +
"          var r = d.recent[i];\n" +
"          html += '<tr><td>' + new Date(r.received_at).toLocaleTimeString() + '</td>' +\n" +
"            '<td>' + val(r.power_delivered_total_kw) + '</td>' +\n" +
"            '<td>' + val(r.gas_m3)                   + '</td></tr>';\n" +
"        }\n" +
"        document.getElementById('rows').innerHTML = html;\n" +
"      }).catch(function() {});\n" +
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
"        var labels = [], delData = [], retData = [];\n" +
"        for (var h = 0; h < 24; h++) {\n" +
"          labels.push(h + ':00');\n" +
"          var d = byHour[h];\n" +
"          delData.push(d && d.avg_del != null ? Number(d.avg_del).toFixed(3) : 0);\n" +
"          retData.push(d && d.avg_ret != null ? Number(d.avg_ret).toFixed(3) : 0);\n" +
"        }\n" +
"        if (chartPeaks) chartPeaks.destroy();\n" +
"        chartPeaks = new Chart(document.getElementById('chart-peaks'), {\n" +
"          type: 'bar',\n" +
"          data: { labels: labels, datasets: [\n" +
"            { label: 'Verbruik (kW)', data: delData, backgroundColor: 'rgba(168,85,247,0.55)', borderColor: '#A855F7', borderWidth: 1, borderRadius: 3 }\n" +
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
      "SELECT strftime(" + fmt + ", received_at) as period," +
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
      " AVG(power_returned_total_kw) as avg_ret" +
      " FROM readings" +
      " WHERE received_at >= datetime('now', '-30 days')" +
      " AND power_delivered_total_kw IS NOT NULL" +
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
      " WHERE date(received_at) = date('now')" +
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
      "SELECT date(received_at) as day," +
      " MAX(gas_m3) - MIN(gas_m3) as gas_used" +
      " FROM readings" +
      " WHERE received_at >= datetime('now', '-30 days')" +
      " AND gas_m3 IS NOT NULL" +
      " GROUP BY date(received_at)" +
      " ORDER BY day ASC",
      function(err, rows) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(rows || []));
      }
    );
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

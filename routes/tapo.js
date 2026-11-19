var tapo = require("../services/tapo");
var db = require("../db/setup");
var time = require("../utils/time");

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function readBody(req, cb) {
  var body = "";
  req.on("data", function(c) { body += c; });
  req.on("end", function() {
    try { cb(JSON.parse(body || "{}")); } catch (e) { cb(null); }
  });
}

module.exports = function(req, res) {
  // e-mail/wachtwoord/token worden nooit teruggegeven
  if (req.method === "GET" && req.url === "/api/tapo") {
    json(res, 200, tapo.getStatus());
    return true;
  }

  // Vermogenshistorie van de wasmachine-stekker: ?range=day|week|month
  // day = ruwe meetpunten (poll-resolutie); week/month = piekvermogen (MAX) per uur/dag, zodat je runs ziet
  if (req.method === "GET" && req.url.indexOf("/api/tapo/power-history") === 0) {
    var range = "day";
    var qs = req.url.indexOf("?range=");
    if (qs !== -1) range = req.url.slice(qs + 7).split("&")[0];

    var sql, param;
    if (range === "week") {
      sql = "SELECT strftime('%Y-%m-%d %H:00', received_at) as period, MAX(watts) as watts FROM tapo_power" +
            " WHERE received_at >= ? GROUP BY period ORDER BY period ASC";
      param = time.effectiveCutoff(604800000);
    } else if (range === "month") {
      sql = "SELECT strftime('%Y-%m-%d', received_at) as period, MAX(watts) as watts FROM tapo_power" +
            " WHERE received_at >= ? GROUP BY period ORDER BY period ASC";
      param = time.effectiveCutoff(2592000000);
    } else {
      sql = "SELECT received_at as period, watts FROM tapo_power" +
            " WHERE date(received_at) = ? ORDER BY period ASC";
      param = time.todayAms();
    }
    db.all(sql, [param], function(err, rows) {
      json(res, 200, rows || []);
    });
    return true;
  }

  // Ruwe meetdata exporteren (download) om de trigger-drempels mee af te stellen: ?days=N (1-90, standaard 7)
  // Bevat vermogen, temp/vocht, wascycli en de huidige drempels. Geen e-mail/wachtwoord.
  if (req.method === "GET" && req.url.indexOf("/api/tapo/export") === 0) {
    var days = 7;
    var dqs = req.url.indexOf("?days=");
    if (dqs !== -1) days = parseInt(req.url.slice(dqs + 6).split("&")[0], 10);
    if (!(days >= 1 && days <= 90)) days = 7;
    var cutoff = time.effectiveCutoff(days * 86400000);

    db.all("SELECT received_at as at, watts FROM tapo_power WHERE received_at >= ? ORDER BY received_at ASC", [cutoff], function(e1, power) {
      db.all("SELECT received_at as at, temp_c, humidity FROM temperature_readings WHERE device = 'tapo-t310' AND received_at >= ? ORDER BY received_at ASC", [cutoff], function(e2, climate) {
        db.all("SELECT finished_at FROM wasmachine_cycles WHERE finished_at >= ? ORDER BY finished_at ASC", [cutoff], function(e3, cycles) {
          var out = {
            exported_at: new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Amsterdam' }).replace(' ', 'T'),
            range_days: days,
            note: "Ruwe Tapo-metingen om de wasmachine- en douche-drempels af te stellen. power=stekker (W), climate=T310 (temp/vocht), wash_cycles=gedetecteerd klaar.",
            tuning: tapo.getTuning(),
            power: power || [],
            climate: climate || [],
            wash_cycles: cycles || []
          };
          res.writeHead(200, {
            "Content-Type": "application/json",
            "Content-Disposition": 'attachment; filename="vloedhub-tapo-export.json"'
          });
          res.end(JSON.stringify(out, null, 2));
        });
      });
    });
    return true;
  }

  // Koppelen: { email, password, region? } — opgeslagen in data/tapo.json (buiten git)
  if (req.method === "POST" && req.url === "/api/tapo/credentials") {
    readBody(req, function(data) {
      if (!data || !tapo.setCredentials(data.email, data.password, data.region)) {
        return json(res, 400, { ok: false, error: "Vul een geldig Tapo e-mailadres en wachtwoord in" });
      }
      json(res, 200, Object.assign({ ok: true }, tapo.getStatus()));
    });
    return true;
  }

  // Hub-bel laten klinken (testknop): { tone?, volume?, duration? }
  if (req.method === "POST" && req.url === "/api/tapo/alarm") {
    readBody(req, function(data) {
      tapo.playAlarm(data || {}, function(err) {
        if (err) return json(res, 400, { ok: false, error: err });
        json(res, 200, { ok: true });
      });
    });
    return true;
  }

  if (req.method === "POST" && req.url === "/api/tapo/alarm/stop") {
    tapo.stopAlarm(function(err) {
      if (err) return json(res, 400, { ok: false, error: err });
      json(res, 200, { ok: true });
    });
    return true;
  }

  // Welke tonen de hub kent (handig om te zien wat beschikbaar is)
  if (req.method === "GET" && req.url === "/api/tapo/alarm/tones") {
    tapo.getAlarmTones(function(err, tones) {
      if (err) return json(res, 400, { ok: false, error: err });
      json(res, 200, { ok: true, tones: tones });
    });
    return true;
  }

  if (req.method === "POST" && req.url === "/api/tapo/unlink") {
    tapo.unlink();
    json(res, 200, Object.assign({ ok: true }, tapo.getStatus()));
    return true;
  }

  // Nu meteen verversen
  if (req.method === "POST" && req.url === "/api/tapo/refresh") {
    tapo.refreshNow(function(err, status) {
      json(res, 200, Object.assign({ ok: !err, error: err || null }, status));
    });
    return true;
  }

  // Ververssnelheid (minuten): { minutes }
  if (req.method === "POST" && req.url === "/api/tapo/poll-interval") {
    readBody(req, function(data) {
      if (!data || !tapo.setPollMinutes(data.minutes)) return json(res, 400, { ok: false, error: "Kies tussen 1 en 30 minuten" });
      json(res, 200, Object.assign({ ok: true }, tapo.getStatus()));
    });
    return true;
  }

  // Kamernaam voor de T310: { room }
  if (req.method === "POST" && req.url === "/api/tapo/room") {
    readBody(req, function(data) {
      if (!data || !tapo.setRoomName(data.room)) return json(res, 400, { ok: false, error: "Vul een kamernaam in" });
      json(res, 200, Object.assign({ ok: true }, tapo.getStatus()));
    });
    return true;
  }

  // Welke apparaten welke rol hebben: { washPlugId, hubId, t310Id }
  if (req.method === "POST" && req.url === "/api/tapo/devices") {
    readBody(req, function(data) {
      if (!data || !tapo.setDevices(data)) return json(res, 400, { ok: false, error: "Ongeldige keuze" });
      json(res, 200, Object.assign({ ok: true }, tapo.getStatus()));
    });
    return true;
  }

  return false;
};

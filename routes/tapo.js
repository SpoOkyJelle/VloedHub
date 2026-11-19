var tapo = require("../services/tapo");

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

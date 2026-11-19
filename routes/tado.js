var tado = require("../services/tado");

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
  // tokens worden nooit teruggegeven
  if (req.method === "GET" && req.url === "/api/tado") {
    json(res, 200, tado.getStatus());
    return true;
  }

  if (req.method === "POST" && req.url === "/api/tado/link") {
    tado.startLink(function(err) {
      json(res, 200, Object.assign({ ok: !err, error: err || null }, tado.getStatus()));
    });
    return true;
  }

  if (req.method === "POST" && req.url === "/api/tado/unlink") {
    tado.unlink();
    json(res, 200, Object.assign({ ok: true }, tado.getStatus()));
    return true;
  }

  // Een zone instellen: { zoneId, temperature } om te verwarmen, of { zoneId, power: "OFF" }
  if (req.method === "POST" && req.url === "/api/tado/zone/set") {
    readBody(req, function(data) {
      if (!data || data.zoneId == null) return json(res, 400, { ok: false, error: "Ongeldige aanvraag" });
      tado.setZone(data.zoneId, data, function(err) {
        json(res, 200, Object.assign({ ok: !err, error: err || null }, tado.getStatus()));
      });
    });
    return true;
  }

  // Een zone terug naar het verwarmingsschema: { zoneId }
  if (req.method === "POST" && req.url === "/api/tado/zone/auto") {
    readBody(req, function(data) {
      if (!data || data.zoneId == null) return json(res, 400, { ok: false, error: "Ongeldige aanvraag" });
      tado.resumeZone(data.zoneId, function(err) {
        json(res, 200, Object.assign({ ok: !err, error: err || null }, tado.getStatus()));
      });
    });
    return true;
  }

  // Een ander huis kiezen (wie er meerdere heeft): { id }
  if (req.method === "POST" && req.url === "/api/tado/home") {
    readBody(req, function(data) {
      if (!data || data.id == null || !tado.setHome(data.id)) return json(res, 400, { ok: false, error: "Onbekend huis" });
      json(res, 200, Object.assign({ ok: true }, tado.getStatus()));
    });
    return true;
  }

  // Waar een kamer getoond wordt: { zoneId, view } met view both|thuis|home|hidden
  if (req.method === "POST" && req.url === "/api/tado/room-view") {
    readBody(req, function(data) {
      if (!data || !tado.setRoomView(data.zoneId, data.view)) return json(res, 400, { ok: false, error: "Ongeldige keuze" });
      json(res, 200, Object.assign({ ok: true }, tado.getStatus()));
    });
    return true;
  }

  // Nu meteen verversen (kost één API-verzoek)
  if (req.method === "POST" && req.url === "/api/tado/refresh") {
    tado.refreshNow(function(err, status) {
      json(res, 200, Object.assign({ ok: !err, error: err || null }, status));
    });
    return true;
  }

  // Vorstgrens instellen: { threshold }
  if (req.method === "POST" && req.url === "/api/tado/frost") {
    readBody(req, function(data) {
      if (!data || !tado.setFrost(data.threshold)) return json(res, 400, { ok: false, error: "Grens moet tussen 1 en 15 °C liggen" });
      json(res, 200, Object.assign({ ok: true }, tado.getStatus()));
    });
    return true;
  }

  // Ververssnelheid instellen (minuten): { minutes }
  if (req.method === "POST" && req.url === "/api/tado/poll-interval") {
    readBody(req, function(data) {
      if (!data || !tado.setPollMinutes(data.minutes)) return json(res, 400, { ok: false, error: "Kies tussen 10 en 360 minuten" });
      json(res, 200, Object.assign({ ok: true }, tado.getStatus()));
    });
    return true;
  }

  // Hoe vaak alleen de presence (wie-thuis-is) ververst wordt (seconden): { seconds }
  if (req.method === "POST" && req.url === "/api/tado/presence-interval") {
    readBody(req, function(data) {
      if (!data || !tado.setPresenceSeconds(data.seconds)) return json(res, 400, { ok: false, error: "Kies tussen 10 en 3600 seconden" });
      json(res, 200, Object.assign({ ok: true }, tado.getStatus()));
    });
    return true;
  }

  return false;
};

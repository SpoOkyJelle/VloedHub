var presence = require("../services/presence");
var discord = require("../services/discord");

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function readBody(req, res, cb) {
  var body = "";
  req.on("data", function(c) { body += c; });
  req.on("end", function() {
    var data;
    try { data = JSON.parse(body || "{}"); } catch (e) { return json(res, 400, { ok: false, error: "Ongeldige aanvraag" }); }
    cb(data);
  });
}

module.exports = function(req, res) {
  // Wie er thuis is, en of de telefoon die dit vraagt al is aangemeld
  if (req.method === "GET" && req.url === "/api/presence") {
    json(res, 200, Object.assign({ local_url: "http://" + discord.LOCAL_IP + ":5000" }, presence.getStatus(req)));
    return true;
  }

  // Meldt de telefoon aan waarmee je dit doet
  if (req.method === "POST" && req.url === "/api/presence/claim") {
    readBody(req, res, function(data) {
      presence.claim(req, data.name, function(err) {
        if (err) return json(res, 400, { ok: false, error: err });
        json(res, 200, Object.assign({ ok: true }, presence.getStatus(req)));
      });
    });
    return true;
  }

  // Zoekt het thuisnetwerk af: wat is er nu verbonden. Kan een halve minuut duren.
  if (req.method === "POST" && req.url === "/api/presence/scan") {
    presence.scan(function(err, devices) {
      if (err) return json(res, 409, { ok: false, error: err });
      json(res, 200, Object.assign({ ok: true, devices: devices }, presence.getStatus(req)));
    });
    return true;
  }

  // Een apparaat uit de scan negeren, weer tonen of als persoon bijhouden
  if (req.method === "POST" && req.url === "/api/presence/device") {
    readBody(req, res, function(data) {
      presence.setDevice(data.mac, data.action, data.name, function(err) {
        if (err) return json(res, 400, { ok: false, error: err });
        json(res, 200, Object.assign({ ok: true, devices: presence.getLastScan() }, presence.getStatus(req)));
      });
    });
    return true;
  }

  if (req.method === "POST" && req.url === "/api/presence/remove") {
    readBody(req, res, function(data) {
      presence.remove(data.id);
      json(res, 200, Object.assign({ ok: true }, presence.getStatus(req)));
    });
    return true;
  }

  return false;
};

var party = require("../services/party");

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
  if (req.url.indexOf("/api/party") !== 0) return false;

  if (req.method === "GET" && req.url === "/api/party") {
    json(res, 200, party.status());
    return true;
  }

  if (req.method === "GET" && req.url === "/api/party/stats") {
    party.stats(function(s) { json(res, 200, s || { never: true }); });
    return true;
  }

  // aan of uit; aanzetten begint een nieuw feest met schone tellers
  if (req.method === "POST" && req.url === "/api/party") {
    readBody(req, function(data) {
      if (!data) return json(res, 400, { ok: false, error: "Ongeldig verzoek" });
      if (data.on) party.start(); else party.stop();
      json(res, 200, Object.assign({ ok: true }, party.status()));
    });
    return true;
  }

  if (req.method === "POST" && req.url === "/api/party/proost") {
    party.proost();
    json(res, 200, Object.assign({ ok: true }, party.status()));
    return true;
  }

  return false;
};

var homeconnect = require("../services/homeconnect");

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

module.exports = function(req, res) {
  // client-ID, secret en tokens worden nooit teruggegeven
  if (req.method === "GET" && req.url === "/api/vaatwasser") {
    json(res, 200, homeconnect.getStatus());
    return true;
  }

  if (req.method === "GET" && req.url === "/api/vaatwasser/stats") {
    homeconnect.getStats(function(stats) { json(res, 200, stats); });
    return true;
  }

  if (req.method === "GET" && req.url === "/api/vaatwasser/advies") {
    homeconnect.advice(function(a) { json(res, 200, a); });
    return true;
  }

  if (req.method === "POST" && req.url === "/api/vaatwasser/config") {
    var body = "";
    req.on("data", function(c) { body += c; });
    req.on("end", function() {
      var data;
      try { data = JSON.parse(body || "{}"); } catch (e) { return json(res, 400, { ok: false, error: "Ongeldige aanvraag" }); }
      if (!homeconnect.setCredentials(data.clientId, data.clientSecret)) return json(res, 400, { ok: false, error: "Dit lijkt geen Home Connect client-ID" });
      json(res, 200, Object.assign({ ok: true }, homeconnect.getStatus()));
    });
    return true;
  }

  if (req.method === "POST" && req.url === "/api/vaatwasser/link") {
    homeconnect.startLink(function(err) {
      json(res, 200, Object.assign({ ok: !err, error: err || null }, homeconnect.getStatus(), err ? { error: err } : {}));
    });
    return true;
  }

  if (req.method === "POST" && req.url === "/api/vaatwasser/unlink") {
    homeconnect.unlink();
    json(res, 200, Object.assign({ ok: true }, homeconnect.getStatus()));
    return true;
  }

  return false;
};

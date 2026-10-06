var discord = require("../services/discord");

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

module.exports = function(req, res) {
  // de webhook zelf wordt nooit teruggegeven, alleen de laatste vier tekens ter herkenning
  if (req.method === "GET" && req.url === "/api/discord") {
    json(res, 200, discord.getStatus());
    return true;
  }

  if (req.method === "POST" && req.url === "/api/discord") {
    var body = "";
    req.on("data", function(c) { body += c; });
    req.on("end", function() {
      var data;
      try { data = JSON.parse(body || "{}"); } catch (e) { return json(res, 400, { ok: false, error: "Ongeldige aanvraag" }); }
      if (!discord.setWebhook(data.webhook)) return json(res, 400, { ok: false, error: "Dit is geen Discord-webhook (https://discord.com/api/webhooks/…)" });
      json(res, 200, Object.assign({ ok: true }, discord.getStatus()));
    });
    return true;
  }

  if (req.method === "POST" && req.url === "/api/discord/test") {
    discord.sendTest(function(err) {
      json(res, 200, err ? { ok: false, error: err } : { ok: true });
    });
    return true;
  }

  return false;
};

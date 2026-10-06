var modules = require("../services/modules");

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

module.exports = function(req, res) {
  if (req.method === "GET" && req.url === "/api/modules") {
    json(res, 200, modules.getList());
    return true;
  }

  if (req.method === "POST" && req.url === "/api/modules") {
    var body = "";
    req.on("data", function(c) { body += c; });
    req.on("end", function() {
      var data;
      try { data = JSON.parse(body || "{}"); } catch (e) { return json(res, 400, { ok: false, error: "Ongeldige aanvraag" }); }
      if (!modules.set(String(data.key || ""), !!data.enabled)) return json(res, 400, { ok: false, error: "Onbekende module" });
      json(res, 200, { ok: true, modules: modules.getMap() });
    });
    return true;
  }

  return false;
};

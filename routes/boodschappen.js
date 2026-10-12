var boodschappen = require("../services/boodschappen");
var auth = require("../services/auth");

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

module.exports = function(req, res) {
  // De lijst, met de gebruikers erbij voor de naam en foto van wie iets toevoegde
  if (req.method === "GET" && req.url === "/api/boodschappen") {
    json(res, 200, boodschappen.getStatus(auth.sessionUser(auth.getSessionToken(req))));
    return true;
  }

  // Toevoegen { text }, afvinken { id, done }, weghalen { id } of alles wat is afgevinkt weghalen
  var action = req.method === "POST" && (req.url.match(/^\/api\/boodschappen\/(add|check|remove|clear)$/) || [])[1];
  if (action) {
    var body = "";
    req.on("data", function(c) { body += c; });
    req.on("end", function() {
      var data;
      try { data = JSON.parse(body || "{}"); } catch (e) { return json(res, 400, { ok: false, error: "Ongeldige aanvraag" }); }
      var me = auth.sessionUser(auth.getSessionToken(req));
      if (!me) return json(res, 403, { ok: false, error: "De boodschappenlijst werkt alleen met een eigen account" });
      var err = action === "add" ? boodschappen.add(me, data.text) :
        action === "check" ? boodschappen.setDone(me, data.id, data.done) :
        action === "remove" ? boodschappen.remove(data.id) : boodschappen.clearDone();
      if (err) return json(res, 400, Object.assign({ ok: false, error: err }, boodschappen.getStatus(me)));
      json(res, 200, Object.assign({ ok: true }, boodschappen.getStatus(me)));
    });
    return true;
  }

  return false;
};

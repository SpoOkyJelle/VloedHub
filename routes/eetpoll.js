var eetpoll = require("../services/eetpoll");
var auth = require("../services/auth");

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

module.exports = function(req, res) {
  // De poll van deze week: de dagen, de gebruikers en wie wat heeft gekozen
  if (req.method === "GET" && req.url === "/api/eetpoll") {
    json(res, 200, eetpoll.getStatus(auth.sessionUser(auth.getSessionToken(req))));
    return true;
  }

  // Je eigen bolletje voor één dag: { day: 0-6 (maandag = 0), eat: true of false }
  if (req.method === "POST" && req.url === "/api/eetpoll/vote") {
    var body = "";
    req.on("data", function(c) { body += c; });
    req.on("end", function() {
      var data;
      try { data = JSON.parse(body || "{}"); } catch (e) { return json(res, 400, { ok: false, error: "Ongeldige aanvraag" }); }
      var me = auth.sessionUser(auth.getSessionToken(req));
      if (!me) return json(res, 403, { ok: false, error: "Stemmen kan alleen met een eigen account" });
      var err = eetpoll.vote(me, data.day, data.eat);
      if (err) return json(res, 400, { ok: false, error: err });
      json(res, 200, Object.assign({ ok: true }, eetpoll.getStatus(me)));
    });
    return true;
  }

  return false;
};

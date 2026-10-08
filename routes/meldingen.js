var notifications = require("../services/notifications");
var modules = require("../services/modules");
var homeconnect = require("../services/homeconnect");
var warnings = require("../services/warnings");
var outages = require("../services/outages");
var nlalert = require("../services/nlalert");

function json(res, data) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

// Wat er op dit moment speelt. Het logboek bevat alleen het moment waarop iets begon; een toestand die al
// gold voordat er werd bijgehouden (of waarvan de melding gewist is) staat daar niet in, maar hier wel.
function active(cb) {
  var list = [];
  if (modules.isOn("vaatwasser")) {
    homeconnect.getStatus().alerts.forEach(function(a) { list.push({ category: "vaatwasser", title: "Vaatwasser: " + a }); });
  }
  (modules.isOn("weather") ? warnings.fetchWarnings : function(done) { done(null, null); })(function(err, w) {
    ((w && w.ok && w.warnings) || []).forEach(function(x) {
      list.push({ category: "weer", title: "Code " + x.code + ": " + x.type, sub: x.description || "" });
    });
    (modules.isOn("storingen") ? outages.fetchStatus : function(done) { done(null, null); })(function(err2, o) {
      ((o && o.ok && o.mine) || []).forEach(function(e) {
        list.push({ category: "storing", title: (e.planned ? "Geplande " + String(e.kind).toLowerCase() : e.kind) + " op " + o.postcode, sub: e.planned ? (e.when || "") : (e.status || ""), url: e.url || null });
      });
      (modules.isOn("nlalert") ? nlalert.fetchAlerts : function(done) { done(null, null); })(function(err3, n) {
        ((n && n.ok && n.alerts) || []).forEach(function(a) {
          list.push({ category: "nlalert", title: "NL-Alert " + (a.home ? "voor jouw adres" : "op " + a.km + " km"), sub: a.message });
        });
        cb(list);
      });
    });
  });
}

module.exports = function(req, res) {
  if (req.method === "GET" && req.url === "/api/meldingen/actief") {
    active(function(list) { json(res, list); });
    return true;
  }

  if (req.method === "GET" && req.url.split("?")[0] === "/api/meldingen") {
    var m = req.url.match(/[?&]limit=(\d+)/);
    notifications.list(m ? m[1] : 50, function(rows) { json(res, rows); });
    return true;
  }

  if (req.method === "POST" && req.url === "/api/meldingen/clear") {
    notifications.clear(function() { json(res, { ok: true }); });
    return true;
  }

  return false;
};

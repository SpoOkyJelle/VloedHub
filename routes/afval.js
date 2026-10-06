var afval = require("../services/afval");

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

module.exports = function(req, res) {
  if (req.method === "GET" && req.url === "/api/afval") {
    afval.fetchCalendar(function(err, data) {
      json(res, 200, err ? { error: "unavailable" } : data);
    });
    return true;
  }

  if (req.method === "GET" && req.url === "/api/afval/address") {
    var addr = afval.getAddress();
    json(res, 200, addr ? { postcode: addr.postcode, huisnummer: addr.huisnummer, toevoeging: addr.toevoeging, straat: addr.straat } : {});
    return true;
  }

  if (req.method === "POST" && req.url === "/api/afval/address") {
    var body = "";
    req.on("data", function(c) { body += c; });
    req.on("end", function() {
      var data;
      try { data = JSON.parse(body || "{}"); } catch (e) { return json(res, 400, { ok: false, error: "Ongeldige aanvraag" }); }
      var postcode   = String(data.postcode || "").replace(/\s/g, "").toUpperCase();
      var huisnummer = String(data.huisnummer || "").trim();
      var toevoeging = String(data.toevoeging || "").trim();
      if (!/^\d{4}[A-Z]{2}$/.test(postcode) || !/^\d{1,5}$/.test(huisnummer) || !/^[A-Za-z0-9]{0,6}$/.test(toevoeging)) {
        return json(res, 400, { ok: false, error: "Vul een geldige postcode en huisnummer in" });
      }
      afval.setAddress({ postcode: postcode, huisnummer: huisnummer, toevoeging: toevoeging }, function(err, saved) {
        if (err) return json(res, 502, { ok: false, error: "Afvalkalender niet bereikbaar" });
        if (!saved) return json(res, 404, { ok: false, error: "Adres niet gevonden bij gemeente Breda" });
        json(res, 200, { ok: true, straat: saved.straat });
      });
    });
    return true;
  }

  return false;
};

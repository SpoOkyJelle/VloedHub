var camera = require("../services/camera");

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

module.exports = function(req, res) {
  // het wachtwoord wordt nooit teruggegeven
  if (req.method === "GET" && req.url === "/api/camera") {
    json(res, 200, camera.getStatus());
    return true;
  }

  // Slaat de instellingen op en probeert meteen een opname, zodat een fout direct zichtbaar is
  if (req.method === "POST" && req.url === "/api/camera") {
    var body = "";
    req.on("data", function(c) { body += c; });
    req.on("end", function() {
      var data;
      try { data = JSON.parse(body || "{}"); } catch (e) { return json(res, 400, { ok: false, error: "Ongeldige aanvraag" }); }
      var err = camera.setConfig(data);
      if (err) return json(res, 400, { ok: false, error: err });
      var status = camera.getStatus();
      if (!status.configured) return json(res, 200, Object.assign({ ok: true }, status));
      camera.snapshot(function(snapErr) {
        json(res, 200, Object.assign({ ok: true, test_error: snapErr || null }, status));
      });
    });
    return true;
  }

  if (req.method === "GET" && req.url.split("?")[0] === "/api/camera/bell") {
    json(res, 200, camera.getBell());
    return true;
  }

  // De momenten waarop is aangebeld waarvan een foto bewaard is, nieuwste eerst
  if (req.method === "GET" && req.url === "/api/camera/rings") {
    json(res, 200, camera.listRings());
    return true;
  }

  var delRing = req.method === "DELETE" && req.url.match(/^\/api\/camera\/rings\/(\d{13})\.jpg$/);
  if (delRing) {
    var delErr = camera.deleteRing(delRing[1]);
    if (delErr) return json(res, 404, { ok: false, error: delErr });
    json(res, 200, { ok: true });
    return true;
  }

  var ring = req.method === "GET" && req.url.match(/^\/api\/camera\/rings\/(\d{13})\.jpg$/);
  if (ring) {
    camera.ringImage(ring[1], function(err, image) {
      if (err) return json(res, 404, { error: err });
      // een foto verandert nooit meer, dus de browser mag hem bewaren
      res.writeHead(200, { "Content-Type": "image/jpeg", "Content-Length": image.length, "Cache-Control": "private, max-age=604800, immutable" });
      res.end(image);
    });
    return true;
  }

  if (req.method === "GET" && req.url.split("?")[0] === "/api/camera/snapshot") {
    camera.snapshot(function(err, image) {
      if (err) return json(res, 502, { error: err });
      res.writeHead(200, { "Content-Type": "image/jpeg", "Content-Length": image.length, "Cache-Control": "no-store" });
      res.end(image);
    });
    return true;
  }

  return false;
};

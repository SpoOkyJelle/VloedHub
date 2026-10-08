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

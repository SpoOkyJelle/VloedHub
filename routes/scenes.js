var scenes = require("../services/scenes");

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
  if (req.method === "GET" && req.url === "/api/scenes") {
    json(res, 200, { scenes: scenes.list(), icons: scenes.ICONS, led: scenes.LED_DEVICES, relay: scenes.RELAY_DEVICES });
    return true;
  }

  if (req.method === "POST" && req.url === "/api/scenes/run") {
    readBody(req, function(data) {
      if (!data || !scenes.run(data.scene)) return json(res, 400, { ok: false, error: "Onbekende scène" });
      json(res, 200, { ok: true });
    });
    return true;
  }

  if (req.method === "POST" && req.url === "/api/scenes") {
    readBody(req, function(data) {
      var saved = data && scenes.save(data);
      if (!saved) return json(res, 400, { ok: false, error: "Geef de scène een naam" });
      json(res, 200, { ok: true, scene: saved });
    });
    return true;
  }

  if (req.method === "POST" && req.url === "/api/scenes/delete") {
    readBody(req, function(data) {
      if (!data || !scenes.remove(data.id)) return json(res, 404, { ok: false, error: "Onbekende scène" });
      json(res, 200, { ok: true });
    });
    return true;
  }

  return false;
};

// flows voeren scènes uit via dezelfde code
module.exports.run = scenes.run;

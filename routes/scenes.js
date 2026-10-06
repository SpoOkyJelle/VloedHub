var state = require("../utils/state");

var LED_DEVICES   = ["default", "keuken", "gang"];
var RELAY_DEVICES = ["gang"];

// Effect 0 = Warm Wit, 2 = Rainbow, 3 = Rainbow Wave (zie LED_EFFECTS in public/index.html)
// ledPer overschrijft de led-instelling voor één strip
var SCENES = {
  "all_off": { label: "Alles uit", icon: "power-off", led: { on: false }, relay: { on: false } },
  "evening": { label: "Avond",     icon: "moon",      led: { on: true, effect: 0, brightness: 110 }, relay: { on: true } },
  "all_on":  { label: "Alles aan", icon: "lightbulb", led: { on: true }, relay: { on: true } },
  "disco":   { label: "Disco",     icon: "music",     led: { on: true, effect: 3 }, ledPer: { "gang": { effect: 2 } }, relay: { on: false } }
};

function runScene(id) {
  var scene = SCENES[id];
  if (!scene) return false;
  LED_DEVICES.forEach(function(d) { Object.assign(state.getLedState(d), scene.led, (scene.ledPer || {})[d]); });
  RELAY_DEVICES.forEach(function(d) { Object.assign(state.getRelayState(d), scene.relay); });
  state.saveState();
  return true;
}

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

module.exports = function(req, res) {
  if (req.method === "GET" && req.url === "/api/scenes") {
    json(res, 200, Object.keys(SCENES).map(function(id) {
      return { id: id, label: SCENES[id].label, icon: SCENES[id].icon };
    }));
    return true;
  }

  if (req.method === "POST" && req.url === "/api/scenes/run") {
    var body = "";
    req.on("data", function(c) { body += c; });
    req.on("end", function() {
      var id;
      try { id = JSON.parse(body || "{}").scene; } catch (e) {}
      if (!runScene(id)) return json(res, 400, { ok: false, error: "Onbekende scène" });
      json(res, 200, { ok: true });
    });
    return true;
  }

  return false;
};

module.exports.run = runScene;
module.exports.SCENES = SCENES;

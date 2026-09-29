var state = require("../utils/state");

module.exports = function(req, res) {
  if (req.method === "GET" && req.url.indexOf("/api/led/state") === 0) {
    var ledQs = req.url.indexOf("?device=");
    var ledDevice = ledQs !== -1 ? decodeURIComponent(req.url.slice(ledQs + 8).split("&")[0]) : "default";
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(state.getLedState(ledDevice)));
    return true;
  }

  if (req.method === "POST" && req.url.indexOf("/api/led/state") === 0) {
    var ledQsP = req.url.indexOf("?device=");
    var ledDeviceP = ledQsP !== -1 ? decodeURIComponent(req.url.slice(ledQsP + 8).split("&")[0]) : "default";
    var ledStateP = state.getLedState(ledDeviceP);
    var bodyLed = "";
    req.on("data", function(c) { bodyLed += c; });
    req.on("end", function() {
      try {
        var d = JSON.parse(bodyLed);
        if (d.on !== undefined) ledStateP.on = !!d.on;
        if (d.effect !== undefined) ledStateP.effect = parseInt(d.effect);
        if (d.brightness !== undefined) ledStateP.brightness = parseInt(d.brightness);
        if (d.color && typeof d.color === "object") {
          var clamp255 = function(v) { v = parseInt(v); return isNaN(v) ? 0 : Math.max(0, Math.min(255, v)); };
          ledStateP.color = { r: clamp255(d.color.r), g: clamp255(d.color.g), b: clamp255(d.color.b) };
        }
      } catch(e) {}
      state.saveState();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(ledStateP));
    });
    return true;
  }

  return false;
};

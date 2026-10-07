var monitor = require("../services/monitor");

module.exports = function(req, res) {
  if (req.method === "GET" && req.url === "/api/monitor") {
    monitor.getStatus(function(list) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(list));
    });
    return true;
  }

  // Melding bij offline gaan per apparaat aan of uit
  if (req.method === "POST" && req.url === "/api/monitor/notify") {
    var body = "";
    req.on("data", function(c) { body += c; });
    req.on("end", function() {
      var data;
      try { data = JSON.parse(body || "{}"); } catch (e) { data = {}; }
      var ok = typeof data.key === "string" && !!data.key;
      if (ok) monitor.setNotify(data.key, !!data.notify);
      res.writeHead(ok ? 200 : 400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: ok }));
    });
    return true;
  }

  return false;
};

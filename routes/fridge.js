var fridge = require("../services/fridge");

module.exports = function(req, res) {
  if (req.method === "GET" && req.url === "/api/fridge") {
    fridge.fetchStatus(function(err, data) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(err ? { configured: true, ok: false, error: "Database niet bereikbaar" } : data));
    });
    return true;
  }

  return false;
};

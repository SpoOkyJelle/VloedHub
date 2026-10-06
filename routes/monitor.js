var monitor = require("../services/monitor");

module.exports = function(req, res) {
  if (req.method === "GET" && req.url === "/api/monitor") {
    monitor.getStatus(function(list) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(list));
    });
    return true;
  }

  return false;
};

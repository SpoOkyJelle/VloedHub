var internet = require("../services/internet");

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

module.exports = function(req, res) {
  if (req.method === "GET" && req.url === "/api/internet") {
    internet.getStatus(function(s) { json(res, 200, s); });
    return true;
  }

  if (req.method === "GET" && req.url.split("?")[0] === "/api/internet/history") {
    var m = req.url.match(/[?&]days=(\d+)/);
    internet.history(m ? m[1] : 7, function(rows) { json(res, 200, rows); });
    return true;
  }

  // Start een test en wacht er niet op (die duurt een halve minuut); de pagina vraagt de stand zelf op
  if (req.method === "POST" && req.url === "/api/internet/run") {
    internet.getStatus(function(s) {
      if (!s.running) internet.run();
      json(res, 200, { ok: true, running: true });
    });
    return true;
  }

  return false;
};

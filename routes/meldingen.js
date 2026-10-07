var notifications = require("../services/notifications");

function json(res, data) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

module.exports = function(req, res) {
  if (req.method === "GET" && req.url.split("?")[0] === "/api/meldingen") {
    var m = req.url.match(/[?&]limit=(\d+)/);
    notifications.list(m ? m[1] : 50, function(rows) { json(res, rows); });
    return true;
  }

  if (req.method === "POST" && req.url === "/api/meldingen/clear") {
    notifications.clear(function() { json(res, { ok: true }); });
    return true;
  }

  return false;
};

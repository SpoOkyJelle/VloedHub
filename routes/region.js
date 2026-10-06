var outages = require("../services/outages");
var warnings = require("../services/warnings");

function json(res, data) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

module.exports = function(req, res) {
  // Stroom- en gasstoringen van Enexis rond je postcode
  if (req.method === "GET" && req.url === "/api/outages") {
    outages.fetchStatus(function(err, data) { json(res, data); });
    return true;
  }

  // Weerwaarschuwingen van het KNMI voor de provincie
  if (req.method === "GET" && req.url === "/api/warnings") {
    warnings.fetchWarnings(function(err, data) { json(res, data); });
    return true;
  }

  return false;
};

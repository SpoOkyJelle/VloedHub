var outages = require("../services/outages");
var warnings = require("../services/warnings");
var rain = require("../services/rain");
var traffic = require("../services/traffic");
var nlalert = require("../services/nlalert");
var p2000 = require("../services/p2000");

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

  // Regen in de komende twee uur (Buienradar)
  if (req.method === "GET" && req.url === "/api/rain") {
    rain.fetchRain(function(err, data) { json(res, data); });
    return true;
  }

  // Files en afsluitingen op de rijkswegen rond huis (Rijkswaterstaat)
  if (req.method === "GET" && req.url === "/api/traffic") {
    traffic.fetchTraffic(function(err, data) { json(res, data); });
    return true;
  }

  // Lopende NL-Alerts voor het thuisadres of vlak daarbij
  if (req.method === "GET" && req.url === "/api/nlalert") {
    nlalert.fetchAlerts(function(err, data) { json(res, data); });
    return true;
  }

  // De laatste 112-meldingen (P2000) in de eigen plaats
  if (req.method === "GET" && req.url === "/api/p2000") {
    p2000.fetchCalls(function(err, data) { json(res, data); });
    return true;
  }

  return false;
};

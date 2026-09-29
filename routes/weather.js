var weatherService = require("../services/weather");
var prices = require("../services/prices");

module.exports = function(req, res) {
  if (req.method === "GET" && req.url === "/api/weather") {
    weatherService.fetchWeather(function(err, weather) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(err ? { error: "unavailable" } : weather));
    });
    return true;
  }

  if (req.method === "GET" && req.url === "/api/prices") {
    prices.fetchPrices(function(err, priceData) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(err ? { error: "unavailable" } : priceData));
    });
    return true;
  }

  return false;
};

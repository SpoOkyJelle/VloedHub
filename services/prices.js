var https = require("https");

var priceCache = { data: null, fetchedAt: 0 };

function fetchPrices(callback) {
  var now = Date.now();
  if (priceCache.data && now - priceCache.fetchedAt < 3600000) {
    return callback(null, priceCache.data);
  }

  var today = new Date().toISOString().slice(0, 10);
  var body = JSON.stringify({
    query: '{ marketPrices(date: "' + today + '") {' +
      ' electricityPrices { from marketPrice marketPriceTax sourcingMarkupPrice energyTaxPrice }' +
      ' gasPrices { from marketPrice marketPriceTax sourcingMarkupPrice energyTaxPrice }' +
    ' } }'
  });

  var options = {
    hostname: "frank-graphql-prod.graphcdn.app",
    path: "/",
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
  };

  var req = https.request(options, function(res) {
    var chunks = "";
    res.on("data", function(c) { chunks += c; });
    res.on("end", function() {
      try {
        var json = JSON.parse(chunks);
        var mp = json.data.marketPrices;

        // Current hour in UTC to match Frank's timestamps
        var nowHour = new Date().toISOString().slice(0, 13);
        var elec = null;
        mp.electricityPrices.forEach(function(p) {
          if (p.from && p.from.slice(0, 13) === nowHour) {
            elec = p.marketPrice + p.marketPriceTax + p.sourcingMarkupPrice + p.energyTaxPrice;
          }
        });
        // Fallback: most recent electricity price
        if (elec === null && mp.electricityPrices.length > 0) {
          var last = mp.electricityPrices[mp.electricityPrices.length - 1];
          elec = last.marketPrice + last.marketPriceTax + last.sourcingMarkupPrice + last.energyTaxPrice;
        }

        var gas = null;
        if (mp.gasPrices.length > 0) {
          var gp = mp.gasPrices[0];
          gas = gp.marketPrice + gp.marketPriceTax + gp.sourcingMarkupPrice + gp.energyTaxPrice;
        }

        var result = { electricity_eur_kwh: elec, gas_eur_m3: gas,
          electricity_label: "current hour (day-ahead)", gas_label: "today (daily)" };
        priceCache = { data: result, fetchedAt: now };
        callback(null, result);
      } catch (e) {
        callback(e);
      }
    });
  });
  req.on("error", callback);
  req.write(body);
  req.end();
}

module.exports = {
  fetchPrices: fetchPrices,
  get priceCache() { return priceCache; }
};

var https = require('https');

var LAT = 51.57632;
var LON = 4.73906;

var cache = { sunrise: null, sunset: null, date: null };

function fetchSunTimes(cb) {
  var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + LAT +
    '&longitude=' + LON + '&daily=sunrise,sunset&timezone=Europe%2FAmsterdam&forecast_days=1';

  https.get(url, function(res) {
    var body = '';
    res.on('data', function(c) { body += c; });
    res.on('end', function() {
      try {
        var json = JSON.parse(body);
        var sunrise = json.daily.sunrise[0]; // "2024-01-15T08:30"
        var sunset  = json.daily.sunset[0];  // "2024-01-15T16:45"
        cache = {
          sunrise: sunrise.slice(11, 16),
          sunset:  sunset.slice(11, 16),
          date:    sunrise.slice(0, 10)
        };
        cb(null, cache);
      } catch(e) { cb(e); }
    });
  }).on('error', cb);
}

function getSunTimes(cb) {
  var today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' });
  if (cache.date === today && cache.sunrise) return cb(null, cache);
  fetchSunTimes(cb);
}

module.exports = { getSunTimes: getSunTimes };

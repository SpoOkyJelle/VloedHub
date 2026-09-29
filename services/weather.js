var https = require("https");

var WEATHER_LAT = 51.57632;
var WEATHER_LON = 4.73906;
var WEATHER_LOCATION = "Princenhage, Breda";

var WEATHER_CODES = {
  0: ["Helder", "sun"], 1: ["Overwegend helder", "cloud-sun"], 2: ["Half bewolkt", "cloud-sun"], 3: ["Bewolkt", "cloud"],
  45: ["Mist", "smog"], 48: ["Mist", "smog"],
  51: ["Motregen", "cloud-rain"], 53: ["Motregen", "cloud-rain"], 55: ["Motregen", "cloud-rain"],
  56: ["IJzel", "icicles"], 57: ["IJzel", "icicles"],
  61: ["Regen", "cloud-rain"], 63: ["Regen", "cloud-rain"], 65: ["Zware regen", "cloud-showers-heavy"],
  66: ["IJzel", "icicles"], 67: ["IJzel", "icicles"],
  71: ["Sneeuw", "snowflake"], 73: ["Sneeuw", "snowflake"], 75: ["Zware sneeuw", "snowflake"],
  77: ["Sneeuwkorrels", "snowflake"],
  80: ["Buien", "cloud-rain"], 81: ["Buien", "cloud-rain"], 82: ["Zware buien", "cloud-showers-heavy"],
  85: ["Sneeuwbuien", "snowflake"], 86: ["Sneeuwbuien", "snowflake"],
  95: ["Onweer", "cloud-bolt"], 96: ["Onweer met hagel", "cloud-bolt"], 99: ["Onweer met hagel", "cloud-bolt"]
};

var weatherCache = { data: null, fetchedAt: 0 };

function fetchWeather(callback) {
  var now = Date.now();
  if (weatherCache.data && now - weatherCache.fetchedAt < 900000) {
    return callback(null, weatherCache.data);
  }

  var url = "https://api.open-meteo.com/v1/forecast?latitude=" + WEATHER_LAT +
    "&longitude=" + WEATHER_LON +
    "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m" +
    "&hourly=precipitation_probability&timezone=Europe%2FAmsterdam&forecast_days=1";

  https.get(url, function(res) {
    var chunks = "";
    res.on("data", function(c) { chunks += c; });
    res.on("end", function() {
      try {
        var json = JSON.parse(chunks);
        var cur = json.current;
        var code = WEATHER_CODES[cur.weather_code] || ["Onbekend", "question"];
        var precip = null;
        if (json.hourly && json.hourly.time) {
          var idx = json.hourly.time.indexOf(cur.time);
          if (idx !== -1) precip = json.hourly.precipitation_probability[idx];
        }
        var result = {
          temp: cur.temperature_2m,
          feels_like: cur.apparent_temperature,
          humidity: cur.relative_humidity_2m,
          wind_speed: cur.wind_speed_10m,
          precipitation_probability: precip,
          condition: code[0],
          icon: code[1],
          location: WEATHER_LOCATION
        };
        weatherCache = { data: result, fetchedAt: now };
        callback(null, result);
      } catch (e) {
        callback(e);
      }
    });
  }).on("error", callback);
}

module.exports = {
  fetchWeather: fetchWeather,
  get weatherCache() { return weatherCache; },
  WEATHER_CODES: WEATHER_CODES,
  WEATHER_LAT: WEATHER_LAT,
  WEATHER_LON: WEATHER_LON,
  WEATHER_LOCATION: WEATHER_LOCATION
};

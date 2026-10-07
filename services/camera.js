var http = require("http");
var https = require("https");
var fs = require("fs");
var path = require("path");

// Beeld van de Reolink-deurbel: een momentopname (JPEG) via de HTTP-API van de camera.
// Het adres en de inloggegevens staan in data/camera.json (niet in git) en zijn in te stellen bij
// Instellingen; ze blijven op de server, de browser praat alleen met VloedHub.
// Op de camera moet HTTP (of HTTPS) aan staan: Instellingen > Netwerk > Geavanceerd > Serverinstellingen.
var CONFIG_FILE = path.join(__dirname, "../data/camera.json");
var CACHE_TTL = 1500;            // meerdere kijkers tegelijk delen dezelfde opname
var TIMEOUT   = 8000;
var MAX_BYTES = 8 * 1024 * 1024;

var cache = { image: null, fetchedAt: 0 };
var waiting = null;   // callbacks die op dezelfde lopende aanvraag wachten

function getConfig() {
  try {
    var c = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    return (c.host && c.user) ? c : null;
  } catch (e) { return null; }
}

function getStatus() {
  var c = getConfig();
  return { configured: !!c, host: c ? c.host : null, user: c ? c.user : null };
}

// Alleen een adres op het thuisnetwerk, eventueel met https:// ervoor en een poort erachter.
// Zo kan dit niet gebruikt worden om de server willekeurige adressen te laten opvragen.
function parseHost(host) {
  var m = String(host || "").trim().match(/^(https?:\/\/)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?::(\d{1,5}))?\/?$/i);
  if (!m) return null;
  var a = +m[2], b = +m[3];
  if ([a, b, +m[4], +m[5]].some(function(n) { return n > 255; })) return null;
  if (!(a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31))) return null;
  var secure = /^https/i.test(m[1] || "");
  return { secure: secure, hostname: [m[2], m[3], m[4], m[5]].join("."), port: m[6] ? +m[6] : (secure ? 443 : 80) };
}

// Lege host wist de instelling; een leeg wachtwoord laat het bewaarde wachtwoord staan.
// Geeft een foutmelding terug, of null als het gelukt is.
function setConfig(data) {
  var host = String(data.host || "").trim();
  if (!host) {
    try { fs.unlinkSync(CONFIG_FILE); } catch (e) {}
    cache = { image: null, fetchedAt: 0 };
    return null;
  }
  if (!parseHost(host)) return "Vul het IP-adres van de camera op je thuisnetwerk in (bijv. 192.168.178.50)";
  var user = String(data.user || "").trim();
  if (!user) return "Vul de gebruikersnaam van de camera in";
  var old = getConfig();
  var password = String(data.password || "") || (old ? old.password : "");
  var dir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ host: host, user: user, password: password }, null, 2));
  cache = { image: null, fetchedAt: 0 };
  return null;
}

// De camera antwoordt bij een fout met JSON in plaats van een plaatje
function explain(body) {
  var text = body.toString("utf8", 0, 2000);
  if (/login|password|user|rspCode"?\s*:\s*-(6|7)\b/i.test(text)) return "Camera weigert de inloggegevens";
  return "Camera gaf geen beeld";
}

function fetchSnapshot(cb) {
  var c = getConfig();
  if (!c) return cb("Camera nog niet ingesteld");
  var target = parseHost(c.host);
  if (!target) return cb("Adres van de camera klopt niet");
  var query = "/cgi-bin/api.cgi?cmd=Snap&channel=0&rs=" + Date.now() +
    "&user=" + encodeURIComponent(c.user) + "&password=" + encodeURIComponent(c.password || "");
  var done = false;
  function finish(err, image) { if (done) return; done = true; cb(err, image); }
  // de camera heeft een eigen (niet door een instantie ondertekend) certificaat
  var req = (target.secure ? https : http).get({ hostname: target.hostname, port: target.port, path: query, timeout: TIMEOUT, rejectUnauthorized: false }, function(res) {
    var chunks = [], size = 0;
    res.on("data", function(chunk) {
      size += chunk.length;
      if (size > MAX_BYTES) { req.destroy(); return finish("Opname van de camera is te groot"); }
      chunks.push(chunk);
    });
    res.on("end", function() {
      var body = Buffer.concat(chunks);
      if (res.statusCode !== 200) return finish("Camera gaf een fout (HTTP " + res.statusCode + ")");
      // een JPEG begint met FF D8
      if (body.length < 3 || body[0] !== 0xFF || body[1] !== 0xD8) return finish(explain(body));
      finish(null, body);
    });
    res.on("error", function() { finish("Verbinding met de camera viel weg"); });
  });
  req.on("timeout", function() { req.destroy(); finish("Camera reageert niet"); });
  req.on("error", function(e) {
    finish(e.code === "ECONNREFUSED" ? "Camera weigert de verbinding (staat HTTP aan op de camera?)" : "Camera niet bereikbaar");
  });
}

// cb(foutmelding of null, JPEG als Buffer)
function snapshot(cb) {
  if (cache.image && Date.now() - cache.fetchedAt < CACHE_TTL) return cb(null, cache.image);
  if (waiting) return waiting.push(cb);
  waiting = [cb];
  fetchSnapshot(function(err, image) {
    if (!err) cache = { image: image, fetchedAt: Date.now() };
    var list = waiting;
    waiting = null;
    list.forEach(function(f) { f(err, image); });
  });
}

module.exports = { getStatus: getStatus, setConfig: setConfig, snapshot: snapshot, parseHost: parseHost };

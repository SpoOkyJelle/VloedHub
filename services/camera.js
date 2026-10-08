var http = require("http");
var https = require("https");
var fs = require("fs");
var path = require("path");
var discord = require("./discord");
var modules = require("./modules");

// Beeld van de Reolink-deurbel: een momentopname (JPEG) via de HTTP-API van de camera.
// Het adres en de inloggegevens staan in data/camera.json (niet in git) en zijn in te stellen bij
// Instellingen; ze blijven op de server, de browser praat alleen met VloedHub.
// Op de camera moet HTTP (of HTTPS) aan staan: Instellingen > Netwerk > Geavanceerd > Serverinstellingen.
var CONFIG_FILE = path.join(__dirname, "../data/camera.json");
var CACHE_TTL = 1500;            // meerdere kijkers tegelijk delen dezelfde opname
var TIMEOUT   = 8000;
var MAX_BYTES = 8 * 1024 * 1024;

var cache = { image: null, fetchedAt: 0 };
// supported: null zolang onbekend, false als de camera het aanbellen niet via de API meldt
var bell = { ringAt: null, pressed: false, supported: null, busy: false, skip: 0 };
var waiting = null;   // callbacks die op dezelfde lopende aanvraag wachten

function getConfig() {
  try {
    var c = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    return (c.host && c.user) ? c : null;
  } catch (e) { return null; }
}

function getStatus() {
  var c = getConfig();
  return { configured: !!c, host: c ? c.host : null, user: c ? c.user : null, bell: c ? bell.supported : null };
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
  // elke Reolink heeft een account "admin"; zonder ingevulde gebruiker proberen we die
  var user = String(data.user || "").trim() || "admin";
  var old = getConfig();
  var password = String(data.password || "") || (old ? old.password : "");
  var dir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ host: host, user: user, password: password }, null, 2));
  cache = { image: null, fetchedAt: 0 };
  bell.supported = null;
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

// ── Aanbellen ──
// De camera heeft geen manier om VloedHub te waarschuwen, dus wordt elke seconde gevraagd of de bel is ingedrukt.
// Dat gaat met GetEvents; cb(fout, true/false), of cb(null, null) als de camera dat commando of de bel niet kent.
var BELL_INTERVAL = 1000;
var BELL_QUIET = 20000;   // een tweede druk binnen deze tijd is dezelfde bezoeker
var RINGS_DIR = path.join(__dirname, "../data/deurbel");   // een foto per keer dat er is aangebeld (niet in git)
var RINGS_KEEP = 50;
var BELL_RETRY = 60;      // kent de camera het niet, dan nog maar eens per zoveel rondes proberen

function fetchVisitor(cb) {
  var c = getConfig();
  var target = c && parseHost(c.host);
  if (!target) return cb("Camera niet ingesteld");
  var body = JSON.stringify([{ cmd: "GetEvents", action: 0, param: { channel: 0 } }]);
  var done = false;
  function finish(err, pressed) { if (done) return; done = true; cb(err, pressed); }
  var req = (target.secure ? https : http).request({
    method: "POST", hostname: target.hostname, port: target.port, timeout: 4000, rejectUnauthorized: false,
    path: "/cgi-bin/api.cgi?cmd=GetEvents&user=" + encodeURIComponent(c.user) + "&password=" + encodeURIComponent(c.password || ""),
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
  }, function(res) {
    var text = "";
    res.setEncoding("utf8");
    res.on("data", function(chunk) { if (text.length < 20000) text += chunk; });
    res.on("end", function() {
      var r;
      try { r = JSON.parse(text)[0]; } catch (e) { return finish("Onleesbaar antwoord"); }
      var visitor = r && r.code === 0 && r.value && r.value.visitor;
      if (!visitor || visitor.support === 0) return finish(null, null);
      finish(null, visitor.alarm_state === 1);
    });
    res.on("error", function() { finish("Verbinding viel weg"); });
  });
  req.on("timeout", function() { req.destroy(); finish("Camera reageert niet"); });
  req.on("error", function() { finish("Camera niet bereikbaar"); });
  req.end(body);
}

function checkBell() {
  if (bell.busy || !modules.isOn("camera") || !getConfig()) return;
  if (bell.supported === false && ++bell.skip % BELL_RETRY) return;
  bell.busy = true;
  fetchVisitor(function(err, pressed) {
    bell.busy = false;
    if (err) return;
    bell.supported = pressed !== null;
    // alleen het moment van indrukken telt, niet zolang de camera de bel als ingedrukt blijft melden
    var rising = pressed && !bell.pressed;
    bell.pressed = !!pressed;
    if (!rising || (bell.ringAt && Date.now() - bell.ringAt < BELL_QUIET)) return;
    bell.ringAt = Date.now();
    var at = bell.ringAt, message = "🔔 **Er wordt aangebeld**";
    // meteen een nieuwe opname, niet die van een eerdere kijker; lukt dat niet, dan gaat de melding zonder foto weg
    fetchSnapshot(function(snapErr, image) {
      if (snapErr) return discord.notify("deurbel", message);
      saveRing(at, image);
      discord.notifyWithImage("deurbel", message, image, "deurbel.jpg");
    });
  });
}

// De foto's heten naar het moment van aanbellen (milliseconden); alleen de nieuwste blijven bewaard
function listRings() {
  var files;
  try { files = fs.readdirSync(RINGS_DIR); } catch (e) { return []; }
  return files.filter(function(f) { return /^\d{13}\.jpg$/.test(f); }).map(function(f) { return +f.slice(0, 13); }).sort(function(a, b) { return b - a; });
}

function saveRing(at, image) {
  try {
    if (!fs.existsSync(RINGS_DIR)) fs.mkdirSync(RINGS_DIR, { recursive: true });
    fs.writeFileSync(path.join(RINGS_DIR, at + ".jpg"), image);
    listRings().slice(RINGS_KEEP).forEach(function(old) { try { fs.unlinkSync(path.join(RINGS_DIR, old + ".jpg")); } catch (e) {} });
  } catch (e) { console.error("[deurbel]", e.message); }
}

// cb(foutmelding of null, JPEG als Buffer)
function ringImage(id, cb) {
  if (!/^\d{13}$/.test(String(id))) return cb("Onbekende foto");
  fs.readFile(path.join(RINGS_DIR, id + ".jpg"), function(err, image) { cb(err ? "Foto niet gevonden" : null, image); });
}

// Voor de browser: wanneer er voor het laatst is aangebeld en hoe lang dat geleden is
function getBell() {
  return { ring_at: bell.ringAt, age_ms: bell.ringAt ? Date.now() - bell.ringAt : null, supported: bell.supported };
}

function start() {
  setInterval(checkBell, BELL_INTERVAL);
}

module.exports = { getStatus: getStatus, setConfig: setConfig, snapshot: snapshot, parseHost: parseHost, getBell: getBell, listRings: listRings, ringImage: ringImage, start: start };

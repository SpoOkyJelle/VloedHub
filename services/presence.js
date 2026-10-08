var fs = require("fs");
var os = require("os");
var path = require("path");
var dns = require("dns");
var execFile = require("child_process").execFile;
var httpget = require("../utils/httpget");
var camera = require("./camera");
var modules = require("./modules");

// Wie is thuis: elke telefoon die is aangemeld wordt om de halve minuut op het thuisnetwerk gezocht.
// Een telefoon wordt herkend aan zijn MAC-adres; het IP-adres kan wisselen en wordt dan teruggezocht.
// Aanmelden gaat door VloedHub thuis op de wifi te openen: de server ziet dan vanaf welk adres dat gebeurt.
// Dat kan alleen vanaf een telefoon (te zien aan de browser), zodat een tablet of computer niet als persoon telt.
// De gegevens staan in data/presence.json (niet in git).
var FILE = path.join(__dirname, "../data/presence.json");
var CHECK_INTERVAL = 30 * 1000;
var AWAY_AFTER = 15 * 60 * 1000;   // telefoons in slaapstand zwijgen soms minuten; pas na zo lang stilte is iemand weg
var SWEEP_AFTER = 2 * 60 * 1000;   // zo lang niet gevonden op het bekende adres: het hele netwerk afzoeken
var SWEEP_PAUSE = 5 * 60 * 1000;
var SWEEP_BATCH = 32;
var MAX_PEOPLE = 10;
var WINDOWS = process.platform === "win32";

var startedAt = Date.now();
var people = load();   // [{ id, name, mac, ip, home, since, lastSeen }]
var busy = false, lastSweep = 0;
var visitors = {};   // ip -> { label, at }: met wat voor browser of apparaat dat adres VloedHub het laatst bezocht
var vendors = {};    // eerste helft van een MAC-adres -> fabrikant (of "" als die onbekend is)

function load() {
  try { var list = JSON.parse(fs.readFileSync(FILE, "utf8")).people; return Array.isArray(list) ? list : []; }
  catch (e) { return []; }
}

function save() {
  try {
    var dir = path.dirname(FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify({ people: people }, null, 2));
  } catch (e) { console.error("[aanwezigheid]", e.message); }
}

function cleanIp(addr) {
  return String(addr || "").replace("::ffff:", "");
}

// Alleen een adres op het thuisnetwerk; dat gaat ook als argument naar ping
function lanIp(addr) {
  var m = cleanIp(addr).match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m || [m[1], m[2], m[3], m[4]].some(function(n) { return +n > 255; })) return null;
  var a = +m[1], b = +m[2];
  return (a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)) ? m[0] : null;
}

// "iPhone" of "Android" als de browser zich als telefoon meldt, anders null. Een Android-tablet mist het woord
// Mobile, en een iPad doet zich voor als Mac; die vallen dus allebei af.
function phoneType(req) {
  var ua = String((req.headers && req.headers["user-agent"]) || "");
  if (/iPhone|iPod/.test(ua)) return "iPhone";
  if (/Android/.test(ua) && /Mobile/.test(ua)) return "Android";
  return null;
}

function run(cmd, args, cb) {
  execFile(cmd, args, { timeout: 5000, windowsHide: true }, function(err, stdout) { cb(err, String(stdout || "")); });
}

// cb(true) als het apparaat antwoordt
function ping(ip, cb) {
  run("ping", WINDOWS ? ["-n", "1", "-w", "1000", ip] : ["-c", "1", "-W", "1", ip], function(err, out) {
    cb(!err && (!WINDOWS || /TTL=/i.test(out)));
  });
}

// De buurtabel van het besturingssysteem: { ip: { mac, fresh } }. fresh betekent dat het apparaat zojuist nog
// op het netwerk heeft geantwoord; een oude regel blijft namelijk lang staan nadat iemand is vertrokken.
function parseNeighbors(out) {
  var table = {};
  String(out || "").split(/\r?\n/).forEach(function(line) {
    var m = WINDOWS
      ? line.match(/^\s*(\d+\.\d+\.\d+\.\d+)\s+([0-9a-f]{2}(?:-[0-9a-f]{2}){5})\s+dynami/i)
      : line.match(/^(\d+\.\d+\.\d+\.\d+)\s.*\blladdr\s+([0-9a-f]{2}(?::[0-9a-f]{2}){5})\s+(\w+)/i);
    if (m) table[m[1]] = { mac: m[2].toLowerCase().replace(/-/g, ":"), fresh: !WINDOWS && m[3] === "REACHABLE" };
  });
  return table;
}

function neighbors(cb) {
  run(WINDOWS ? "arp" : "ip", WINDOWS ? ["-a"] : ["neigh", "show"], function(err, out) { cb(parseNeighbors(out)); });
}

// Het adres van de router. Wie VloedHub thuis via het adres van buiten opent, komt binnen als de router zelf.
function gateway(cb) {
  if (WINDOWS) return cb(null);
  run("ip", ["route", "show", "default"], function(err, out) {
    var m = out.match(/default via (\d+\.\d+\.\d+\.\d+)/);
    cb(m ? m[1] : null);
  });
}

function ownIps() {
  var list = [];
  Object.keys(os.networkInterfaces()).forEach(function(name) {
    os.networkInterfaces()[name].forEach(function(a) { if (a.family === "IPv4" && !a.internal) list.push(a.address); });
  });
  return list;
}

function markSeen(p) {
  p.lastSeen = Date.now();
  if (p.home) return false;
  p.home = true;
  p.since = p.lastSeen;
  return true;
}

// Na een herstart krijgt iedereen eerst de tijd om gevonden te worden
function markAway(p) {
  if (!p.home || Date.now() - Math.max(p.lastSeen || 0, startedAt) < AWAY_AFTER) return false;
  p.home = false;
  p.since = p.lastSeen || Date.now();
  return true;
}

// Zoekt iedereen op zijn bekende adres; table is de buurtabel van daarna
function locate(table, answered) {
  var changed = false;
  people.forEach(function(p) {
    var entry = table[p.ip];
    var seen = entry ? entry.mac === p.mac && (answered[p.ip] || entry.fresh) : !!answered[p.ip];
    if (!seen) {
      // een ander adres gekregen van de router?
      Object.keys(table).forEach(function(ip) {
        if (!seen && table[ip].mac === p.mac && (answered[ip] || table[ip].fresh)) { p.ip = ip; seen = true; changed = true; }
      });
    }
    if (seen ? markSeen(p) : markAway(p)) changed = true;
  });
  if (changed) save();
}

function pingAll(ips, cb) {
  var answered = {}, i = 0;
  (function next() {
    var batch = ips.slice(i, i + SWEEP_BATCH), left = batch.length;
    i += SWEEP_BATCH;
    if (!left) return cb(answered);
    batch.forEach(function(ip) {
      ping(ip, function(ok) { if (ok) answered[ip] = true; if (!--left) next(); });
    });
  })();
}

// Alle adressen van het thuisnetwerk aantikken, zodat een telefoon met een nieuw adres in de buurtabel komt
function sweepIps() {
  var own = ownIps().map(lanIp).filter(Boolean)[0];
  if (!own) return [];
  var base = own.split(".").slice(0, 3).join("."), list = [];
  for (var n = 1; n < 255; n++) if (base + "." + n !== own) list.push(base + "." + n);
  return list;
}

function check() {
  if (busy || !people.length || !modules.isOn("aanwezigheid")) return;
  busy = true;
  var now = Date.now();
  var lost = people.some(function(p) { return now - Math.max(p.lastSeen || 0, startedAt) > SWEEP_AFTER; });
  var sweep = lost && now - lastSweep > SWEEP_PAUSE;
  if (sweep) lastSweep = now;
  var ips = sweep ? sweepIps() : people.map(function(p) { return p.ip; }).filter(lanIp);
  pingAll(ips, function(answered) {
    neighbors(function(table) {
      locate(table, answered);
      busy = false;
    });
  });
}

// Wat voor apparaat een aanvraag doet, voor zover de browser dat zegt
function visitorLabel(req) {
  var ua = String((req.headers && req.headers["user-agent"]) || "");
  if (!ua) return null;
  if (/ESP32|ESP8266|ESPHome|esp-idf/i.test(ua)) return "ESP-apparaat van VloedHub";
  if (/iPhone|iPod/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? "Android-telefoon" : "Android-tablet";
  if (/Windows/.test(ua)) return "Windows-computer";
  if (/Macintosh/.test(ua)) return "Mac of iPad";
  if (/Linux|X11/.test(ua)) return "Linux-computer";
  return ua.split(/[\/ ]/)[0].slice(0, 30);
}

// Een aanvraag vanaf het adres van een aangemelde telefoon, met de browser van zo'n telefoon, bewijst dat die thuis is.
// Van elk adres op het thuisnetwerk wordt ook onthouden wat voor apparaat het was, voor de netwerkscan.
function sawRequest(req) {
  var ip = lanIp(req.socket.remoteAddress), label = ip && visitorLabel(req);
  if (label && (visitors[ip] || Object.keys(visitors).length < 300)) visitors[ip] = { label: label, at: Date.now() };
  if (!ip || !people.length) return;
  var type = phoneType(req);
  people.forEach(function(p) { if (p.ip === ip && type && type === p.type && markSeen(p)) save(); });
}

// Telefoons, tablets en laptops gebruiken op wifi meestal een zelfverzonnen (privé) MAC-adres in plaats van dat
// van de fabrikant; dat is te zien aan het tweede teken
function privateMac(mac) {
  return /^.[26ae]/i.test(mac);
}

// De naam die het apparaat zelf aan het modem heeft opgegeven, als het modem die doorgeeft
function hostname(ip, cb) {
  var done = false, resolver = new dns.Resolver({ timeout: 1500, tries: 1 });
  function finish(name) { if (done) return; done = true; cb(name); }
  setTimeout(function() { finish(null); }, 2500);
  try { resolver.reverse(ip, function(err, names) { finish(!err && names && names[0] && names[0] !== ip ? names[0] : null); }); }
  catch (e) { finish(null); }
}

// De fabrikant bij een MAC-adres. Eerst uit een lijst die op de server kan staan (van nmap, arp-scan of
// ieee-data); anders wordt de eerste helft van het adres nagevraagd bij macvendors.com. Dat deel zegt alleen
// welke fabrikant het is, niet welk apparaat.
var OUI_FILES = ["/usr/share/nmap/nmap-mac-prefixes", "/usr/share/arp-scan/ieee-oui.txt", "/usr/share/ieee-data/oui.txt"];
var ouiList = null;
function loadOui() {
  ouiList = {};
  OUI_FILES.some(function(file) {
    var text;
    try { text = fs.readFileSync(file, "utf8"); } catch (e) { return false; }
    text.split(/\r?\n/).forEach(function(line) {
      var m = line.match(/^([0-9A-F]{6})\s+(?:\(base 16\)\s+)?(\S.*)$/i);
      if (m) ouiList[m[1].toLowerCase()] = m[2].trim();
    });
    return Object.keys(ouiList).length > 0;
  });
}

function vendor(mac, cb) {
  if (privateMac(mac)) return cb(null);
  var prefix = mac.replace(/:/g, "").slice(0, 6);
  if (!ouiList) loadOui();
  if (ouiList[prefix]) return cb(ouiList[prefix]);
  if (vendors[prefix] !== undefined) return cb(vendors[prefix] || null);
  httpget.get("https://api.macvendors.com/" + prefix, function(err, text) {
    // een onbekende fabrikant geeft een fout; bij te veel vragen achter elkaar ook, dus dan niets onthouden
    var busyNow = err && /429/.test(err.message);
    if (!busyNow) vendors[prefix] = err ? "" : String(text).trim().slice(0, 60);
    // de dienst staat één vraag per seconde toe
    setTimeout(function() { cb(vendors[prefix] || null); }, 1100);
  });
}

// Vult per gevonden apparaat aan wat er over te achterhalen is: een voor een, om de fabrikantendienst niet te overvragen
function describe(list, cb) {
  var cam = camera.parseHost(camera.getStatus().host || "");
  var i = 0;
  (function next() {
    var d = list[i++];
    if (!d) return cb(list);
    d.private_mac = privateMac(d.mac);
    d.camera = !!cam && cam.hostname === d.ip;
    d.visited_as = visitors[d.ip] ? visitors[d.ip].label : null;
    hostname(d.ip, function(name) {
      d.hostname = name;
      vendor(d.mac, function(v) { d.vendor = v; next(); });
    });
  })();
}

// Zoekt het hele thuisnetwerk af en geeft terug wat er nu op antwoordt, met wat er over elk apparaat bekend is:
// cb(fout, [{ ip, mac, name, router, camera, hostname, vendor, private_mac, visited_as }]).
// Een telefoon in slaapstand kan ontbreken. De aangemelde telefoons worden meteen bijgewerkt.
function scan(cb) {
  if (busy) return cb("Er loopt al een controle, probeer het zo nog eens");
  busy = true;
  lastSweep = Date.now();
  pingAll(sweepIps(), function(answered) {
    neighbors(function(table) {
      gateway(function(gw) {
        locate(table, answered);
        var list = Object.keys(table).filter(function(ip) { return answered[ip] || table[ip].fresh; }).map(function(ip) {
          var p = people.filter(function(x) { return x.mac === table[ip].mac; })[0];
          return { ip: ip, mac: table[ip].mac, name: p ? p.name : null, router: ip === gw };
        });
        list.sort(function(a, b) { return +a.ip.split(".")[3] - +b.ip.split(".")[3]; });
        describe(list, function() { busy = false; cb(null, list); });
      });
    });
  });
}

// Meldt de telefoon aan die deze aanvraag doet, of geeft hem een andere naam. cb(foutmelding of null)
function claim(req, name, cb) {
  name = String(name || "").trim().slice(0, 30);
  if (!name) return cb("Vul een naam in");
  var type = phoneType(req);
  if (!type) return cb("Aanmelden kan alleen vanaf een telefoon (iPhone of Android)");
  var ip = lanIp(req.socket.remoteAddress);
  if (!ip || ownIps().indexOf(ip) !== -1) return cb("Open VloedHub op de telefoon zelf, verbonden met de wifi thuis");
  gateway(function(gw) {
    if (ip === gw) return cb("Open VloedHub via het adres op het thuisnetwerk, niet via het adres van buiten");
    ping(ip, function() {
      neighbors(function(table) {
        var mac = table[ip] && table[ip].mac;
        if (!mac) return cb("De server kan deze telefoon niet vinden op het netwerk");
        var p = people.filter(function(x) { return x.mac === mac; })[0];
        if (!p) {
          if (people.length >= MAX_PEOPLE) return cb("Er zijn al " + MAX_PEOPLE + " telefoons aangemeld");
          p = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), mac: mac, home: false, since: null, lastSeen: 0 };
          people.push(p);
        }
        p.name = name;
        p.type = type;
        p.ip = ip;
        markSeen(p);
        save();
        cb(null);
      });
    });
  });
}

function remove(id) {
  var before = people.length;
  people = people.filter(function(p) { return p.id !== String(id); });
  if (people.length !== before) save();
}

// Voor de browser; het MAC-adres blijft op de server
function getStatus(req) {
  var ip = cleanIp(req.socket.remoteAddress);
  var me = people.filter(function(p) { return p.ip === ip; })[0];
  return {
    people: people.map(function(p) { return { id: p.id, name: p.name, type: p.type || null, home: !!p.home, since: p.since || null, last_seen: p.lastSeen || null }; }),
    me: { local: !!lanIp(ip) && ownIps().indexOf(ip) === -1, phone: !!phoneType(req), id: me ? me.id : null },
    away_after_min: AWAY_AFTER / 60000
  };
}

function start() {
  setTimeout(check, 5000);
  setInterval(check, CHECK_INTERVAL);
}

module.exports = { getStatus: getStatus, claim: claim, remove: remove, sawRequest: sawRequest, scan: scan, check: check, start: start, parseNeighbors: parseNeighbors };

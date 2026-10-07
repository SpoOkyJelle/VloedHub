var https = require("https");
var auth = require("./auth");
var discord = require("./discord");
var modules = require("./modules");
var notified = require("./notified");

// Stroom- en gasstoringen van netbeheerder Enexis voor Breda.
// Er is geen openbare API; de gegevens staan ingebed in de storingenpagina van Enexis en worden
// daaruit gelezen. Verandert Enexis die pagina, dan vindt deze code niets meer (en meldt dat).
var PLACE = "breda";
var PAGE_URL = "https://www.enexis.nl/storingen-en-onderhoud/" + PLACE;
var CACHE_TTL = 10 * 60 * 1000;
var CHECK_INTERVAL = 10 * 60 * 1000;

var cache = { data: null, fetchedAt: 0 };

function fetchPage(cb) {
  var req = https.get(PAGE_URL, { headers: { "User-Agent": "Mozilla/5.0 (VloedHub)" }, timeout: 20000 }, function(res) {
    if (res.statusCode !== 200) { res.resume(); return cb(new Error("HTTP " + res.statusCode)); }
    var chunks = "";
    res.setEncoding("utf8");
    res.on("data", function(c) { chunks += c; });
    res.on("end", function() { cb(null, chunks); });
  });
  req.on("timeout", function() { req.destroy(new Error("timeout")); });
  req.on("error", cb);
}

// Haalt de storingen uit de pagina: [{ id, kind, status, when, whenLabel, postcodes, postcodeText, url }]
function parse(html) {
  var s = html.replace(/\\"/g, '"');
  var re = /\{"id":"(\d+)","alert":"([^"]*)","link":\{"value":\{"text":"[^"]*","href":"([^"]*)"\}\},"summary":\[(.*?)\]\}/g;
  var itemRe = /\{"id":"\d+-([a-zA-Z]+)",(?:"icon":"[^"]*",)?"title":"([^"]*)","text":"([^"]*)"/g;
  var out = [], seen = {}, m;
  while ((m = re.exec(s))) {
    if (seen[m[1]]) continue;
    seen[m[1]] = true;
    var entry = { id: m[1], kind: null, status: null, when: null, whenLabel: null, postcodes: [], postcodeText: "", url: "https://www.enexis.nl" + m[3] };
    var it;
    itemRe.lastIndex = 0;
    while ((it = itemRe.exec(m[4]))) {
      if (it[1] === "type") { entry.kind = it[2]; entry.status = it[3]; }
      if (it[1] === "recoveryDate") { entry.whenLabel = it[2]; entry.when = it[3]; }
      if (it[1] === "postalCodes") {
        entry.postcodeText = it[3];
        entry.postcodes = (it[3].match(/\b\d{4}[A-Z]{2}\b/g) || []);
      }
    }
    if (entry.kind) out.push(entry);
  }
  return out;
}

function isOpen(e) {
  return !/opgelost|geannuleerd/i.test(e.status || "");
}

// Bepaalt wat er voor een postcode speelt.
//  - mine:   storingen en geplande onderbrekingen met precies deze postcode
//  - nearby: zelfde viercijferige wijk, of een grote storing waarvan de postcodes niet op de pagina staan
function relevant(entries, postcode) {
  var open = entries.filter(isOpen);
  var result = { mine: [], nearby: [], total_open: open.filter(function(e) { return e.status !== "Gepland"; }).length };
  if (!postcode) return result;
  var area = postcode.slice(0, 4);
  open.forEach(function(e) {
    var item = { id: e.id, kind: e.kind, planned: e.status === "Gepland", status: e.status, when: e.when, whenLabel: e.whenLabel, url: e.url };
    if (e.postcodes.indexOf(postcode) !== -1) result.mine.push(item);
    else if (e.postcodes.some(function(p) { return p.slice(0, 4) === area; }) || (!e.postcodes.length && !item.planned)) result.nearby.push(item);
  });
  return result;
}

function getPostcode() {
  var afval = auth.readConfig().afval;
  return afval && afval.postcode ? afval.postcode : null;
}

function fetchStatus(cb) {
  var postcode = getPostcode();
  function done(entries) {
    var r = relevant(entries, postcode);
    cb(null, { ok: true, postcode: postcode, place: PLACE, mine: r.mine, nearby: r.nearby, total_open: r.total_open });
  }
  if (cache.data && Date.now() - cache.fetchedAt < CACHE_TTL) return done(cache.data);
  fetchPage(function(err, html) {
    if (err) return cb(null, { ok: false, postcode: postcode, error: "Enexis niet bereikbaar" });
    var entries = parse(html);
    // De pagina bevat altijd ook opgeloste storingen; helemaal niets betekent dat de opbouw is veranderd
    if (!entries.length) return cb(null, { ok: false, postcode: postcode, error: "Storingen niet leesbaar (pagina van Enexis is gewijzigd)" });
    cache = { data: entries, fetchedAt: Date.now() };
    done(entries);
  });
}

// Eén Discord-bericht per storing of geplande onderbreking op je eigen postcode
function check() {
  if (!modules.isOn("storingen") || !getPostcode()) return;
  fetchStatus(function(err, s) {
    if (!s || !s.ok) return;
    s.mine.forEach(function(e) {
      var key = "outage:" + e.id + (e.planned ? ":gepland" : "");
      if (notified.has(key)) return;
      notified.add(key);
      discord.notify("storing", e.planned
        ? "🔌 **Geplande " + e.kind.toLowerCase() + " op " + s.postcode + "** — " + (e.when || "tijd onbekend") + "\n" + e.url
        : "⚡ **" + e.kind + " op " + s.postcode + "** — " + (e.status || "") + (e.when ? " · " + (e.whenLabel || "tijd") + ": " + e.when : "") + "\n" + e.url);
    });
  });
}

function start() {
  setTimeout(check, 60000);
  setInterval(check, CHECK_INTERVAL);
}

module.exports = { fetchStatus: fetchStatus, parse: parse, relevant: relevant, check: check, start: start };

var httpget = require("../utils/httpget");
var auth = require("./auth");
var discord = require("./discord");
var modules = require("./modules");
var notified = require("./notified");

// 112-meldingen (P2000: de oproepen aan brandweer, ambulance en politie) voor Breda, van alarmeringen.nl.
// Het blok toont de laatste; een melding krijg je alleen als je eigen straat wordt genoemd.
var PLACE = "breda";
var FEED_URL = "https://www.alarmeringen.nl/feeds/city/" + PLACE + ".rss";
var CACHE_TTL = 2 * 60 * 1000;
var CHECK_INTERVAL = 2 * 60 * 1000;
var FRESH = 30 * 60 * 1000;   // ouder dan dit wordt niet meer gemeld (bijv. na een herstart)

var cache = { data: null, fetchedAt: 0 };

function decode(s) {
  return String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&amp;/g, "&").trim();
}

function tag(item, name) {
  var m = item.match(new RegExp("<" + name + "[^>]*>([\\s\\S]*?)</" + name + ">"));
  return m ? decode(m[1]) : "";
}

// De ruwe oproep begint met de dienst en de prioriteit: "a1" is een ambulance met spoed, "p 1" de brandweer
function kindOf(raw, text) {
  if (/traumaheli|lifeliner/i.test(text + " " + raw)) return "heli";
  if (/ambulance/i.test(text) || /^a\s?\d/i.test(raw)) return "ambulance";
  if (/politie/i.test(text)) return "politie";
  if (/brand/i.test(text) || /^p\s?\d/i.test(raw)) return "brandweer";
  return "overig";
}

function parse(xml) {
  return (String(xml || "").match(/<item>[\s\S]*?<\/item>/g) || []).map(function(item) {
    var raw = tag(item, "title"), text = tag(item, "description"), at = new Date(tag(item, "pubDate"));
    var url = tag(item, "link").split("?")[0];
    return {
      id: tag(item, "guid") || raw, raw: raw, text: text || raw, kind: kindOf(raw, text),
      // een ambulancerit is meestal alleen "naar Breda", zonder adres
      located: !new RegExp(" naar " + PLACE + "$", "i").test(text || raw),
      at: isNaN(at.getTime()) ? null : at.toISOString(), url: /\.html$/.test(url) ? url : null
    };
  });
}

// "Vloed 63, Breda" -> "vloed"
function ownStreet() {
  var afval = auth.readConfig().afval;
  var m = afval && afval.straat ? String(afval.straat).match(/^\s*(\D+?)\s*\d/) : null;
  return m ? m[1].toLowerCase() : null;
}

function mentions(item, street) {
  if (!street) return false;
  var esc = street.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("(^|[^a-z])" + esc + "([^a-z]|$)").test((item.raw + " " + item.text).toLowerCase());
}

function fetchCalls(cb) {
  function done(items) {
    var street = ownStreet();
    cb(null, { ok: true, place: PLACE, calls: items.map(function(i) { return Object.assign({ own_street: mentions(i, street) }, i); }) });
  }
  if (cache.data && Date.now() - cache.fetchedAt < CACHE_TTL) return done(cache.data);
  httpget.get(FEED_URL, function(err, xml) {
    var items = err ? [] : parse(xml);
    if (!items.length) return cb(null, { ok: false, calls: [], error: "112-meldingen niet bereikbaar" });
    cache = { data: items, fetchedAt: Date.now() };
    done(items);
  });
}

function check() {
  if (!modules.isOn("p2000") || !ownStreet()) return;
  fetchCalls(function(err, r) {
    if (!r || !r.ok) return;
    r.calls.forEach(function(c) {
      if (!c.own_street || !c.at || Date.now() - Date.parse(c.at) > FRESH) return;
      var key = "p2000:" + c.id;
      if (notified.has(key)) return;
      notified.add(key);
      discord.notify("p2000", "🚨 **112-melding in jouw straat** — " + c.text + (c.url ? "\n" + c.url : ""));
    });
  });
}

function start() {
  setTimeout(check, 75000);
  setInterval(check, CHECK_INTERVAL);
}

module.exports = { fetchCalls: fetchCalls, parse: parse, check: check, start: start };

var https = require("https");
var auth  = require("./auth");
var discord = require("./discord");
var modules = require("./modules");

// Gemeente Breda gebruikt het Burgerportaal (21South) voor de afvalkalender.
// Er is geen officiële API; dit zijn dezelfde aanroepen als de Afvalservice-app doet.
var API_KEY  = "AIzaSyA6NkRqJypTfP-cjWzrZNFJzPUbBaGjOdk";
var ORG_ID   = "452048812597352613"; // Gemeente Breda
var BASE_URL = "https://europe-west3-burgerportaal-production.cloudfunctions.net/exposed/organisations/" + ORG_ID;

var FRACTIONS = {
  "GFT":   { label: "GFT",       icon: "leaf",         color: "#4ADE80" },
  "GFT+E": { label: "GFT",       icon: "leaf",         color: "#4ADE80" },
  "OPK":   { label: "Papier",    icon: "newspaper",    color: "#38BDF8" },
  "PBD":   { label: "PMD",       icon: "bottle-water", color: "#F97316" },
  "PMD":   { label: "PMD",       icon: "bottle-water", color: "#F97316" },
  "REST":  { label: "Restafval", icon: "trash",        color: "#94A3B8" }
};

var CACHE_TTL = 6 * 60 * 60 * 1000;
var refreshToken = null;
var idToken = { value: null, expiresAt: 0 };
var cache = { key: null, data: null, fetchedAt: 0 };

function request(method, url, headers, body, cb) {
  var req = https.request(url, { method: method, headers: headers || {}, timeout: 15000 }, function(res) {
    var chunks = "";
    res.on("data", function(c) { chunks += c; });
    res.on("end", function() {
      if (res.statusCode < 200 || res.statusCode >= 300) return cb(new Error("HTTP " + res.statusCode));
      try { cb(null, JSON.parse(chunks)); } catch (e) { cb(e); }
    });
  });
  req.on("timeout", function() { req.destroy(new Error("timeout")); });
  req.on("error", cb);
  if (body) req.write(body);
  req.end();
}

// Anoniem aanmelden levert een refresh-token op; daarmee halen we elk uur een nieuw id-token.
function getToken(cb) {
  if (idToken.value && Date.now() < idToken.expiresAt) return cb(null, idToken.value);

  function refresh() {
    request("POST", "https://securetoken.googleapis.com/v1/token?key=" + API_KEY,
      { "Content-Type": "application/x-www-form-urlencoded" },
      "grant_type=refresh_token&refresh_token=" + encodeURIComponent(refreshToken),
      function(err, json) {
        if (err || !json.id_token) { refreshToken = null; return cb(err || new Error("geen token")); }
        idToken = { value: json.id_token, expiresAt: Date.now() + 50 * 60 * 1000 };
        cb(null, idToken.value);
      });
  }

  if (refreshToken) return refresh();
  request("POST", "https://www.googleapis.com/identitytoolkit/v3/relyingparty/signupNewUser?key=" + API_KEY,
    { "Content-Type": "application/json" }, "{}",
    function(err, json) {
      if (err || !json.refreshToken) return cb(err || new Error("aanmelden mislukt"));
      refreshToken = json.refreshToken;
      refresh();
    });
}

function getAddress() {
  return auth.readConfig().afval || null;
}

// Zoekt het adres op bij de gemeente; cb(null, null) als het niet bestaat.
function lookupAddress(addr, cb) {
  getToken(function(err, token) {
    if (err) return cb(err);
    request("GET", BASE_URL + "/address?zipcode=" + addr.postcode + "&housenumber=" + addr.huisnummer,
      { authorization: token }, null,
      function(err2, list) {
        if (err2) return cb(err2);
        var wanted = (addr.toevoeging || "").toLowerCase();
        var match = (list || []).filter(function(a) { return (a.addition || "").toLowerCase() === wanted; })[0];
        if (!match && !wanted) match = (list || [])[0];
        cb(null, match || null);
      });
  });
}

function setAddress(addr, cb) {
  lookupAddress(addr, function(err, match) {
    if (err) return cb(err);
    if (!match) return cb(null, null);
    var cfg = auth.readConfig();
    cfg.afval = {
      postcode: addr.postcode,
      huisnummer: addr.huisnummer,
      toevoeging: addr.toevoeging || "",
      addressId: match.addressId,
      straat: match.street + " " + match.housenumber + (match.addition || "") + ", " + match.city
    };
    auth.writeConfig(cfg);
    cache = { key: null, data: null, fetchedAt: 0 };
    cb(null, cfg.afval);
  });
}

function today() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Amsterdam" });
}

function upcoming(pickups) {
  var now = today();
  var nowMs = Date.parse(now + "T00:00:00Z");
  return pickups
    .filter(function(p) { return p.date >= now; })
    .slice(0, 6)
    .map(function(p) {
      var f = FRACTIONS[p.fraction] || { label: p.fraction, icon: "trash-can", color: "#94A3B8" };
      return {
        date: p.date,
        days: Math.round((Date.parse(p.date + "T00:00:00Z") - nowMs) / 86400000),
        fraction: p.fraction,
        label: f.label,
        icon: f.icon,
        color: f.color
      };
    });
}

function fetchCalendar(cb) {
  var addr = getAddress();
  if (!addr || !addr.addressId) return cb(null, { configured: false });

  function result() {
    return { configured: true, address: addr.straat, pickups: upcoming(cache.data) };
  }

  if (cache.key === addr.addressId && cache.data && Date.now() - cache.fetchedAt < CACHE_TTL) {
    return cb(null, result());
  }

  getToken(function(err, token) {
    if (err) return cb(err);
    request("GET", BASE_URL + "/address/" + addr.addressId + "/calendar", { authorization: token }, null,
      function(err2, list) {
        if (err2) return cb(err2);
        var pickups = (list || [])
          .filter(function(i) { return i.collectionDate && i.fraction; })
          .map(function(i) { return { date: i.collectionDate.slice(0, 10), fraction: i.fraction.trim().toUpperCase() }; })
          .sort(function(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
        cache = { key: addr.addressId, data: pickups, fetchedAt: Date.now() };
        cb(null, result());
      });
  });
}

// Herinnering: de avond voor een ophaaldag (vanaf 21:00) één Discord-bericht.
var REMINDER_HOUR = 21;

function checkReminder() {
  if (!modules.isOn("afval")) return;
  var addr = getAddress();
  if (!addr || !addr.addressId) return;
  var hour = parseInt(new Date().toLocaleString("sv-SE", { timeZone: "Europe/Amsterdam" }).slice(11, 13), 10);
  if (hour < REMINDER_HOUR) return;
  var tomorrow = new Date(Date.parse(today() + "T00:00:00Z") + 86400000).toISOString().slice(0, 10);
  if (addr.lastReminder === tomorrow) return;

  fetchCalendar(function(err, data) {
    if (err || !data.configured) return;
    var cfg = auth.readConfig();
    if (!cfg.afval) return;
    cfg.afval.lastReminder = tomorrow;
    auth.writeConfig(cfg);
    var labels = data.pickups.filter(function(p) { return p.days === 1; }).map(function(p) { return p.label; });
    if (!labels.length) return;
    discord.notify("afval", "🗑️ **Morgen wordt opgehaald: " + labels.join(" en ") + "** — zet het vanavond buiten.");
  });
}

function startReminder() {
  setTimeout(checkReminder, 30000);
  setInterval(checkReminder, 10 * 60 * 1000);
}

module.exports = {
  startReminder: startReminder,
  fetchCalendar: fetchCalendar,
  getAddress: getAddress,
  setAddress: setAddress
};

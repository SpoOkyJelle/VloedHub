var https = require("https");
var fs = require("fs");
var path = require("path");
var modules = require("./modules");
var discord = require("./discord");

// Slimme verwarming via de officiële tado° REST-API.
// Sinds maart 2025 is inloggen met gebruikersnaam/wachtwoord eruit; koppelen gaat met de "device flow":
// VloedHub vraagt een code aan, jij keurt die één keer goed op login.tado.com (ingelogd op je tado-account),
// daarna houdt de server zelf het token vers. Er is geen developer-app of client-secret nodig — tado
// gebruikt een vaste, publieke client-id. Tokens staan in data/tado.json (niet in git).
// De API heeft geen live-stream zoals Home Connect, dus de zones worden gepolld.
var AUTH_HOST = "login.tado.com";
var API_HOST = "my.tado.com";
var CLIENT_ID = "1bb50063-6b0c-4d11-bd99-387f4a91cc46";
var SCOPE = "offline_access"; // vraagt een refresh-token aan, zodat de koppeling blijft werken
var CONFIG_FILE = path.join(__dirname, "../data/tado.json");

var POLL_MS = 45 * 1000;        // de API heeft geen limiet zoals Home Connect, maar elke 45 s is ruim genoeg
var RETRY_MS = 5 * 60 * 1000;
var DEFAULT_FROST = 5;          // °C: onder deze kamertemperatuur komt er een vorstwaarschuwing
var FROST_RELEASE = 1;          // pas weer opnieuw melden als het een graad boven de grens is gekomen (hysterese)
var MIN_SET = 5, MAX_SET = 25;  // tado staat instellen toe tussen 5 en 25 °C

var pending = null;             // lopende koppeling: { user_code, url, expires }
var linkError = null;
var zones = [];                 // laatst opgehaalde zones, zie parseZone
var lastUpdate = null;
var alerts = {};                // per zone onthouden waarover al gemeld is (offline/vorst), zodat er niet herhaald wordt
var pollTimer = null, generation = 0;

function load() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")); } catch (e) { return {}; }
}

function save(cfg) {
  var dir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

function form(obj) {
  return Object.keys(obj).filter(function(k) { return obj[k]; })
    .map(function(k) { return encodeURIComponent(k) + "=" + encodeURIComponent(obj[k]); }).join("&");
}

// cb(err, status, body) — body is het geparste JSON-antwoord, of {} als dat er niet is
function request(host, method, urlPath, headers, body, cb) {
  var req = https.request({ hostname: host, path: urlPath, method: method, headers: headers, timeout: 20000 }, function(res) {
    var chunks = "";
    res.on("data", function(c) { chunks += c; });
    res.on("end", function() {
      var data = {};
      try { data = JSON.parse(chunks); } catch (e) {}
      cb(null, res.statusCode, data);
    });
  });
  req.on("timeout", function() { req.destroy(new Error("timeout")); });
  req.on("error", function(e) { cb(e); });
  if (body) req.write(body);
  req.end();
}

function oauth(endpoint, params, cb) {
  var body = form(params);
  request(AUTH_HOST, "POST", "/oauth2/" + endpoint,
    { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(body) }, body, cb);
}

function oauthMessage(data, fallback) {
  var d = data && (data.error_description || data.error);
  return d ? String(d) : fallback;
}

function storeTokens(t) {
  var cfg = load();
  cfg.tokens = {
    access_token: t.access_token,
    // tado roteert de refresh-token bij elke verversing; de oude vervalt dan, dus bewaar altijd de nieuwste
    refresh_token: t.refresh_token || (cfg.tokens && cfg.tokens.refresh_token),
    expires_at: Date.now() + (t.expires_in || 600) * 1000
  };
  save(cfg);
}

// ── Koppelen ────────────────────────────────────────────────────────────────
function startLink(cb) {
  linkError = null;
  oauth("device_authorize", { client_id: CLIENT_ID, scope: SCOPE }, function(err, status, data) {
    if (err) return cb("tado is niet bereikbaar");
    if (status !== 200 || !data.device_code) return cb(oauthMessage(data, "Aanvraag geweigerd (" + status + ")"));
    var mine = pending = {
      user_code: data.user_code,
      url: data.verification_uri_complete || data.verification_uri,
      expires: Date.now() + (data.expires_in || 300) * 1000
    };
    var wait = Math.max(5, data.interval || 5) * 1000;
    (function poll() {
      setTimeout(function() {
        if (pending !== mine) return;
        if (Date.now() > mine.expires) { pending = null; linkError = "De code is verlopen, probeer opnieuw"; return; }
        oauth("token", { grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: data.device_code, client_id: CLIENT_ID }, function(e, st, tok) {
          if (pending !== mine) return;
          if (!e && st === 200 && tok.access_token) {
            pending = null;
            storeTokens(tok);
            findHome(function() { start(); });
            return;
          }
          var code = tok && tok.error;
          if (e || code === "authorization_pending") return poll();
          if (code === "slow_down") { wait += 5000; return poll(); }
          pending = null;
          linkError = code === "access_denied" ? "Koppelen is geweigerd" : oauthMessage(tok, "Koppelen mislukt");
        });
      }, wait);
    })();
    cb(null, { user_code: mine.user_code, url: mine.url });
  });
}

function unlink() {
  pending = null; linkError = null;
  stopPolling();
  var cfg = load();
  // de vorstgrens is een voorkeur, geen koppeling: die blijft bewaard
  save(cfg.frostThreshold != null ? { frostThreshold: cfg.frostThreshold } : {});
  zones = []; lastUpdate = null; alerts = {};
}

// ── Token ─────────────────────────────────────────────────────────────────
var refreshing = null;
function accessToken(cb) {
  var cfg = load(), t = cfg.tokens;
  if (!t || !t.refresh_token) return cb("niet gekoppeld");
  // de access-token leeft maar ~10 min; vernieuw hem ruim voor hij verloopt
  if (t.access_token && t.expires_at - Date.now() > 60 * 1000) return cb(null, t.access_token);
  if (refreshing) return refreshing.push(cb);
  refreshing = [cb];
  oauth("token", { grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: CLIENT_ID }, function(err, status, data) {
    var waiting = refreshing; refreshing = null;
    var error = null;
    if (err) error = "tado is niet bereikbaar";
    else if (status !== 200 || !data.access_token) {
      error = oauthMessage(data, "Token verversen mislukt (" + status + ")");
      // de koppeling is ingetrokken of de refresh-token is verlopen: opnieuw koppelen nodig
      if (data.error === "invalid_grant") {
        var c = load(); delete c.tokens; save(c);
        linkError = "De koppeling is verlopen, koppel opnieuw";
      }
      console.error("[tado] token:", error);
    } else storeTokens(data);
    waiting.forEach(function(w) { w(error, error ? null : data.access_token); });
  });
}

// cb(err, status, body). body wordt als JSON verstuurd als het meegegeven is.
function api(method, urlPath, body, cb) {
  accessToken(function(err, token) {
    if (err) return cb(err);
    var headers = { Authorization: "Bearer " + token, Accept: "application/json" };
    var payload = body ? JSON.stringify(body) : null;
    if (payload) { headers["Content-Type"] = "application/json"; headers["Content-Length"] = Buffer.byteLength(payload); }
    request(API_HOST, method, urlPath, headers, payload, cb);
  });
}

// ── Huis en zones ───────────────────────────────────────────────────────────
function findHome(cb) {
  api("GET", "/api/v2/me", null, function(err, status, body) {
    if (err || status !== 200 || !body.homes || !body.homes.length) {
      if (!err && status === 200) linkError = "Geen huis gevonden in dit tado-account";
      return cb && cb(null);
    }
    var cfg = load();
    cfg.homeId = body.homes[0].id;
    cfg.homeName = body.homes[0].name || "tado°";
    save(cfg);
    cb && cb(cfg.homeId);
  });
}

// Zet het onbewerkte zone-statusantwoord om naar wat de kaart nodig heeft
function parseZone(z, state) {
  var s = state.setting || {};
  var sensors = state.sensorDataPoints || {};
  var inside = sensors.insideTemperature || {};
  var hum = sensors.humidity || {};
  var heat = (state.activityDataPoints && state.activityDataPoints.heatingPower) || {};
  return {
    id: z.id,
    name: z.name,
    type: z.type,                                              // HEATING of HOT_WATER
    power: s.power || null,                                    // ON of OFF
    setpoint: s.temperature && s.temperature.celsius != null ? s.temperature.celsius : null,
    temperature: inside.celsius != null ? inside.celsius : null,
    humidity: hum.percentage != null ? hum.percentage : null,
    heatingPower: heat.percentage != null ? heat.percentage : null,
    openWindow: !!state.openWindow,
    overlay: !!state.overlay,                                  // true = handmatig gezet, schema onderbroken
    online: !state.link || state.link.state === "ONLINE"
  };
}

function poll() {
  clearTimeout(pollTimer);
  var gen = generation;
  var cfg = load();
  if (!cfg.tokens) return;
  if (!cfg.homeId) return findHome(function(id) { if (gen === generation) pollTimer = setTimeout(poll, id ? 0 : RETRY_MS); });

  api("GET", "/api/v2/homes/" + cfg.homeId + "/zones", null, function(err, status, list) {
    if (gen !== generation) return;
    if (err || status !== 200 || !Array.isArray(list)) return schedule(gen, RETRY_MS);
    // één statusoproep per zone; HOT_WATER-zones hebben geen kamertemperatuur maar passen in dezelfde kaart
    var queue = list.filter(function(z) { return z.type === "HEATING" || z.type === "HOT_WATER"; });
    var results = [], i = 0;
    (function next() {
      if (gen !== generation) return;
      if (i >= queue.length) { applyZones(results); return schedule(gen, POLL_MS); }
      var z = queue[i++];
      api("GET", "/api/v2/homes/" + cfg.homeId + "/zones/" + z.id + "/state", null, function(e, st, state) {
        if (!e && st === 200 && state && state.setting) results.push(parseZone(z, state));
        next();
      });
    })();
  });
}

function schedule(gen, ms) {
  if (gen !== generation) return;
  clearTimeout(pollTimer);
  pollTimer = setTimeout(poll, ms);
}

function stopPolling() {
  generation++;
  clearTimeout(pollTimer);
}

function applyZones(list) {
  zones = list;
  lastUpdate = Date.now();
  checkAlerts();
}

// Meldingen: een zone offline, of een kamer onder de vorstgrens. Beide melden één keer bij de overgang en
// opnieuw als het probleem weg is en terugkomt; een herstart van de server meldt een lopende storing opnieuw.
function checkAlerts() {
  if (!modules.isOn("tado")) return;
  var cfg = load();
  var frost = cfg.frostThreshold != null ? cfg.frostThreshold : DEFAULT_FROST;
  zones.forEach(function(z) {
    var offKey = z.id + ":offline";
    if (!z.online) {
      if (!alerts[offKey]) { alerts[offKey] = true; discord.notify("tado", "⚠️ **tado: " + z.name + " is offline** — de thermostaat of hub reageert niet"); }
    } else if (alerts[offKey]) {
      delete alerts[offKey];
      discord.notify("tado", "✅ **tado: " + z.name + " is weer online**");
    }

    var frostKey = z.id + ":frost";
    if (z.online && z.temperature != null && z.temperature < frost) {
      if (!alerts[frostKey]) { alerts[frostKey] = true; discord.notify("tado", "🥶 **tado: het is koud in " + z.name + "** — " + z.temperature.toFixed(1) + "°C (grens " + frost + "°C)"); }
    } else if (z.temperature != null && z.temperature >= frost + FROST_RELEASE) {
      delete alerts[frostKey];
    }
  });
}

// ── Bedienen ─────────────────────────────────────────────────────────────────
// opts: { temperature: getal } om te verwarmen, of { power: "OFF" } om uit te zetten.
// termination MANUAL = blijft zo tot je zelf iets anders instelt of terug naar het schema gaat.
function setZone(zoneId, opts, cb) {
  var cfg = load();
  if (!cfg.homeId) return cb("niet gekoppeld");
  var setting = { type: "HEATING" };
  if (opts.power === "OFF") setting.power = "OFF";
  else {
    var t = Number(opts.temperature);
    if (!(t >= MIN_SET && t <= MAX_SET)) return cb("Temperatuur moet tussen " + MIN_SET + " en " + MAX_SET + " °C liggen");
    setting.power = "ON";
    setting.temperature = { celsius: Math.round(t * 10) / 10 };
  }
  api("PUT", "/api/v2/homes/" + cfg.homeId + "/zones/" + zoneId + "/overlay", { setting: setting, termination: { type: "MANUAL" } }, function(err, status, data) {
    if (err) return cb("tado is niet bereikbaar");
    if (status !== 200 && status !== 201 && status !== 204) return cb(oauthMessage(data, "Instellen mislukt (" + status + ")"));
    poll(); // meteen verversen zodat de kaart de nieuwe stand toont
    cb(null);
  });
}

// Terug naar het verwarmingsschema (de handmatige instelling intrekken)
function resumeZone(zoneId, cb) {
  var cfg = load();
  if (!cfg.homeId) return cb("niet gekoppeld");
  api("DELETE", "/api/v2/homes/" + cfg.homeId + "/zones/" + zoneId + "/overlay", null, function(err, status, data) {
    if (err) return cb("tado is niet bereikbaar");
    if (status !== 200 && status !== 204) return cb(oauthMessage(data, "Terug naar schema mislukt (" + status + ")"));
    poll();
    cb(null);
  });
}

function setFrost(v) {
  v = Number(v);
  if (!(v >= 1 && v <= 15)) return false;
  var cfg = load();
  cfg.frostThreshold = Math.round(v * 10) / 10;
  save(cfg);
  checkAlerts();
  return true;
}

// ── Status ────────────────────────────────────────────────────────────────
function getStatus() {
  var cfg = load();
  if (pending && Date.now() > pending.expires) pending = null;
  return {
    linked: !!cfg.tokens,
    pending: pending ? { user_code: pending.user_code, url: pending.url } : null,
    error: linkError,
    homeName: cfg.homeName || null,
    frostThreshold: cfg.frostThreshold != null ? cfg.frostThreshold : DEFAULT_FROST,
    minSet: MIN_SET, maxSet: MAX_SET,
    zones: zones,
    updated: lastUpdate
  };
}

function start() {
  if (load().tokens) poll();
}

module.exports = {
  start: start, getStatus: getStatus, startLink: startLink, unlink: unlink,
  setZone: setZone, resumeZone: resumeZone, setFrost: setFrost,
  _parseZone: parseZone, _checkAlerts: checkAlerts
};

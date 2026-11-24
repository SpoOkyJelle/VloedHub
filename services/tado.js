var https = require("https");
var fs = require("fs");
var path = require("path");
var modules = require("./modules");
var discord = require("./discord");
var logging = require("../db/logging");

// Slimme verwarming via de officiële tado° cloud-API, afgestemd op de tado° X (de nieuwe generatie).
//
// Koppelen: sinds maart 2025 is inloggen met wachtwoord eruit; het gaat met de "device flow":
// VloedHub vraagt een code aan, jij keurt die één keer goed op login.tado.com (ingelogd op je tado-account),
// daarna houdt de server zelf het token vers. Er is geen developer-app, client-secret of Matter-code nodig —
// tado gebruikt een vaste, publieke client-id. Tokens staan in data/tado.json (niet in git).
//
// tado° X praat via een andere API dan de oudere V3+: de kamers en de bediening zitten op hops.tado.com
// (/homes/{id}/rooms), het home-id komt nog van de klassieke API (my.tado.com/api/v2/me).
//
// Let op de limiet: op het gratis plan staat tado maar ~100 API-verzoeken per dag toe (20.000 met een
// Auto-Assist-abonnement). Daarom pollt de server zuinig (standaard elke 30 min, instelbaar) en werkt hij
// de kaart na een bediening meteen zelf bij in plaats van opnieuw op te halen.
var AUTH_HOST = "login.tado.com";
var MY_HOST = "my.tado.com";       // /api/v2/me voor het home-id (en presence, nu niet gebruikt)
var HOPS_HOST = "hops.tado.com";   // tado° X: kamers uitlezen en bedienen
var CLIENT_ID = "1bb50063-6b0c-4d11-bd99-387f4a91cc46";
var SCOPE = "offline_access";      // vraagt een refresh-token aan, zodat de koppeling blijft werken
var CONFIG_FILE = path.join(__dirname, "../data/tado.json");

var DEFAULT_POLL_MIN = 30;         // zuinig i.v.m. de limiet van 100 verzoeken/dag op het gratis plan
var MIN_POLL_MIN = 10, MAX_POLL_MIN = 360;
// Opwarmanalyse: zolang een kamer actief stookt pollen we veel sneller (standaard elke 15 s), zodat de
// opwarmcurve fijnmazig in heating_readings komt (hoelang tot op peil?). Staat niets te stoken, dan valt
// de poll terug op de rustige kamer-cadans hierboven. Met Auto-Assist (20.000 verzoeken/dag) kan dat ruim:
// 15 s tijdens het stoken is ~240 verzoeken/uur, en buiten het stoken kost het niets extra.
var DEFAULT_HEATING_SEC = 15;
var MIN_HEATING_SEC = 5, MAX_HEATING_SEC = 600;
// presence (wie-thuis-is) heeft een eigen, snellere pollcyclus dan de kamers: zo verschijnt "thuis" sneller
// zonder de kamers vaker (en dus duurder) op te halen. In seconden, want dit mag veel sneller dan de kamers.
// Niet ingesteld = volgt de kamersnelheid, zodat een bestaande koppeling niet ongevraagd extra verbruikt.
var MIN_PRESENCE_SEC = 10, MAX_PRESENCE_SEC = 3600;
var RETRY_MS = 5 * 60 * 1000;
var RATE_RETRY_MS = 60 * 60 * 1000; // na een limiet-antwoord (429) pas over een uur opnieuw proberen
var DEFAULT_FROST = 5;             // °C: onder deze kamertemperatuur komt er een vorstwaarschuwing
var FROST_RELEASE = 1;             // pas weer opnieuw melden als het een graad boven de grens is (hysterese)
var MIN_SET = 5, MAX_SET = 25;     // tado staat instellen toe tussen 5 en 25 °C
var RATE_MSG = "tado API-limiet bereikt (100 verzoeken/dag op het gratis plan) — VloedHub probeert het later opnieuw";

var pending = null;                // lopende koppeling: { user_code, url, expires }
var linkError = null;
var rateLimited = false;
var zones = [];                    // laatst opgehaalde kamers, zie parseRoom
var lastUpdate = null;
var alerts = {};                   // per kamer onthouden waarover al gemeld is (offline/vorst), geen herhaling
var presence = { home: null, devices: [], updated: null };  // geofencing: wie is thuis (tado mobileDevices)
var pollTimer = null, presenceTimer = null, generation = 0;

function load() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")); } catch (e) { return {}; }
}

function save(cfg) {
  var dir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

function pollMs() {
  var m = load().pollMinutes;
  if (!(m >= MIN_POLL_MIN && m <= MAX_POLL_MIN)) m = DEFAULT_POLL_MIN;
  return m * 60 * 1000;
}

// Hoe vaak presence apart ververst wordt, in seconden. Niet (geldig) ingesteld: volg de kamer-pollsnelheid.
function effectivePresenceSec(cfg) {
  var s = cfg.presenceSeconds;
  if (s >= MIN_PRESENCE_SEC && s <= MAX_PRESENCE_SEC) return s;
  var m = (cfg.pollMinutes >= MIN_POLL_MIN && cfg.pollMinutes <= MAX_POLL_MIN) ? cfg.pollMinutes : DEFAULT_POLL_MIN;
  return m * 60;
}

function presenceMs() { return effectivePresenceSec(load()) * 1000; }

// Snelle poll-interval tijdens het stoken, in ms.
function heatingMs() {
  var s = load().heatingSeconds;
  if (!(s >= MIN_HEATING_SEC && s <= MAX_HEATING_SEC)) s = DEFAULT_HEATING_SEC;
  return s * 1000;
}

// Een kamer "stookt" als hij aan staat en warmte vraagt: stookpercentage > 0, of — als dat onbekend is —
// de kamer nog onder zijn setpoint zit. Zolang één kamer stookt pollen we op de snelle cadans.
function isHeating(z) {
  if (!z || z.power !== "ON") return false;
  if (z.heatingPower != null) return z.heatingPower > 0;
  return z.setpoint != null && z.temperature != null && z.temperature < z.setpoint;
}
function anyHeating() { return zones.some(isHeating); }

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
  var d = data && (data.error_description || data.error || data.title || data.message);
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
  pending = null; linkError = null; rateLimited = false;
  stopPolling();
  var cfg = load();
  // de voorkeuren (vorstgrens, pollsnelheid) zijn geen koppeling: die blijven bewaard
  var keep = {};
  if (cfg.frostThreshold != null) keep.frostThreshold = cfg.frostThreshold;
  if (cfg.pollMinutes != null) keep.pollMinutes = cfg.pollMinutes;
  if (cfg.heatingSeconds != null) keep.heatingSeconds = cfg.heatingSeconds;
  save(keep);
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
function api(host, method, urlPath, body, cb) {
  accessToken(function(err, token) {
    if (err) return cb(err);
    var headers = { Authorization: "Bearer " + token, Accept: "application/json" };
    var payload = body ? JSON.stringify(body) : null;
    if (payload) { headers["Content-Type"] = "application/json"; headers["Content-Length"] = Buffer.byteLength(payload); }
    request(host, method, urlPath, headers, payload, cb);
  });
}

// ── Huis en kamers ──────────────────────────────────────────────────────────
function findHome(cb) {
  api(MY_HOST, "GET", "/api/v2/me", null, function(err, status, body) {
    if (err || status !== 200 || !body.homes || !body.homes.length) {
      if (!err && status === 200) linkError = "Geen huis gevonden in dit tado-account";
      return cb && cb(null);
    }
    var cfg = load();
    cfg.homes = body.homes.map(function(h) { return { id: h.id, name: h.name || ("Huis " + h.id) }; });
    // alleen automatisch een huis kiezen als er nog geen geldige keuze is; een eigen keuze blijft staan
    var chosen = cfg.homes.filter(function(h) { return h.id === cfg.homeId; })[0] || cfg.homes[0];
    cfg.homeId = chosen.id;
    cfg.homeName = chosen.name;
    save(cfg);
    cb && cb(cfg.homeId);
  });
}

// Wisselen tussen huizen (wie er meerdere heeft). Leegt de kamers en haalt het gekozen huis meteen op.
function setHome(id) {
  var cfg = load();
  var h = (cfg.homes || []).filter(function(x) { return String(x.id) === String(id); })[0];
  if (!h) return false;
  if (cfg.homeId !== h.id) {
    cfg.homeId = h.id; cfg.homeName = h.name;
    save(cfg);
    zones = []; lastUpdate = null; alerts = {};
    presence = { home: null, devices: [], updated: null };
    if (cfg.tokens) { poll(); pollPresence(); }
  }
  return true;
}

// Waar een kamer getoond wordt: "both" (overal), "thuis", "home" (alleen het Home-blok) of "hidden"
var ROOM_VIEWS = ["both", "thuis", "home", "hidden"];
function setRoomView(zoneId, view) {
  if (ROOM_VIEWS.indexOf(view) === -1 || zoneId == null) return false;
  var cfg = load();
  if (!cfg.roomView) cfg.roomView = {};
  if (view === "both") delete cfg.roomView[zoneId];
  else cfg.roomView[zoneId] = view;
  save(cfg);
  return true;
}

// Zet een kamer uit het tado° X rooms-antwoord om naar wat de kaart nodig heeft
function parseRoom(r) {
  var s = r.setting || {};
  var sensors = r.sensorDataPoints || {};
  var inside = sensors.insideTemperature || {};
  var hum = sensors.humidity || {};
  var heat = r.heatingPower || {};
  return {
    id: r.id,
    name: r.name,
    power: s.power || null,                                    // ON of OFF
    setpoint: s.temperature && s.temperature.value != null ? s.temperature.value : null,
    temperature: inside.value != null ? inside.value : null,
    humidity: hum.percentage != null ? hum.percentage : null,
    heatingPower: heat.percentage != null ? heat.percentage : null,
    openWindow: !!(r.openWindow && r.openWindow.activated !== false),
    overlay: !!r.manualControlTermination,                     // handmatig gezet, schema onderbroken
    // tado° X meldt via de cloud geregeld kort connection.state "OFFLINE" terwijl het apparaat in de
    // tado-app gewoon online staat (wifi-hik, geen echte storing). Dat liet de kaart elk kwartier
    // omklappen en spamde offline/online-meldingen, dus we vertrouwen die staat niet meer: altijd online.
    online: true
  };
}

// Haalt alle kamers in één verzoek op (zuinig i.v.m. de dag-limiet). cb(err)
function getRooms(cb) {
  var cfg = load();
  if (!cfg.tokens) return cb("niet gekoppeld");
  // nog geen huis gekozen, of de huizenlijst ontbreekt (koppeling van een oudere versie): eerst ophalen
  if (!cfg.homeId || !cfg.homes || !cfg.homes.length) return findHome(function(id) { if (!id) return cb(linkError || "geen huis gevonden"); getRooms(cb); });
  api(HOPS_HOST, "GET", "/homes/" + cfg.homeId + "/rooms", null, function(err, status, body) {
    if (status === 429) { rateLimited = true; linkError = RATE_MSG; return cb("limiet"); }
    if (err) return cb("tado is niet bereikbaar");
    if (status !== 200) return cb(oauthMessage(body, "Kamers ophalen mislukt (" + status + ")"));
    var list = Array.isArray(body) ? body : (body && body.rooms) || [];
    rateLimited = false;
    if (linkError === RATE_MSG) linkError = null;
    applyZones(list.map(parseRoom));
    cb(null);
  });
}

// Geofencing: per gekoppelde telefoon of hij thuis is (classic API, zelfde token). Draait in een eigen,
// meestal snellere pollcyclus dan de kamers (zie pollPresence), zodat "thuis" sneller verschijnt. cb(err)
function fetchPresence(cb) {
  cb = cb || function() {};
  var cfg = load();
  if (!cfg.tokens || !cfg.homeId) return cb("niet gekoppeld");
  api(MY_HOST, "GET", "/api/v2/homes/" + cfg.homeId + "/mobileDevices", null, function(err, status, body) {
    if (status === 429) { rateLimited = true; linkError = RATE_MSG; return cb("limiet"); }
    if (err) return cb("tado is niet bereikbaar");
    if (status !== 200 || !Array.isArray(body)) return cb(oauthMessage(body, "Presence ophalen mislukt (" + status + ")"));
    rateLimited = false;
    if (linkError === RATE_MSG) linkError = null;
    var devices = body
      .filter(function(m) { return m && m.settings && m.settings.geoTrackingEnabled; })
      .map(function(m) {
        return {
          name: m.name || "?",
          atHome: !!(m.location && m.location.atHome),
          stale: !!(m.location && m.location.stale),
          hasLocation: !!m.location
        };
      });
    presence = {
      home: devices.some(function(d) { return d.atHome; }) ? "HOME" : (devices.length ? "AWAY" : null),
      devices: devices,
      updated: Date.now()
    };
    cb(null);
  });
}

function getPresence() { return presence; }

function poll() {
  clearTimeout(pollTimer);
  var gen = generation;
  if (!load().tokens) return;
  getRooms(function(err) {
    if (gen !== generation) return;
    // tijdens het stoken snel verder (fijnmazige opwarmcurve), anders terug naar de rustige cadans
    schedule(gen, err === "limiet" ? RATE_RETRY_MS : err ? RETRY_MS : (anyHeating() ? heatingMs() : pollMs()));
  });
}

// Eigen, losse pollcyclus voor presence — zuiniger kunnen we de kamers op 30 min houden en toch
// "thuis" sneller zien. Bij een limiet-antwoord even een uur terugschakelen, net als de kamer-poll.
function pollPresence() {
  clearTimeout(presenceTimer);
  var gen = generation;
  if (!load().tokens) return;
  fetchPresence(function(err) {
    if (gen !== generation) return;
    schedulePresence(gen, err === "limiet" ? RATE_RETRY_MS : err ? RETRY_MS : presenceMs());
  });
}

function schedulePresence(gen, ms) {
  if (gen !== generation) return;
  clearTimeout(presenceTimer);
  presenceTimer = setTimeout(pollPresence, ms);
}

// Eenmalig nu ophalen (knop "Ververs"); verstoort de vaste pollcyclus niet. cb(err, status)
function refreshNow(cb) {
  getRooms(function(err) { if (!err) fetchPresence(); cb(err && err !== "limiet" ? (rateLimited ? RATE_MSG : "Verversen mislukt") : null, getStatus()); });
}

function schedule(gen, ms) {
  if (gen !== generation) return;
  clearTimeout(pollTimer);
  pollTimer = setTimeout(poll, ms);
}

function stopPolling() {
  generation++;
  clearTimeout(pollTimer);
  clearTimeout(presenceTimer);
}

function applyZones(list) {
  zones = list;
  lastUpdate = Date.now();
  logZones(list);
  logHeating(list);
  checkAlerts();
}

// Temperatuur én luchtvochtigheid per kamer wegschrijven naar de geschiedenis (zelfde tabel als de
// ESP-sensoren), zodat je er een trend van kunt zien. device "tado" onderscheidt de bron van de losse
// sensoren. Deze klimaat-historie blijft op de rustige cadans (pollMs), óók als de stook-poll elke paar
// seconden draait: anders zou de temp-/vochtgrafiek vollopen. De fijnmazige opwarmdata gaat naar logHeating.
var lastClimateLog = 0;
function logZones(list) {
  if (!modules.isOn("tado")) return;
  if (Date.now() - lastClimateLog < pollMs()) return;
  var readings = list
    .filter(function(z) { return z.online && z.temperature != null; })
    .map(function(z) { return { room: z.name, temp_c: z.temperature, humidity: z.humidity != null ? z.humidity : null }; });
  if (!readings.length) return;
  lastClimateLog = Date.now();
  logging.logTemperatureReadings({ device: "tado", readings: readings }, function(err) {
    if (err) console.error("[tado] loggen mislukt:", err.message);
  });
}

// Stookhistorie: gevraagde temperatuur (setpoint), actuele temperatuur en stookpercentage per kamer.
// Schrijft bij élke poll weg (dus snel tijdens het opwarmen), zodat je kunt uitrekenen hoelang een kamer
// erover doet om op peil te komen en dat tegen het gasverbruik (tabel readings) kunt afzetten.
function logHeating(list) {
  if (!modules.isOn("tado")) return;
  var readings = list
    .filter(function(z) { return z.online && z.temperature != null; })
    .map(function(z) { return { room: z.name, setpoint_c: z.setpoint, temp_c: z.temperature, heating_power: z.heatingPower }; });
  if (!readings.length) return;
  logging.logHeatingReadings({ device: "tado", readings: readings }, function(err) {
    if (err) console.error("[tado] stook loggen mislukt:", err.message);
  });
}

// Werkt één kamer in het geheugen bij na een bediening, zodat de kaart meteen klopt zonder extra API-verzoek
function patchZone(id, changes) {
  zones = zones.map(function(z) { return z.id === id ? Object.assign({}, z, changes) : z; });
  lastUpdate = Date.now();
}

// Meldingen: een kamer onder de vorstgrens. Meldt één keer bij de overgang en opnieuw als het weg is en
// terugkomt; een herstart van de server meldt een lopende storing opnieuw. (Offline-meldingen zijn eruit:
// tado° X gaf valse OFFLINE-staten terwijl de tado-app online toonde — zie parseRoom.)
function checkAlerts() {
  if (!modules.isOn("tado")) return;
  var cfg = load();
  var frost = cfg.frostThreshold != null ? cfg.frostThreshold : DEFAULT_FROST;
  zones.forEach(function(z) {
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
  var setting;
  if (opts.power === "OFF") setting = { power: "OFF" };
  else {
    var t = Number(opts.temperature);
    if (!(t >= MIN_SET && t <= MAX_SET)) return cb("Temperatuur moet tussen " + MIN_SET + " en " + MAX_SET + " °C liggen");
    setting = { power: "ON", isBoost: false, temperature: { value: Math.round(t * 10) / 10 } };
  }
  api(HOPS_HOST, "POST", "/homes/" + cfg.homeId + "/rooms/" + zoneId + "/manualControl",
    { setting: setting, termination: { type: "MANUAL" } }, function(err, status, data) {
      if (err) return cb("tado is niet bereikbaar");
      if (status === 429) { rateLimited = true; return cb(RATE_MSG); }
      if (status !== 200 && status !== 201 && status !== 204) return cb(oauthMessage(data, "Instellen mislukt (" + status + ")"));
      // zuinig met API-verzoeken: niet opnieuw ophalen, maar de kaart meteen zelf bijwerken
      patchZone(zoneId, opts.power === "OFF"
        ? { power: "OFF", overlay: true }
        : { power: "ON", setpoint: setting.temperature.value, overlay: true });
      cb(null);
    });
}

// Terug naar het verwarmingsschema (de handmatige instelling intrekken)
function resumeZone(zoneId, cb) {
  var cfg = load();
  if (!cfg.homeId) return cb("niet gekoppeld");
  api(HOPS_HOST, "DELETE", "/homes/" + cfg.homeId + "/rooms/" + zoneId + "/manualControl", null, function(err, status, data) {
    if (err) return cb("tado is niet bereikbaar");
    if (status === 429) { rateLimited = true; return cb(RATE_MSG); }
    if (status !== 200 && status !== 204) return cb(oauthMessage(data, "Terug naar schema mislukt (" + status + ")"));
    patchZone(zoneId, { overlay: false });
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

function setPollMinutes(v) {
  v = Math.round(Number(v));
  if (!(v >= MIN_POLL_MIN && v <= MAX_POLL_MIN)) return false;
  var cfg = load();
  cfg.pollMinutes = v;
  save(cfg);
  if (cfg.tokens) poll(); // meteen met de nieuwe snelheid verder
  return true;
}

function setHeatingSeconds(v) {
  v = Math.round(Number(v));
  if (!(v >= MIN_HEATING_SEC && v <= MAX_HEATING_SEC)) return false;
  var cfg = load();
  cfg.heatingSeconds = v;
  save(cfg);
  if (cfg.tokens) poll(); // meteen met de nieuwe snelheid verder
  return true;
}

function setPresenceSeconds(v) {
  v = Math.round(Number(v));
  if (!(v >= MIN_PRESENCE_SEC && v <= MAX_PRESENCE_SEC)) return false;
  var cfg = load();
  cfg.presenceSeconds = v;
  delete cfg.presenceMinutes; // oude minuten-sleutel opruimen (vroegere versie)
  save(cfg);
  if (cfg.tokens) pollPresence(); // meteen met de nieuwe snelheid verder
  return true;
}

// ── Status ────────────────────────────────────────────────────────────────
function getStatus() {
  var cfg = load();
  if (pending && Date.now() > pending.expires) pending = null;
  var rv = cfg.roomView || {};
  return {
    linked: !!cfg.tokens,
    pending: pending ? { user_code: pending.user_code, url: pending.url } : null,
    error: linkError,
    rateLimited: rateLimited,
    homeName: cfg.homeName || null,
    homeId: cfg.homeId || null,
    homes: cfg.homes || [],
    frostThreshold: cfg.frostThreshold != null ? cfg.frostThreshold : DEFAULT_FROST,
    pollMinutes: cfg.pollMinutes != null ? cfg.pollMinutes : DEFAULT_POLL_MIN,
    heatingSeconds: (cfg.heatingSeconds >= MIN_HEATING_SEC && cfg.heatingSeconds <= MAX_HEATING_SEC) ? cfg.heatingSeconds : DEFAULT_HEATING_SEC,
    heatingSecMin: MIN_HEATING_SEC, heatingSecMax: MAX_HEATING_SEC,
    heating: anyHeating(),
    presenceSeconds: effectivePresenceSec(cfg),
    presenceSecMin: MIN_PRESENCE_SEC, presenceSecMax: MAX_PRESENCE_SEC,
    minSet: MIN_SET, maxSet: MAX_SET,
    zones: zones.map(function(z) { return Object.assign({ view: rv[z.id] || "both" }, z); }),
    presence: presence,
    updated: lastUpdate
  };
}

function start() {
  if (load().tokens) { poll(); pollPresence(); }
}

module.exports = {
  start: start, getStatus: getStatus, startLink: startLink, unlink: unlink,
  setZone: setZone, resumeZone: resumeZone, setFrost: setFrost, setPollMinutes: setPollMinutes, setHeatingSeconds: setHeatingSeconds, setPresenceSeconds: setPresenceSeconds, refreshNow: refreshNow,
  setHome: setHome, setRoomView: setRoomView, getPresence: getPresence,
  _parseRoom: parseRoom, _checkAlerts: checkAlerts
};

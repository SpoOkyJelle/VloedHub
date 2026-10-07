var https = require("https");
var fs = require("fs");
var path = require("path");
var modules = require("./modules");
var discord = require("./discord");
var db = require("../db/setup");
var time = require("../utils/time");

// Vaatwasser via de Home Connect-API van Bosch/Siemens.
// Koppelen gaat met de "device flow": VloedHub vraagt een code aan, jij keurt die goed op de site
// van Home Connect, daarna houdt de server zelf het token vers. De status komt binnen over één
// open verbinding (server-sent events), dus er wordt niet gepold: de API staat maar 1000 aanvragen per dag toe.
// Client-ID en tokens staan in data/homeconnect.json (niet in git).
var CONFIG_FILE = path.join(__dirname, "../data/homeconnect.json");

// De API geeft geen verbruikscijfers of historie zoals de app; elke afgeronde beurt wordt daarom hier zelf bijgehouden.
// energy_pct en water_pct zijn de schaalwaarden die de vaatwasser bij het programma opgeeft (0–100), geen kWh of liters.
db.run(
  "CREATE TABLE IF NOT EXISTS vaatwasser_cycles (" +
  "  id INTEGER PRIMARY KEY AUTOINCREMENT," +
  "  started_at TEXT, finished_at TEXT NOT NULL," +
  "  program TEXT, duration_min REAL, energy_pct REAL, water_pct REAL, options TEXT" +
  ")"
);
var HOST = "api.home-connect.com";
var SCOPE = "IdentifyAppliance Dishwasher-Monitor";
// Extra's die je per beurt aan kunt zetten
var EXTRAS = { ExtraDry: "ExtraDry", HygienePlus: "HygiënePlus", HalfLoad: "Halve belading", VarioSpeedPlus: "SpeedPerfect+", SilenceOnDemand: "Geluid dempen", IntensivZone: "IntensiveZone", BrillianceDry: "Glans drogen", EcoDry: "EcoDry", ZeoliteDry: "Zeolith drogen" };
var RETRY_MS = 5 * 60 * 1000;
var SILENT_MS = 3 * 60 * 1000;   // de API stuurt elke 55 s een KEEP-ALIVE

var pending = null;              // lopende koppeling: { user_code, url, expires }
var linkError = null;
var state = { reachable: null, operation: null, door: null, program: null, progress: null, finishAt: null, energy: null, water: null, extras: [], updated: null };
var cycle = null;                // lopende beurt: { started, exact }
var stream = null, streamTimer = null, silentTimer = null, generation = 0;

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
function request(method, urlPath, headers, body, cb) {
  var req = https.request({ hostname: HOST, path: urlPath, method: method, headers: headers, timeout: 20000 }, function(res) {
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
  request("POST", "/security/oauth/" + endpoint,
    { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(body) }, body, cb);
}

function storeTokens(t) {
  var cfg = load();
  cfg.tokens = {
    access_token: t.access_token,
    refresh_token: t.refresh_token || (cfg.tokens && cfg.tokens.refresh_token),
    expires_at: Date.now() + (t.expires_in || 86400) * 1000
  };
  save(cfg);
}

function oauthMessage(data, fallback) {
  var d = data && (data.error_description || data.error);
  return d ? String(d) : fallback;
}

// ── Koppelen ──────────────────────────────────────────────────────────────
function setCredentials(clientId, clientSecret) {
  clientId = String(clientId || "").trim();
  if (!/^[A-Za-z0-9]{16,128}$/.test(clientId)) return false;
  var cfg = load();
  // een ander client-ID maakt de oude koppeling ongeldig
  if (cfg.clientId !== clientId) { stopStream(); cfg = {}; resetState(); }
  cfg.clientId = clientId;
  cfg.clientSecret = String(clientSecret || "").trim() || cfg.clientSecret || null;
  save(cfg);
  return true;
}

function startLink(cb) {
  var cfg = load();
  if (!cfg.clientId) return cb("Vul eerst het client-ID in");
  linkError = null;
  oauth("device_authorization", { client_id: cfg.clientId, scope: SCOPE }, function(err, status, data) {
    if (err) return cb("Home Connect is niet bereikbaar");
    if (status !== 200 || !data.device_code) {
      return cb(oauthMessage(data, "Aanvraag geweigerd (" + status + ")") +
        " — controleer het client-ID en of de applicatie bij Home Connect op 'Device Flow' staat");
    }
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
        var c = load();
        oauth("token", { grant_type: "device_code", device_code: data.device_code, client_id: c.clientId, client_secret: c.clientSecret }, function(e, st, tok) {
          if (pending !== mine) return;
          if (!e && st === 200 && tok.access_token) {
            pending = null;
            storeTokens(tok);
            findAppliance(function() { connect(); });
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
  stopStream();
  var cfg = load();
  save({ clientId: cfg.clientId, clientSecret: cfg.clientSecret });
  resetState();
}

// ── Token ─────────────────────────────────────────────────────────────────
var refreshing = null;
function accessToken(cb) {
  var cfg = load(), t = cfg.tokens;
  if (!t || !t.refresh_token) return cb("niet gekoppeld");
  if (t.access_token && t.expires_at - Date.now() > 10 * 60 * 1000) return cb(null, t.access_token);
  if (refreshing) return refreshing.push(cb);
  refreshing = [cb];
  oauth("token", { grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: cfg.clientId, client_secret: cfg.clientSecret }, function(err, status, data) {
    var waiting = refreshing; refreshing = null;
    var error = null;
    if (err) error = "Home Connect is niet bereikbaar";
    else if (status !== 200 || !data.access_token) {
      error = oauthMessage(data, "Token verversen mislukt (" + status + ")");
      // de koppeling is ingetrokken of verlopen: opnieuw koppelen nodig
      if (data.error === "invalid_grant" || data.error === "invalid_token") {
        var c = load(); delete c.tokens; save(c);
        linkError = "De koppeling is verlopen, koppel opnieuw";
      }
      console.error("[vaatwasser] token:", error);
    } else storeTokens(data);
    waiting.forEach(function(w) { w(error, error ? null : data.access_token); });
  });
}

function api(urlPath, cb) {
  accessToken(function(err, token) {
    if (err) return cb(err);
    request("GET", urlPath, { Authorization: "Bearer " + token, Accept: "application/vnd.bsh.sdk.v1+json", "Accept-Language": "nl-NL" }, null, cb);
  });
}

// ── Status ────────────────────────────────────────────────────────────────
function resetState() {
  state = { reachable: null, operation: null, door: null, program: null, progress: null, finishAt: null, energy: null, water: null, extras: [], updated: null };
  cycle = null;
}

// "BSH.Common.EnumType.OperationState.Run" → "Run"
function last(v) {
  return typeof v === "string" ? v.slice(v.lastIndexOf(".") + 1) : v;
}

function apply(items) {
  (items || []).forEach(function(i) {
    if (i.key === "BSH.Common.Status.OperationState") setOperation(last(i.value));
    else if (i.key === "BSH.Common.Status.DoorState") state.door = last(i.value);
    else if (i.key === "BSH.Common.Root.ActiveProgram") state.program = i.value ? last(i.value) : null;
    else if (i.key === "BSH.Common.Option.ProgramProgress") state.progress = i.value;
    else if (i.key === "BSH.Common.Option.RemainingProgramTime") state.finishAt = i.value != null ? Date.now() + i.value * 1000 : null;
    else if (i.key === "BSH.Common.Option.EnergyForecast") state.energy = i.value;
    else if (typeof i.key === "string" && i.key.indexOf("Dishcare.Dishwasher.Event.") === 0) setAlert(i);
    else if (i.key === "BSH.Common.Option.WaterForecast") state.water = i.value;
    else if (typeof i.key === "string" && i.key.indexOf("Dishcare.Dishwasher.Option.") === 0 && typeof i.value === "boolean") {
      var extra = last(i.key);
      state.extras = state.extras.filter(function(x) { return x !== extra; });
      if (i.value) state.extras.push(extra);
    }
  });
  state.updated = Date.now();
}

// Onderhoudsmeldingen van de vaatwasser zelf (spoelmiddel of zout bijna op, …). Ze blijven staan tot de
// vaatwasser ze intrekt en worden bewaard, zodat een herstart niet opnieuw een Discord-bericht stuurt.
function setAlert(item) {
  var cfg = load();
  var alerts = cfg.alerts || {};
  var active = last(item.value) !== "Off";
  if (active === !!alerts[item.key]) return;
  if (active) {
    alerts[item.key] = item.name || last(item.key);
    if (modules.isOn("vaatwasser")) discord.sendDiscord("⚠️ **Vaatwasser:** " + alerts[item.key]);
  } else delete alerts[item.key];
  cfg.alerts = alerts;
  save(cfg);
}

function setOperation(op) {
  var prev = state.operation;
  state.operation = op;
  if (op !== "Run" && op !== "Pause" && op !== "DelayedStart") { state.progress = null; state.finishAt = null; }
  if (op === "Inactive" || op === "Ready") { state.program = null; state.energy = null; state.water = null; state.extras = []; cycle = null; }
  // start van een beurt; na een herstart midden in een beurt is de echte starttijd onbekend
  if (op === "Run" && !cycle) {
    cycle = { started: Date.now(), exact: !!prev };
    if (prev) fetchActive();
  }
  // alleen melden bij een echte overgang, niet bij de eerste status na een herstart
  if (op === "Finished" && prev && prev !== "Finished") {
    var cfg = load();
    cfg.lastFinished = new Date().toISOString();
    save(cfg);
    logCycle();
    if (modules.isOn("vaatwasser")) discord.sendDiscord("🍽️ **Vaatwasser is klaar!**");
  }
}

function findAppliance(cb) {
  api("/api/homeappliances", function(err, status, body) {
    var list = (!err && status === 200 && body.data && body.data.homeappliances) || [];
    var dish = list.filter(function(a) { return a.type === "Dishwasher"; })[0];
    if (dish) {
      var cfg = load();
      cfg.haId = dish.haId; cfg.name = dish.name || "Vaatwasser"; cfg.brand = dish.brand || null;
      save(cfg);
      state.reachable = !!dish.connected;
    } else if (!err && status === 200) {
      linkError = "Geen vaatwasser gevonden in dit Home Connect-account";
    }
    cb(dish || null);
  });
}

// Volledige status ophalen: bij het opzetten van de verbinding en als de vaatwasser weer online komt
function fetchState() {
  var haId = load().haId;
  if (!haId) return;
  var base = "/api/homeappliances/" + encodeURIComponent(haId);
  api(base + "/status", function(err, status, body) {
    if (err) return;
    if (status === 409) { state.reachable = false; state.updated = Date.now(); return; }
    if (status !== 200 || !body.data) return;
    state.reachable = true;
    apply(body.data.status);
    if (["Run", "Pause", "DelayedStart", "Finished"].indexOf(state.operation) !== -1) fetchActive();
  });
}

// Programma, extra's en de energie- en waterschaal van de lopende beurt
function fetchActive() {
  var haId = load().haId;
  if (!haId) return;
  api("/api/homeappliances/" + encodeURIComponent(haId) + "/programs/active", function(err, status, body) {
    if (err || status !== 200 || !body.data) return;
    state.program = last(body.data.key);
    apply(body.data.options);
  });
}

// ── Beurten ───────────────────────────────────────────────────────────────
function logCycle() {
  var c = cycle; cycle = null;
  var now = Date.now();
  db.run(
    "INSERT INTO vaatwasser_cycles (started_at, finished_at, program, duration_min, energy_pct, water_pct, options) VALUES (?,?,?,?,?,?,?)",
    [c && c.exact ? time.cutoff(now - c.started) : null, time.cutoff(0), state.program,
     c && c.exact ? (now - c.started) / 60000 : null, state.energy, state.water, state.extras.join(",")],
    function(err) { if (err) console.error("[vaatwasser] beurt opslaan:", err.message); }
  );
}

function getStats(cb) {
  db.get(
    "SELECT COUNT(*) as total," +
    " SUM(CASE WHEN finished_at >= ? THEN 1 ELSE 0 END) as this_week," +
    " SUM(CASE WHEN finished_at >= ? THEN 1 ELSE 0 END) as this_month," +
    " AVG(duration_min) as avg_duration, AVG(energy_pct) as avg_energy, AVG(water_pct) as avg_water" +
    " FROM vaatwasser_cycles",
    [time.cutoff(604800000), time.cutoff(2592000000)],
    function(err, totals) {
      db.all("SELECT program, COUNT(*) as n FROM vaatwasser_cycles WHERE program IS NOT NULL GROUP BY program ORDER BY n DESC", function(err2, programs) {
        db.all("SELECT finished_at, program, duration_min, energy_pct, water_pct, options FROM vaatwasser_cycles ORDER BY id DESC LIMIT 15", function(err3, recent) {
          cb(Object.assign({}, totals || {}, { programs: programs || [], recent: recent || [], extras: EXTRAS }));
        });
      });
    }
  );
}

// ── Eventstream ───────────────────────────────────────────────────────────
function stopStream() {
  generation++;
  clearTimeout(streamTimer); clearTimeout(silentTimer);
  if (stream) { try { stream.destroy(); } catch (e) {} stream = null; }
}

function retry(gen, ms) {
  if (gen !== generation) return;
  clearTimeout(streamTimer);
  streamTimer = setTimeout(connect, ms || RETRY_MS);
}

// Houdt bij welke gegevens de vaatwasser over de stream stuurt (laatste waarde en aantal per sleutel),
// zodat te zien is wat er naast de bekende status nog binnenkomt. Staat in data/homeconnect-keys.json.
var KEYS_FILE = path.join(__dirname, "../data/homeconnect-keys.json");
var seenKeys = null, keysTimer = null;
function remember(name, items) {
  if (!seenKeys) { try { seenKeys = JSON.parse(fs.readFileSync(KEYS_FILE, "utf8")); } catch (e) { seenKeys = {}; } }
  (items || []).forEach(function(i) {
    if (!i || !i.key || Object.keys(seenKeys).length >= 500 && !seenKeys[i.key]) return;
    var k = seenKeys[i.key] || (seenKeys[i.key] = { count: 0 });
    k.event = name; k.value = i.value; k.unit = i.unit || undefined; k.count++; k.last = time.cutoff(0);
  });
  if (keysTimer) return;
  keysTimer = setTimeout(function() {
    keysTimer = null;
    try { fs.writeFileSync(KEYS_FILE, JSON.stringify(seenKeys, null, 1)); } catch (e) {}
  }, 30000);
}

function handleEvent(name, data) {
  if (name === "KEEP-ALIVE") return;
  if (name === "DISCONNECTED") { state.reachable = false; state.updated = Date.now(); return; }
  if (name === "CONNECTED") { state.reachable = true; fetchState(); return; }
  if (name !== "STATUS" && name !== "NOTIFY" && name !== "EVENT") return;
  var parsed;
  try { parsed = JSON.parse(data); } catch (e) { return; }
  state.reachable = true;
  remember(name, parsed.items);
  apply(parsed.items);
}

function connect() {
  stopStream();
  var gen = generation;
  var cfg = load();
  if (!cfg.tokens) return;
  if (!cfg.haId) return findAppliance(function(found) { if (gen === generation) { if (found) connect(); else retry(gen); } });

  accessToken(function(err, token) {
    if (gen !== generation) return;
    if (err) return retry(gen);
    var req = https.request({
      hostname: HOST, method: "GET",
      path: "/api/homeappliances/" + encodeURIComponent(cfg.haId) + "/events",
      headers: { Authorization: "Bearer " + token, Accept: "text/event-stream", "Accept-Language": "nl-NL" }
    }, function(res) {
      if (gen !== generation) { res.destroy(); return; }
      if (res.statusCode !== 200) {
        res.resume();
        console.error("[vaatwasser] eventstream geweigerd:", res.statusCode);
        // 401: token is ongeldig geworden, bij de volgende poging wordt het ververst
        if (res.statusCode === 401) { var c = load(); if (c.tokens) { c.tokens.expires_at = 0; save(c); } }
        return retry(gen, res.statusCode === 429 ? 60 * 60 * 1000 : RETRY_MS);
      }
      fetchState();
      function alive() {
        clearTimeout(silentTimer);
        silentTimer = setTimeout(function() { if (gen === generation) connect(); }, SILENT_MS);
      }
      alive();
      var buffer = "";
      res.setEncoding("utf8");
      res.on("data", function(chunk) {
        alive();
        buffer += chunk.replace(/\r\n/g, "\n");
        var idx;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          var block = buffer.slice(0, idx); buffer = buffer.slice(idx + 2);
          var name = null, data = [];
          block.split("\n").forEach(function(line) {
            if (line.indexOf("event:") === 0) name = line.slice(6).trim();
            else if (line.indexOf("data:") === 0) data.push(line.slice(5).trim());
          });
          if (name) handleEvent(name, data.join("\n"));
        }
      });
      res.on("end", function() { retry(gen, 30000); });
      res.on("error", function() { retry(gen, 30000); });
    });
    req.on("error", function() { retry(gen); });
    req.end();
    stream = req;
  });
}

function start() {
  if (load().tokens) connect();
}

function getStatus() {
  var cfg = load();
  if (pending && Date.now() > pending.expires) pending = null;
  return {
    configured: !!cfg.clientId,
    clientHint: cfg.clientId ? cfg.clientId.slice(-4) : null,
    hasSecret: !!cfg.clientSecret,
    linked: !!cfg.tokens,
    pending: pending ? { user_code: pending.user_code, url: pending.url } : null,
    error: linkError,
    name: cfg.name || null,
    brand: cfg.brand || null,
    lastFinished: cfg.lastFinished || null,
    alerts: Object.keys(cfg.alerts || {}).map(function(k) { return cfg.alerts[k]; }),
    state: state
  };
}

module.exports = { start: start, getStatus: getStatus, getStats: getStats, setCredentials: setCredentials, startLink: startLink, unlink: unlink, _apply: apply, _handleEvent: handleEvent };

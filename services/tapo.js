var https = require("https");
var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var modules = require("./modules");
var discord = require("./discord");
var logging = require("../db/logging");

// TP-Link Tapo via de cloud. Tapo heeft geen publieke API/OAuth: we gebruiken dezelfde privé-cloud-API
// als de Tapo-app. Inloggen gaat met e-mail + wachtwoord -> een token (geen refresh-token; bij verloop
// loggen we opnieuw in). Daarom moeten de inloggegevens bewaard blijven; ze staan in data/tapo.json
// (niet in git) en worden via de instellingen ingevoerd, nooit in de code of .env. Advies: maak hiervoor
// een apart TP-Link-account en deel je apparaten daarnaartoe, zodat je de toegang kunt intrekken.
//
// Let op: of de cloud-"passthrough" (het echte uitlezen van vermogen en de hub-sensoren) werkt, hangt af
// van je apparaten en firmware. Nieuwere Tapo-firmware versleutelt end-to-end en weigert soms de simpele
// cloud-passthrough. Deze service degradeert netjes: lukt het niet, dan staat dat in de status, zonder
// de server onderuit te halen. Met scripts/tapo-cloud-probe.js kun je los testen wat de cloud teruggeeft.
//
// Wat we uitlezen:
//  - P410M (slimme stekker): huidig vermogen -> voedt de bestaande wasmachine-status/melding.
//  - T310 (onder de hub): temperatuur + luchtvochtigheid -> temperature_readings (badkamer) + douche-detectie.

var CONFIG_FILE = path.join(__dirname, "../data/tapo.json");

var DEFAULT_REGION = "eu-wap";
var TOKEN_TTL = 6 * 60 * 60 * 1000;   // cloud-token ruim voor verloop vernieuwen

var DEFAULT_POLL_MIN = 3;             // fijn genoeg voor wasmachine-detectie, rustig voor de cloud
var MIN_POLL_MIN = 1, MAX_POLL_MIN = 30;
var RETRY_MS = 5 * 60 * 1000;

// Wasmachine-detectie uit het vermogen van de P410M
var WASH_RUN_W = 8;                   // boven dit vermogen draait de wasmachine
var WASH_DONE_W = 3;                  // zo lang hieronder = klaar
var WASH_DONE_MIN = 5;               // minuten aanhoudend laag voor "klaar" (voorkomt pauzes in het programma)
var WASH_AUTOCLEAR_MIN = 180;         // "klaar" na zoveel minuten vanzelf terug naar idle

// Douche-detectie uit de luchtvochtigheid van de T310
var SHOWER_HIGH = 75;                 // boven dit percentage: er wordt gedoucht
var SHOWER_RISE = 12;                 // of een snelle stijging (procentpunten) sinds de vorige meting
var SHOWER_RELEASE = 65;              // pas opnieuw melden als het hieronder is gezakt
var SHOWER_COOLDOWN_MS = 30 * 60 * 1000;

var DEFAULT_ROOM = "Badkamer";

var token = null, tokenAt = 0;
var lastError = null;
var lastUpdate = null;
var devices = [];                     // laatste getDeviceList (zonder geheimen)
var plug = null;                      // { watts, on, updated }
var t310 = null;                      // { temp, humidity, updated, online }
var lastRaw = {};                     // kleine ruwe snippets voor debug in de status (geen geheimen)

// in-geheugen wasmachine-detectie
var washState = "idle";               // idle | running | done
var washLowSince = 0;
var washDoneAt = 0;

// douche-detectie
var lastHumidity = null;
var showerActive = false;
var lastShowerNotify = 0;

var pollTimer = null, generation = 0;

function load() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")); } catch (e) { return {}; }
}

function save(cfg) {
  var dir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

function region() {
  var r = load().region;
  return /^[a-z0-9-]+$/.test(String(r || "")) ? r : DEFAULT_REGION;
}

function loginUrl() {
  return "https://" + region() + ".tplinkcloud.com/";
}

function pollMs() {
  var m = load().pollMinutes;
  if (!(m >= MIN_POLL_MIN && m <= MAX_POLL_MIN)) m = DEFAULT_POLL_MIN;
  return m * 60 * 1000;
}

function roomName() {
  var n = load().roomName;
  return (typeof n === "string" && n.trim()) ? n.trim() : DEFAULT_ROOM;
}

function b64(s) {
  try { return Buffer.from(String(s), "base64").toString("utf8"); } catch (e) { return String(s); }
}

// ── Cloud-aanroepen ─────────────────────────────────────────────────────────
// cb(err, parsedBody). body is het geparste JSON-antwoord, of null.
function post(url, body, cb) {
  var u;
  try { u = new URL(url); } catch (e) { return cb(e); }
  var payload = JSON.stringify(body);
  var req = https.request({
    hostname: u.hostname, path: u.pathname + u.search, method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
    timeout: 20000
  }, function(res) {
    var chunks = "";
    res.on("data", function(c) { chunks += c; });
    res.on("end", function() {
      var data = null;
      try { data = JSON.parse(chunks); } catch (e) {}
      cb(null, data);
    });
  });
  req.on("timeout", function() { req.destroy(new Error("timeout")); });
  req.on("error", function(e) { cb(e); });
  req.write(payload);
  req.end();
}

function doLogin(cb) {
  var cfg = load();
  if (!cfg.email || !cfg.password) return cb("niet gekoppeld");
  var uuid = cfg.terminalUUID || (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex"));
  if (!cfg.terminalUUID) { cfg.terminalUUID = uuid; save(cfg); }
  post(loginUrl(), {
    method: "login",
    params: { appType: "Tapo_Android", cloudUserName: cfg.email, cloudPassword: cfg.password, terminalUUID: uuid }
  }, function(err, body) {
    if (err) return cb("TP-Link cloud niet bereikbaar");
    if (!body || body.error_code !== 0 || !body.result || !body.result.token) {
      return cb("Inloggen mislukt (" + (body && body.error_code) + ")");
    }
    token = body.result.token; tokenAt = Date.now();
    cb(null, token);
  });
}

// Zorgt voor een geldig token (logt zo nodig opnieuw in) en roept cb(err, token) aan.
function withToken(cb) {
  if (token && Date.now() - tokenAt < TOKEN_TTL) return cb(null, token);
  doLogin(cb);
}

// Een cloud-methode met token in de URL; logt één keer opnieuw in bij een token-fout.
function cloudCall(baseUrl, body, cb, retried) {
  withToken(function(err, tk) {
    if (err) return cb(err);
    post(baseUrl + "?token=" + encodeURIComponent(tk), body, function(e, resp) {
      if (e) return cb("TP-Link cloud niet bereikbaar");
      // token verlopen/ongeldig -> één keer opnieuw inloggen en opnieuw proberen
      if (resp && (resp.error_code === -20651 || resp.error_code === -20675 || resp.error_code === -20571) && !retried) {
        token = null;
        return cloudCall(baseUrl, body, cb, true);
      }
      cb(null, resp);
    });
  });
}

function getDeviceList(cb) {
  cloudCall(loginUrl(), { method: "getDeviceList" }, function(err, resp) {
    if (err) return cb(err);
    if (!resp || resp.error_code !== 0 || !resp.result) return cb("Apparaten ophalen mislukt (" + (resp && resp.error_code) + ")");
    cb(null, resp.result.deviceList || []);
  });
}

// Eén device-commando via cloud-passthrough. innerMethod bv. "get_current_power". cb(err, innerResult)
function passthrough(dev, innerMethod, cb) {
  var appUrl = String(dev.appServerUrl || loginUrl()).replace(/\/$/, "") + "/";
  cloudCall(appUrl, {
    method: "passthrough",
    params: { deviceId: dev.deviceId, requestData: JSON.stringify({ method: innerMethod }) }
  }, function(err, resp) {
    if (err) return cb(err);
    if (!resp || resp.error_code !== 0) return cb("passthrough " + innerMethod + " geweigerd (" + (resp && resp.error_code) + ")");
    var rd = resp.result && resp.result.responseData;
    var inner = null;
    if (typeof rd === "string") { try { inner = JSON.parse(rd); } catch (e) { return cb("versleuteld antwoord (cloud-passthrough niet ondersteund voor dit apparaat)"); } }
    else if (rd && typeof rd === "object") inner = rd;
    if (!inner) return cb("leeg antwoord op " + innerMethod);
    if (inner.error_code != null && inner.error_code !== 0) return cb(innerMethod + " -> error " + inner.error_code);
    cb(null, inner.result || inner);
  });
}

// ── Apparaten kiezen ────────────────────────────────────────────────────────
function isType(dev, needle) {
  return String(dev.deviceType || "").toUpperCase().indexOf(needle) !== -1;
}

function chosenPlug() {
  var cfg = load();
  if (cfg.washPlugId) return devices.filter(function(d) { return d.deviceId === cfg.washPlugId; })[0] || null;
  return devices.filter(function(d) { return isType(d, "PLUG"); })[0] || null;
}

function chosenHub() {
  var cfg = load();
  if (cfg.hubId) return devices.filter(function(d) { return d.deviceId === cfg.hubId; })[0] || null;
  return devices.filter(function(d) { return isType(d, "HUB"); })[0] || null;
}

// ── Uitlezen ──────────────────────────────────────────────────────────────
// Huidig vermogen (W) van de stekker, defensief: verschillende firmwares melden het anders.
function readPlug(cb) {
  var dev = chosenPlug();
  if (!dev) return cb(null); // geen stekker: geen fout
  passthrough(dev, "get_current_power", function(err, r) {
    if (!err && r && r.current_power != null) {
      recordPlug(Number(r.current_power), dev); // P110/P410: Watt
      return cb(null);
    }
    // uitwijk: get_energy_usage meldt current_power soms in milliwatt
    passthrough(dev, "get_energy_usage", function(err2, r2) {
      if (err2) { lastRaw.plug = String(err || err2); return cb(err2); }
      var w = r2 && r2.current_power != null ? Number(r2.current_power) / 1000 : null;
      if (w == null) { lastRaw.plug = "geen current_power in antwoord"; return cb("geen vermogen"); }
      recordPlug(w, dev);
      cb(null);
    });
  });
}

function recordPlug(watts, dev) {
  if (!isFinite(watts)) return;
  plug = { watts: Math.round(watts * 10) / 10, on: watts > 0.5, updated: Date.now(), name: b64(dev.alias) || dev.deviceModel };
  lastRaw.plug = plug.watts + " W";
  evaluateWash(plug.watts);
}

// Sensoren onder de hub; zoekt de T310 (temp + vocht).
function readHub(cb) {
  var dev = chosenHub();
  if (!dev) return cb(null);
  passthrough(dev, "get_child_device_list", function(err, r) {
    if (err) { lastRaw.hub = String(err); return cb(err); }
    var list = (r && (r.child_device_list || r.childDeviceList)) || [];
    lastRaw.hub = list.length + " sub-apparaten";
    var cfg = load();
    var child = cfg.t310Id ? list.filter(function(c) { return (c.device_id || c.deviceId) === cfg.t310Id; })[0] : null;
    if (!child) child = list.filter(function(c) { return /T31\d/i.test(String(c.model || "")) || /temp/i.test(String(c.category || "")); })[0];
    if (!child) return cb(null);
    recordT310(child);
    cb(null);
  });
}

function recordT310(c) {
  var temp = c.current_temp != null ? c.current_temp : (c.current_temperature != null ? c.current_temperature : null);
  if (temp != null && /fahrenheit|f/i.test(String(c.temp_unit || "")) && !/celsius/i.test(String(c.temp_unit || ""))) {
    temp = (Number(temp) - 32) * 5 / 9;
  }
  var hum = c.current_humidity != null ? c.current_humidity : (c.humidity != null ? c.humidity : null);
  temp = temp != null ? Math.round(Number(temp) * 10) / 10 : null;
  hum = hum != null ? Math.round(Number(hum)) : null;
  var online = c.status == null || String(c.status).toLowerCase() === "online" || c.status === 1 || c.status === true || c.at_low_battery === false;
  t310 = { temp: temp, humidity: hum, updated: Date.now(), online: online, name: b64(c.nickname) || c.model };
  lastRaw.t310 = (temp != null ? temp + "°C" : "?") + " / " + (hum != null ? hum + "%" : "?");

  if (temp != null) {
    logging.logTemperatureReadings({ device: "tapo-t310", readings: [{ room: roomName(), temp_c: temp, humidity: hum }] }, function() {});
  }
  if (hum != null) evaluateShower(hum);
}

// ── Wasmachine-detectie ─────────────────────────────────────────────────────
function evaluateWash(watts) {
  var now = Date.now();
  if (watts > WASH_RUN_W) {
    washLowSince = 0;
    if (washState !== "running") {
      washState = "running"; washDoneAt = 0;
      logging.setWashStatus("running", "tapo-p410m");
    }
  } else if (washState === "running" && watts < WASH_DONE_W) {
    if (!washLowSince) washLowSince = now;
    if (now - washLowSince >= WASH_DONE_MIN * 60 * 1000) {
      washState = "done"; washDoneAt = now; washLowSince = 0;
      logging.logWashCycle({ device: "tapo-p410m" }, function() {});
      logging.setWashStatus("done", "tapo-p410m");
      if (modules.isOn("wasmachine")) discord.notify("wasmachine", "🧸 **Was is klaar!** (wasmachine via Tapo)");
    }
  } else if (washState === "done") {
    washLowSince = 0;
    if (washDoneAt && now - washDoneAt >= WASH_AUTOCLEAR_MIN * 60 * 1000) {
      washState = "idle"; washDoneAt = 0;
      logging.setWashStatus("idle", "tapo-p410m");
    }
  } else {
    washLowSince = 0;
  }
}

// ── Douche-detectie ──────────────────────────────────────────────────────────
function evaluateShower(hum) {
  var now = Date.now();
  var rise = lastHumidity != null ? hum - lastHumidity : 0;
  var high = hum >= SHOWER_HIGH || rise >= SHOWER_RISE;
  if (high && !showerActive) {
    showerActive = true;
    if (now - lastShowerNotify >= SHOWER_COOLDOWN_MS) {
      lastShowerNotify = now;
      if (modules.isOn("temperature")) discord.notify("temperature", "🚿 **Er wordt gedoucht** — " + roomName() + " " + hum + "% luchtvochtigheid");
    }
  } else if (showerActive && hum <= SHOWER_RELEASE) {
    showerActive = false;
  }
  lastHumidity = hum;
}

// ── Pollen ──────────────────────────────────────────────────────────────────
function refresh(cb) {
  getDeviceList(function(err, list) {
    if (err) { lastError = err; return cb && cb(err); }
    devices = list.map(function(d) {
      return { deviceId: d.deviceId, alias: d.alias, name: b64(d.alias) || d.deviceName, model: d.deviceModel,
        type: d.deviceType, fw: d.fwVer, online: d.status, appServerUrl: d.appServerUrl };
    });
    var pending = 2, firstErr = null;
    function done(e) { if (e && !firstErr) firstErr = e; if (--pending === 0) finish(firstErr); }
    function finish(e) {
      lastUpdate = Date.now();
      lastError = e || null;
      if (cb) cb(e || null);
    }
    readPlug(done);
    readHub(done);
  });
}

function poll() {
  clearTimeout(pollTimer);
  var gen = generation;
  if (!load().email) return;
  refresh(function() {
    if (gen !== generation) return;
    pollTimer = setTimeout(poll, pollMs());
  });
}

function refreshNow(cb) {
  if (!load().email) return cb && cb("niet gekoppeld", getStatus());
  refresh(function(err) { cb && cb(err || null, getStatus()); });
}

function stopPolling() { generation++; clearTimeout(pollTimer); }

// ── Instellen ────────────────────────────────────────────────────────────────
function setCredentials(email, password, reg) {
  if (!email || !password || String(email).indexOf("@") === -1) return false;
  var cfg = load();
  cfg.email = String(email).trim();
  cfg.password = String(password);
  if (reg && /^[a-z0-9-]+$/.test(String(reg))) cfg.region = String(reg);
  save(cfg);
  token = null; tokenAt = 0; lastError = null;
  stopPolling();
  start();
  return true;
}

function unlink() {
  stopPolling();
  var cfg = load();
  // voorkeuren (kamernaam, pollsnelheid, gekozen apparaten) blijven; alleen de koppeling eruit
  ["email", "password", "token"].forEach(function(k) { delete cfg[k]; });
  save(cfg);
  token = null; tokenAt = 0; lastError = null;
  devices = []; plug = null; t310 = null; lastRaw = {};
  washState = "idle"; lastHumidity = null; showerActive = false;
}

function setPollMinutes(v) {
  v = Math.round(Number(v));
  if (!(v >= MIN_POLL_MIN && v <= MAX_POLL_MIN)) return false;
  var cfg = load(); cfg.pollMinutes = v; save(cfg);
  if (cfg.email) poll();
  return true;
}

function setRoomName(name) {
  name = String(name == null ? "" : name).trim().slice(0, 30);
  if (!name) return false;
  var cfg = load(); cfg.roomName = name; save(cfg);
  return true;
}

// Handmatig een apparaat aan een rol koppelen: { washPlugId, hubId, t310Id }
function setDevices(sel) {
  var cfg = load();
  ["washPlugId", "hubId", "t310Id"].forEach(function(k) {
    if (sel && sel[k] !== undefined) { if (sel[k]) cfg[k] = String(sel[k]); else delete cfg[k]; }
  });
  save(cfg);
  return true;
}

// ── Status (nooit e-mail/wachtwoord/token terug) ─────────────────────────────
function getStatus() {
  var cfg = load();
  return {
    linked: !!cfg.email,
    region: region(),
    error: lastError,
    pollMinutes: cfg.pollMinutes != null ? cfg.pollMinutes : DEFAULT_POLL_MIN,
    roomName: roomName(),
    devices: devices,
    selection: { washPlugId: cfg.washPlugId || null, hubId: cfg.hubId || null, t310Id: cfg.t310Id || null },
    plug: plug,
    t310: t310,
    washState: washState,
    showerActive: showerActive,
    raw: lastRaw,
    updated: lastUpdate
  };
}

function start() {
  if (load().email) poll();
}

module.exports = {
  start: start, getStatus: getStatus, refreshNow: refreshNow,
  setCredentials: setCredentials, unlink: unlink,
  setPollMinutes: setPollMinutes, setRoomName: setRoomName, setDevices: setDevices
};

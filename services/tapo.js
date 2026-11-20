var fs = require("fs");
var path = require("path");
var modules = require("./modules");
var discord = require("./discord");
var logging = require("../db/logging");
var db = require("../db/setup");
var tapoLib = require("tp-link-tapo-connect");

// TP-Link Tapo, LOKAAL uitgelezen over het thuisnetwerk (de VloedHub-server staat op het LAN, dus dit
// werkt ook als je zelf niet thuis bent). De cloud-API bleek deze apparaten niet te laten uitlezen
// ("Device is offline"), lokaal wel.
//
// Koppelen: Tapo heeft geen OAuth, dus we loggen lokaal in met je Tapo-account (nodig voor de KLAP/TPAP-
// handshake) plus het lokale IP van elk apparaat. Gegevens staan in data/tapo.json (niet in git). Tip:
// gebruik een apart TP-Link-account en deel je apparaten daarnaartoe, dan is de toegang intrekbaar.
//
// LET OP (firmware): recente Tapo-firmware kiest tussen KLAP en TPAP via "Third-Party Compatibility" in de
// Tapo-app (Ik > Third-Party Services). Krijg je login-fouten (403 handshake), zet die schakelaar dan om.
//
// Wat we uitlezen:
//  - P410M (stekker): getEnergyUsage().current_power is in MILLIWATT -> watt = /1000 -> wasmachine-status.
//  - T310 (onder de H100): getChildDevicesInfo() -> current_temp + current_humidity -> badkamer + douche.

var CONFIG_FILE = path.join(__dirname, "../data/tapo.json");

var DEFAULT_POLL_MIN = 3;
var MIN_POLL_MIN = 1, MAX_POLL_MIN = 30;
var RETRY_MS = 5 * 60 * 1000;

// Wasmachine-detectie uit het vermogen van de P410M (in watt). Afgesteld op echte metingen: stand-by is
// 0–1,7 W; draaien is tientallen tot ~2000 W (verwarmen), met korte dips tussen fases naar 4–10 W.
var WASH_RUN_W = 15;                  // boven dit vermogen draait de wasmachine (ruim boven stand-by én de 4–10 W dips)
var WASH_DONE_W = 3;                  // zo lang hieronder = klaar (zit tussen stand-by ~1,6 W en de fase-dips ~4 W)
var WASH_DONE_MIN = 10;               // minuten aanhoudend laag voor "klaar" (overbrugt pauzes/soak in het programma)
var WASH_AUTOCLEAR_MIN = 180;         // "klaar" na zoveel minuten vanzelf terug naar idle

// Douche-detectie uit de luchtvochtigheid van de T310. Instelbaar in de app (opgeslagen in
// data/tapo.json → shower); deze waardes gelden als standaard zolang er niets is ingesteld.
//   high    = boven dit percentage: er wordt gedoucht
//   rise    = óf een snelle stijging (procentpunten) sinds de vorige meting
//   release = pas weer "rustig" als het hieronder zakt (hysterese tegen geflikker)
//   cooldownMin = minimale tijd tussen twee douche-meldingen
var DEFAULT_SHOWER = { high: 80, rise: 18, release: 68, cooldownMin: 30 };
var SHOWER_BOUNDS = { high: [50, 100], rise: [3, 50], release: [40, 95], cooldownMin: [0, 240] };

var DEFAULT_ROOM = "Badkamer";

var lastError = null;
var lastUpdate = null;
var plug = null;                      // { watts, on, name, updated }
var t310 = null;                      // { temp, humidity, online, name, updated }
var lastRaw = {};                     // kleine ruwe snippets voor de status (geen geheimen)

var plugSession = null, hubSession = null;  // ingelogde apparaat-objecten, hergebruikt tussen polls

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

function pollMs() {
  var m = load().pollMinutes;
  if (!(m >= MIN_POLL_MIN && m <= MAX_POLL_MIN)) m = DEFAULT_POLL_MIN;
  return m * 60 * 1000;
}

// De werkende douche-drempels: ingestelde waarde als die binnen de grenzen valt, anders de standaard.
// release wordt altijd onder high gehouden, anders zou "gedoucht" heen en weer kunnen flikkeren.
function showerCfg() {
  var c = load().shower || {};
  function pick(k) { var v = Number(c[k]); var b = SHOWER_BOUNDS[k]; return (v >= b[0] && v <= b[1]) ? v : DEFAULT_SHOWER[k]; }
  var high = pick("high"), release = pick("release");
  if (release >= high) release = Math.max(SHOWER_BOUNDS.release[0], high - 5);
  return { high: high, rise: pick("rise"), release: release, cooldownMin: pick("cooldownMin"), cooldownMs: pick("cooldownMin") * 60000 };
}

function roomName() {
  var n = load().roomName;
  return (typeof n === "string" && n.trim()) ? n.trim() : DEFAULT_ROOM;
}

function validIp(ip) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(String(ip || "")) || /^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(String(ip || ""));
}

// ── Inloggen op een apparaat (met hergebruik + opnieuw inloggen bij een fout) ──
async function device(which, ip) {
  var cfg = load();
  var cached = which === "plug" ? plugSession : hubSession;
  if (cached && cached.ip === ip) return cached.dev;
  var dev = await tapoLib.loginDeviceByIp(cfg.email, cfg.password, ip);
  var entry = { ip: ip, dev: dev };
  if (which === "plug") plugSession = entry; else hubSession = entry;
  return dev;
}

function dropSession(which) {
  if (which === "plug") plugSession = null; else hubSession = null;
}

// Voert fn(dev) uit; lukt dat niet, dan één keer opnieuw inloggen en opnieuw proberen
async function withDevice(which, ip, fn) {
  try {
    return await fn(await device(which, ip));
  } catch (e) {
    dropSession(which);
    return await fn(await device(which, ip));
  }
}

// ── Uitlezen ──────────────────────────────────────────────────────────────
async function readPlug(ip) {
  var info = null, energy = null;
  try { info = await withDevice("plug", ip, function(d) { return d.getDeviceInfo(); }); } catch (e) {}
  energy = await withDevice("plug", ip, function(d) { return d.getEnergyUsage(); });
  var mw = energy && energy.current_power != null ? Number(energy.current_power) : null;
  if (mw == null) throw new Error("geen current_power");
  var watts = Math.round((mw / 1000) * 10) / 10;   // current_power is milliwatt
  plug = {
    watts: watts,
    on: info && info.device_on != null ? !!info.device_on : watts > 0,
    name: (info && info.nickname) || "P410M",
    updated: Date.now()
  };
  lastRaw.plug = watts + " W";
  logging.logTapoPower(watts, "tapo-p410m", function() {});
  evaluateWash(watts);
}

async function readHub(ip) {
  var children = await withDevice("hub", ip, function(d) { return d.getChildDevicesInfo(); });
  var list = Array.isArray(children) ? children : [];
  lastRaw.hub = list.length + " sub-apparaten";
  var cfg = load();
  var c = cfg.t310Id ? list.filter(function(x) { return x.device_id === cfg.t310Id; })[0] : null;
  if (!c) c = list.filter(function(x) { return /T31\d/i.test(String(x.model || "")) || /temp.*hmdt|temp.*hum/i.test(String(x.category || "")); })[0];
  if (!c) { lastRaw.hub = list.length + " sub-apparaten, geen T310"; return; }
  recordT310(c);
}

function recordT310(c) {
  var temp = c.current_temp != null ? c.current_temp : (c.current_temperature != null ? c.current_temperature : null);
  if (temp != null && /fahrenheit/i.test(String(c.temp_unit || ""))) temp = (Number(temp) - 32) * 5 / 9;
  temp = temp != null ? Math.round(Number(temp) * 10) / 10 : null;
  var hum = c.current_humidity != null ? Math.round(Number(c.current_humidity)) : null;
  t310 = {
    temp: temp,
    humidity: hum,
    online: String(c.status || "online").toLowerCase() === "online",
    name: c.nickname || c.model || "T310",
    updated: Date.now()
  };
  lastRaw.t310 = (temp != null ? temp + "°C" : "?") + " / " + (hum != null ? hum + "%" : "?");
  if (temp != null) logging.logTemperatureReadings({ device: "tapo-t310", readings: [{ room: roomName(), temp_c: temp, humidity: hum }] }, function() {});
  if (hum != null) evaluateShower(hum);
}

// ── Wasmachine-detectie ─────────────────────────────────────────────────────
function evaluateWash(watts) {
  var now = Date.now();
  if (watts > WASH_RUN_W) {
    washLowSince = 0;
    if (washState !== "running") { washState = "running"; washDoneAt = 0; logging.setWashStatus("running", "tapo-p410m"); }
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
    if (washDoneAt && now - washDoneAt >= WASH_AUTOCLEAR_MIN * 60 * 1000) { washState = "idle"; washDoneAt = 0; logging.setWashStatus("idle", "tapo-p410m"); }
  } else {
    washLowSince = 0;
  }
}

// ── Douche-detectie ──────────────────────────────────────────────────────────
function evaluateShower(hum) {
  var s = showerCfg();
  var now = Date.now();
  var delta = lastHumidity != null ? hum - lastHumidity : 0;
  var trigger = hum >= s.high || delta >= s.rise;
  if (trigger && !showerActive) {
    showerActive = true;
    if (now - lastShowerNotify >= s.cooldownMs) {
      lastShowerNotify = now;
      if (modules.isOn("tapo")) discord.notify("temperature", "🚿 **Er wordt gedoucht** — " + roomName() + " " + hum + "% luchtvochtigheid");
    }
  } else if (showerActive && hum <= s.release) {
    showerActive = false;
  }
  lastHumidity = hum;
}

// ── Pollen ──────────────────────────────────────────────────────────────────
async function refresh() {
  var cfg = load();
  var errs = [];
  if (cfg.plugIp) { try { await readPlug(cfg.plugIp); } catch (e) { errs.push("stekker: " + e.message); lastRaw.plug = e.message; } }
  if (cfg.hubIp)  { try { await readHub(cfg.hubIp);  } catch (e) { errs.push("hub: " + e.message); lastRaw.hub = e.message; } }
  lastUpdate = Date.now();
  lastError = errs.length ? errs.join(" · ") : null;
}

function poll() {
  clearTimeout(pollTimer);
  var gen = generation;
  var cfg = load();
  if (!cfg.email || !cfg.password || (!cfg.plugIp && !cfg.hubIp)) return;
  refresh().catch(function(e) { lastError = e.message; }).then(function() {
    if (gen !== generation) return;
    pollTimer = setTimeout(poll, pollMs());
  });
}

function refreshNow(cb) {
  var cfg = load();
  if (!cfg.email || !cfg.password) return cb && cb("niet gekoppeld", getStatus());
  if (!cfg.plugIp && !cfg.hubIp) return cb && cb("geen IP-adres ingesteld", getStatus());
  refresh().then(function() { cb && cb(lastError, getStatus()); }).catch(function(e) { lastError = e.message; cb && cb(e.message, getStatus()); });
}

function stopPolling() { generation++; clearTimeout(pollTimer); }

// ── Instellen ────────────────────────────────────────────────────────────────
function setCredentials(email, password) {
  if (!email || !password || String(email).indexOf("@") === -1) return false;
  var cfg = load();
  cfg.email = String(email).trim();
  cfg.password = String(password);
  save(cfg);
  plugSession = hubSession = null; lastError = null;
  stopPolling(); start();
  return true;
}

// IP-adressen van de apparaten: { hubIp, plugIp } (leeg = wissen)
function setDevices(sel) {
  if (!sel) return false;
  var cfg = load();
  ["hubIp", "plugIp"].forEach(function(k) {
    if (sel[k] !== undefined) {
      if (!sel[k]) delete cfg[k];
      else if (validIp(sel[k])) cfg[k] = String(sel[k]).trim();
    }
  });
  if (sel.t310Id !== undefined) { if (sel.t310Id) cfg.t310Id = String(sel.t310Id); else delete cfg.t310Id; }
  save(cfg);
  plugSession = hubSession = null;
  if (cfg.email && cfg.password) { stopPolling(); start(); }
  return true;
}

function unlink() {
  stopPolling();
  var cfg = load();
  ["email", "password", "hubIp", "plugIp", "t310Id"].forEach(function(k) { delete cfg[k]; });
  save(cfg);
  plugSession = hubSession = null; lastError = null;
  plug = null; t310 = null; lastRaw = {};
  washState = "idle"; lastHumidity = null; showerActive = false;
}

function setPollMinutes(v) {
  v = Math.round(Number(v));
  if (!(v >= MIN_POLL_MIN && v <= MAX_POLL_MIN)) return false;
  var cfg = load(); cfg.pollMinutes = v; save(cfg);
  if (cfg.email && cfg.password) poll();
  return true;
}

function setRoomName(name) {
  name = String(name == null ? "" : name).trim().slice(0, 30);
  if (!name) return false;
  var cfg = load(); cfg.roomName = name; save(cfg);
  return true;
}

// Douche-drempels instellen: { high, rise, release, cooldownMin }. Lege/ontbrekende velden blijven ongemoeid.
// Geeft false bij een waarde buiten de grenzen of als release niet onder high ligt.
function setShower(opts) {
  opts = opts || {};
  var keys = ["high", "rise", "release", "cooldownMin"];
  var cfg = load();
  var shower = Object.assign({}, cfg.shower || {});
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (opts[k] == null || opts[k] === "") continue;
    var v = Math.round(Number(opts[k]));
    var b = SHOWER_BOUNDS[k];
    if (!(v >= b[0] && v <= b[1])) return false;
    shower[k] = v;
  }
  var eff = Object.assign({}, DEFAULT_SHOWER, shower);
  if (eff.release >= eff.high) return false; // release moet onder high blijven
  cfg.shower = shower;
  save(cfg);
  return true;
}

// ── Status (nooit e-mail/wachtwoord terug) ───────────────────────────────────
function getStatus() {
  var cfg = load();
  return {
    linked: !!(cfg.email && cfg.password),
    configured: !!(cfg.plugIp || cfg.hubIp),
    error: lastError,
    pollMinutes: cfg.pollMinutes != null ? cfg.pollMinutes : DEFAULT_POLL_MIN,
    roomName: roomName(),
    hubIp: cfg.hubIp || null,
    plugIp: cfg.plugIp || null,
    plug: plug,
    t310: t310,
    washState: washState,
    showerActive: showerActive,
    shower: showerCfg(),
    showerBounds: SHOWER_BOUNDS,
    raw: lastRaw,
    updated: lastUpdate
  };
}

// ── Hub-bel/sirene (H100) ─────────────────────────────────────────────────
// De H100 heeft een ingebouwde sirene met tonen (deurbel, alarm, enz.). Bruikbaar als testknop
// en als flow-actie. tone/volume/duration zijn optioneel; leeg = standaard van de hub.
function playAlarm(opts, cb) {
  opts = opts || {};
  var cfg = load();
  if (!cfg.email || !cfg.password) return cb && cb("niet gekoppeld");
  if (!cfg.hubIp) return cb && cb("geen hub-IP ingesteld");
  var dur = opts.duration != null && isFinite(Number(opts.duration)) ? Math.max(1, Math.min(300, Number(opts.duration))) : undefined;
  withDevice("hub", cfg.hubIp, function(d) {
    return d.playAlarm(opts.tone || undefined, opts.volume || undefined, dur);
  }).then(function() { cb && cb(null); }).catch(function(e) { cb && cb(e.message); });
}

function stopAlarm(cb) {
  var cfg = load();
  if (!cfg.hubIp) return cb && cb("geen hub-IP ingesteld");
  withDevice("hub", cfg.hubIp, function(d) { return d.stopAlarm(); })
    .then(function() { cb && cb(null); }).catch(function(e) { cb && cb(e.message); });
}

function getAlarmTones(cb) {
  var cfg = load();
  if (!cfg.hubIp) return cb && cb("geen hub-IP ingesteld", null);
  withDevice("hub", cfg.hubIp, function(d) { return d.getAlarmTones(); })
    .then(function(r) { cb && cb(null, r); }).catch(function(e) { cb && cb(e.message, null); });
}

// Huidige detectie-drempels (voor de export, zodat je ze later kunt laten bijstellen)
function getTuning() {
  return {
    roomName: roomName(),
    pollMinutes: load().pollMinutes != null ? load().pollMinutes : DEFAULT_POLL_MIN,
    wash: { run_w: WASH_RUN_W, done_w: WASH_DONE_W, done_min: WASH_DONE_MIN, autoclear_min: WASH_AUTOCLEAR_MIN },
    shower: (function() { var s = showerCfg(); return { high: s.high, rise: s.rise, release: s.release, cooldown_min: s.cooldownMin }; })()
  };
}

// washState leeft in het geheugen; bij een herstart halen we de laatste stand uit de DB terug. Anders kan
// de kaart op "In gebruik" blijven hangen als de server opnieuw startte terwijl de was liep: het geheugen
// zou dan op idle staan terwijl de DB running bleef, en de overgang naar "klaar" nooit meer plaatsvindt.
function restoreWashState() {
  db.get("SELECT state, since FROM wasmachine_status WHERE id = 1", function(err, row) {
    if (err || !row) return;
    if (row.state === "running") { washState = "running"; washLowSince = 0; washDoneAt = 0; }
    else if (row.state === "done") { washState = "done"; washLowSince = 0; washDoneAt = row.since ? new Date(row.since).getTime() : Date.now(); }
    else { washState = "idle"; washLowSince = 0; washDoneAt = 0; }
  });
}
function start() {
  restoreWashState();
  var cfg = load();
  if (cfg.email && cfg.password && (cfg.plugIp || cfg.hubIp)) poll();
}

module.exports = {
  start: start, getStatus: getStatus, getTuning: getTuning, refreshNow: refreshNow,
  setCredentials: setCredentials, setDevices: setDevices, unlink: unlink,
  setPollMinutes: setPollMinutes, setRoomName: setRoomName, setShower: setShower,
  playAlarm: playAlarm, stopAlarm: stopAlarm, getAlarmTones: getAlarmTones
};

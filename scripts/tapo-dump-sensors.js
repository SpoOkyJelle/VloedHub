#!/usr/bin/env node
//
// Tapo sensor-dump voor VloedHub
// ------------------------------------------------------------------
// Logt lokaal in op de hub (uit data/tapo.json) en print PER T310-sensor álle velden die de hub teruggeeft,
// met de nickname gedecodeerd. Bedoeld om te zien waar de Tapo-"locatie"/room (bv. Zolder, Badkamer) in de
// lokale data staat — of dat alleen de nickname beschikbaar is. Wijzigt niets; leest alleen uit.
//
// Draaien op de server (in de VloedHub-map):
//   node scripts/tapo-dump-sensors.js
//
// Plak de uitvoer terug (IP's/MAC's/device_id mag je maskeren).

var fs = require("fs");
var path = require("path");
var tapo = require("tp-link-tapo-connect");

var CONFIG_FILE = path.join(__dirname, "../data/tapo.json");

function load() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")); } catch (e) { return {}; }
}

// Tapo zet de nickname van child-devices vaak base64-gecodeerd neer. Probeer te decoderen; valt terug op ruw.
function decodeMaybeBase64(v) {
  if (typeof v !== "string" || !v) return v;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(v)) return v;
  try {
    var dec = Buffer.from(v, "base64").toString("utf8");
    // alleen gebruiken als het leesbare tekst oplevert
    if (dec && !/[\u0000-\u0008\u000e-\u001f]/.test(dec)) return dec + "   (base64 van: " + v + ")";
  } catch (e) {}
  return v;
}

(async function() {
  var cfg = load();
  if (!cfg.email || !cfg.password) { console.error("Geen e-mail/wachtwoord in data/tapo.json — koppel eerst in VloedHub."); process.exit(1); }
  var hubIp = cfg.hubIp;
  if (!hubIp) { console.error("Geen hubIp in data/tapo.json."); process.exit(1); }

  console.log("── Hub op " + hubIp + " ──");
  var hub;
  try { hub = await tapo.loginDeviceByIp(cfg.email, cfg.password, hubIp); }
  catch (e) { console.error("Inloggen op de hub mislukt: " + e.message); process.exit(1); }

  var children;
  try { children = await hub.getChildDevicesInfo(); }
  catch (e) {
    console.error("getChildDevicesInfo mislukt: " + e.message);
    try { children = await hub.getHubDevices(); } catch (e2) { console.error("getHubDevices ook mislukt: " + e2.message); process.exit(1); }
  }

  var list = Array.isArray(children) ? children : (children && children.child_device_list) || [];
  console.log("Aantal sub-apparaten: " + list.length + "\n");

  list.forEach(function(c, i) {
    console.log("── Sensor #" + (i + 1) + " ──");
    console.log("  nickname (gedecodeerd): " + decodeMaybeBase64(c.nickname));
    console.log("  model: " + c.model + " | category: " + c.category + " | type: " + c.type);
    console.log("  current_temp: " + c.current_temp + " | current_humidity: " + c.current_humidity + " | temp_unit: " + c.temp_unit);
    console.log("  ALLE velden/sleutels: " + Object.keys(c).join(", "));
    // Volledige ruwe JSON, zodat we niets missen (bv. een locatie/room-veld):
    var raw;
    try { raw = JSON.stringify(c); } catch (e) { raw = String(c); }
    console.log("  RUW: " + raw + "\n");
  });

  console.log("Klaar. Let op of ergens 'Zolder'/'Badkamer' (of een room/location/area-veld) voorkomt.");
  process.exit(0);
})();

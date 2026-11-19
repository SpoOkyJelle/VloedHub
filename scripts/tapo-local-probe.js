#!/usr/bin/env node
//
// Tapo LOKALE probe voor VloedHub
// ------------------------------------------------------------------
// Leest de Tapo-stekker (P410M) en de hub-sensoren (T310 onder de H100) rechtstreeks over je LAN uit,
// met de tp-link-tapo-connect library (KLAP/Passthrough). Dit wijzigt niets; het logt alleen in en print
// wat er terugkomt — zodat we zien of lokaal werkt en hoe de velden heten, voor we de integratie ombouwen.
//
// Je hebt de LOKALE IP-adressen van de H100 en de P410M nodig. Die vind je in je router (DHCP-lijst) of in
// de Tapo-app: tik het apparaat aan > tandwiel/Apparaatinfo > IP-adres. Zet ze het liefst vast in je router.
//
// Gebruik (PowerShell):
//   $env:TAPO_EMAIL="jij@mail.nl"; $env:TAPO_PASSWORD="geheim"
//   $env:TAPO_HUB_IP="192.168.178.xx"; $env:TAPO_PLUG_IP="192.168.178.yy"
//   node scripts/tapo-local-probe.js
//
// Een van beide IP's weglaten mag; dan slaat hij dat apparaat over.

var tapo = require("tp-link-tapo-connect");

var EMAIL = process.env.TAPO_EMAIL;
var PASSWORD = process.env.TAPO_PASSWORD;
var HUB_IP = process.env.TAPO_HUB_IP;
var PLUG_IP = process.env.TAPO_PLUG_IP;

if (!EMAIL || !PASSWORD) {
  console.error("Zet eerst TAPO_EMAIL en TAPO_PASSWORD (zie de uitleg bovenin dit bestand).");
  process.exit(1);
}
if (!HUB_IP && !PLUG_IP) {
  console.error("Zet minstens TAPO_HUB_IP of TAPO_PLUG_IP.");
  process.exit(1);
}

function short(obj, max) {
  var s;
  try { s = JSON.stringify(obj); } catch (e) { s = String(obj); }
  return s.length > (max || 1200) ? s.slice(0, max || 1200) + "…" : s;
}

(async function() {
  if (PLUG_IP) {
    console.log("\n── Stekker (P410M) op " + PLUG_IP + " ──");
    try {
      var plug = await tapo.loginDeviceByIp(EMAIL, PASSWORD, PLUG_IP);
      try { console.log("  getDeviceInfo:  " + short(await plug.getDeviceInfo())); } catch (e) { console.log("  getDeviceInfo:  FOUT " + e.message); }
      try { console.log("  getEnergyUsage: " + short(await plug.getEnergyUsage())); } catch (e) { console.log("  getEnergyUsage: FOUT " + e.message); }
    } catch (e) {
      console.log("  Inloggen mislukt: " + e.message);
    }
  }

  if (HUB_IP) {
    console.log("\n── Hub (H100) op " + HUB_IP + " ──");
    try {
      var hub = await tapo.loginDeviceByIp(EMAIL, PASSWORD, HUB_IP);
      try { console.log("  getDeviceInfo:       " + short(await hub.getDeviceInfo())); } catch (e) { console.log("  getDeviceInfo:       FOUT " + e.message); }
      var children = null;
      try { children = await hub.getChildDevicesInfo(); console.log("  getChildDevicesInfo: " + short(children, 2500)); }
      catch (e) {
        console.log("  getChildDevicesInfo: FOUT " + e.message);
        try { console.log("  getHubDevices:       " + short(await hub.getHubDevices(), 2500)); } catch (e2) { console.log("  getHubDevices:       FOUT " + e2.message); }
      }
    } catch (e) {
      console.log("  Inloggen mislukt: " + e.message);
    }
  }

  console.log("\nKlaar. Plak de uitvoer terug (IP's/MAC's mag je maskeren). Let vooral op current_power / current_temp(erature) / current_humidity.");
  process.exit(0);
})();

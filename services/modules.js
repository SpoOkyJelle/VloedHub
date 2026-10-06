var auth = require("./auth");

// Onderdelen van de app die je kunt uitzetten. Een uitgezette module verdwijnt uit de schermen
// en stuurt geen meldingen meer; binnenkomende metingen worden nog wel gewoon opgeslagen.
// De P1-meter (stroom) is de basis en staat altijd aan.
var MODULES = [
  { key: "gas",         label: "Gas",                    hint: "Gas-pagina en gascijfers bij Elektra" },
  { key: "weather",     label: "Weer",                   hint: "Weerblok op Home" },
  { key: "afval",       label: "Afvalkalender",          hint: "Blok op Home en de herinnering via Discord" },
  { key: "lights",      label: "Verlichting en scènes",  hint: "Ledstrips, lamp en scèneknoppen" },
  { key: "fridge",      label: "Koelkast",               hint: "Koelkastkaart en offline-melding" },
  { key: "temperature", label: "Temperatuursensoren",    hint: "Kamertemperaturen en temperatuurverloop" },
  { key: "esphome",     label: "ESPHome-sensoren",       hint: "Sensorkaart op Thuis" },
  { key: "wasmachine",  label: "Wasmachine",             hint: "Wasmachinekaart en de melding dat de was klaar is" },
  { key: "discord",     label: "Discord-meldingen",      hint: "Alle berichten naar Discord: herinneringen, offline-meldingen en flows" }
];

function saved() {
  return auth.readConfig().modules || {};
}

function isOn(key) {
  return saved()[key] !== false;
}

// { gas: true, weather: false, ... }
function getMap() {
  var s = saved(), map = {};
  MODULES.forEach(function(m) { map[m.key] = s[m.key] !== false; });
  return map;
}

function getList() {
  var map = getMap();
  return MODULES.map(function(m) { return { key: m.key, label: m.label, hint: m.hint, enabled: map[m.key] }; });
}

function set(key, enabled) {
  if (!MODULES.some(function(m) { return m.key === key; })) return false;
  var cfg = auth.readConfig();
  if (!cfg.modules) cfg.modules = {};
  cfg.modules[key] = !!enabled;
  auth.writeConfig(cfg);
  return true;
}

module.exports = { isOn: isOn, getMap: getMap, getList: getList, set: set };

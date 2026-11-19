var auth = require("./auth");

// Onderdelen van de app die je kunt uitzetten. Een uitgezette module verdwijnt uit de schermen
// en stuurt geen meldingen meer; binnenkomende metingen worden nog wel gewoon opgeslagen.
// De P1-meter (stroom) is de basis en staat altijd aan.
var MODULES = [
  { key: "gas",         label: "Gas",                    hint: "Gas-pagina en gascijfers bij Elektra" },
  { key: "weather",     label: "Weer",                   hint: "Weerblok op Home en weerwaarschuwingen van het KNMI" },
  { key: "storingen",   label: "Stroomstoringen",        hint: "Storingen van Enexis op je postcode, als blok en als melding" },
  { key: "regen",       label: "Regenverwachting",       hint: "Regen in de komende twee uur van Buienradar, als blok op Home" },
  { key: "files",       label: "Files",                  hint: "Files en afsluitingen op de rijkswegen rond huis (Rijkswaterstaat), als blok op Home" },
  { key: "nlalert",     label: "NL-Alert",               hint: "Een melding bij een NL-Alert voor je adres of binnen 15 km" },
  { key: "p2000",       label: "112-meldingen",          hint: "Oproepen aan brandweer en ambulance in Breda als blok, en een melding als je straat wordt genoemd" },
  { key: "ziggo",       label: "Internetstoringen",      hint: "Storingen en gepland onderhoud van Ziggo op je adres, als blok en als melding" },
  { key: "internet",    label: "Internetsnelheid",       hint: "Elk uur een snelheidstest (Speedtest CLI) en het blok op Home" },
  { key: "camera",      label: "Deurbelcamera",          hint: "Beeld van de Reolink-deurbel als blok op Home en een melding als er wordt aangebeld" },
  { key: "aanwezigheid", label: "Wie is thuis",         hint: "Zoekt de aangemelde telefoons op het thuisnetwerk; in te stellen bij Instellingen > Wie is thuis" },
  { key: "eetpoll",     label: "Eetpoll",                hint: "Elke maandag om 08:00 een nieuwe poll op Home: wie eet welke dag mee" },
  { key: "boodschappen", label: "Boodschappenlijst",     hint: "Gezamenlijke lijst als blok op Home, met erbij wie wat heeft toegevoegd" },
  { key: "afval",       label: "Afvalkalender",          hint: "Blok op Home en de herinnering via Discord" },
  { key: "lights",      label: "Verlichting en scènes",  hint: "Ledstrips, lamp en scèneknoppen" },
  { key: "fridge",      label: "Koelkast",               hint: "Koelkastkaart en offline-melding" },
  { key: "temperature", label: "Temperatuursensoren",    hint: "Kamertemperaturen en temperatuurverloop" },
  { key: "esphome",     label: "ESPHome-sensoren",       hint: "Sensorkaart op Thuis" },
  { key: "wasmachine",  label: "Wasmachine",             hint: "Wasmachinekaart en de melding dat de was klaar is" },
  { key: "vaatwasser",  label: "Vaatwasser",             hint: "Vaatwasserkaart (Home Connect) en de melding dat de vaat klaar is" },
  { key: "tado",        label: "Verwarming (tado°)",     hint: "Thermostaatkaart op Thuis met bediening, en meldingen bij offline of vorst" },
  { key: "tapo",        label: "Tapo (TP-Link)",         hint: "Uitlezen van de Tapo-stekker (wasmachine) en T310-sensor (badkamer) via de TP-Link cloud" },
  { key: "samen",       label: "Samen-pagina",           hint: "Aparte pagina met de eetpoll en de boodschappenlijst (in de onderbalk)", def: false },
  { key: "discord",     label: "Discord-meldingen",      hint: "Alle berichten naar Discord: herinneringen, offline-meldingen en flows" }
];

function saved() {
  return auth.readConfig().modules || {};
}

// Standaard staat een module aan; met def:false staat hij uit tot hij expliciet wordt aangezet
function defaultOn(m) {
  return !(m && m.def === false);
}

function isOn(key) {
  var v = saved()[key];
  if (v === undefined) return defaultOn(MODULES.filter(function(m) { return m.key === key; })[0]);
  return v !== false;
}

// { gas: true, weather: false, ... }
function getMap() {
  var s = saved(), map = {};
  MODULES.forEach(function(m) { var v = s[m.key]; map[m.key] = v === undefined ? defaultOn(m) : v !== false; });
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

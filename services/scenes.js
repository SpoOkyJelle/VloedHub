var fs = require("fs");
var path = require("path");
var state = require("../utils/state");

// Scènes zetten meerdere lampen in één keer. Ze zijn aan te passen bij Instellingen
// en staan in data/scenes.json; tot er iets is opgeslagen gelden de vier standaardscènes.
// Per apparaat: geen invoer = niet wijzigen. Effect 0 = Warm Wit, 2 = Rainbow, 3 = Rainbow Wave, 10 = Eigen kleur.
var SCENES_FILE = path.join(__dirname, "../data/scenes.json");

var LED_DEVICES   = ["default", "keuken", "gang"];
var RELAY_DEVICES = ["gang"];
var ICONS = ["power-off", "moon", "lightbulb", "music", "sun", "film", "bed", "utensils", "couch", "star", "heart", "wand-magic-sparkles"];
var MAX_EFFECT = 10;

var DEFAULTS = [
  { id: "all_off", label: "Alles uit", icon: "power-off",
    led: { "default": { on: false }, "keuken": { on: false }, "gang": { on: false } }, relay: { "gang": { on: false } } },
  { id: "evening", label: "Avond", icon: "moon",
    led: { "default": { on: true, effect: 0, brightness: 110 }, "keuken": { on: true, effect: 0, brightness: 110 }, "gang": { on: true, effect: 0, brightness: 110 } },
    relay: { "gang": { on: true } } },
  { id: "all_on", label: "Alles aan", icon: "lightbulb",
    led: { "default": { on: true }, "keuken": { on: true }, "gang": { on: true } }, relay: { "gang": { on: true } } },
  { id: "disco", label: "Disco", icon: "music",
    led: { "default": { on: true, effect: 3 }, "keuken": { on: true, effect: 3 }, "gang": { on: true, effect: 2 } }, relay: { "gang": { on: false } } }
];

function list() {
  try {
    var saved = JSON.parse(fs.readFileSync(SCENES_FILE, "utf8"));
    if (Array.isArray(saved)) return saved;
  } catch (e) {}
  return JSON.parse(JSON.stringify(DEFAULTS));
}

function write(scenes) {
  var dir = path.dirname(SCENES_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SCENES_FILE, JSON.stringify(scenes, null, 2));
}

function clamp(v, min, max, fallback) {
  v = parseInt(v, 10);
  return isNaN(v) ? fallback : Math.max(min, Math.min(max, v));
}

// Houdt alleen bekende apparaten en geldige waarden over
function clean(input) {
  var label = String(input.label || "").trim().slice(0, 24);
  if (!label) return null;
  var scene = { id: null, label: label, icon: ICONS.indexOf(input.icon) !== -1 ? input.icon : "lightbulb", led: {}, relay: {} };
  LED_DEVICES.forEach(function(d) {
    var src = (input.led || {})[d];
    if (!src || typeof src !== "object") return;
    var out = { on: !!src.on };
    if (out.on) {
      if (src.effect != null) out.effect = clamp(src.effect, 0, MAX_EFFECT, 0);
      if (src.brightness != null) out.brightness = clamp(src.brightness, 10, 255, 180);
      if (src.color && typeof src.color === "object") {
        out.color = { r: clamp(src.color.r, 0, 255, 255), g: clamp(src.color.g, 0, 255, 255), b: clamp(src.color.b, 0, 255, 255) };
      }
    }
    scene.led[d] = out;
  });
  RELAY_DEVICES.forEach(function(d) {
    var src = (input.relay || {})[d];
    if (src && typeof src === "object") scene.relay[d] = { on: !!src.on };
  });
  return scene;
}

// Nieuwe scène als id ontbreekt of onbekend is, anders bijwerken
function save(input) {
  var scene = clean(input || {});
  if (!scene) return null;
  var scenes = list();
  var idx = input.id ? scenes.findIndex(function(s) { return s.id === input.id; }) : -1;
  if (idx !== -1) {
    scene.id = scenes[idx].id;
    scenes[idx] = scene;
  } else {
    scene.id = "s" + Date.now().toString(36);
    scenes.push(scene);
  }
  write(scenes);
  return scene;
}

function remove(id) {
  var scenes = list();
  var rest = scenes.filter(function(s) { return s.id !== id; });
  if (rest.length === scenes.length) return false;
  write(rest);
  return true;
}

// De scène die het laatst is gestart. Alle open schermen vragen dit na, zodat bijvoorbeeld de discostand van de app
// op de wandtablet meegaat als iemand hem op zijn telefoon start. Niet bewaard: na een herstart is er geen actieve scène.
var active = { id: null, at: 0 };
function getActive() { return active; }
function clearActive() { active = { id: null, at: Date.now() }; }

function run(id) {
  var scene = list().filter(function(s) { return s.id === id; })[0];
  if (!scene) return false;
  active = { id: id, at: Date.now() };
  Object.keys(scene.led || {}).forEach(function(d) { Object.assign(state.getLedState(d), scene.led[d]); });
  Object.keys(scene.relay || {}).forEach(function(d) { Object.assign(state.getRelayState(d), scene.relay[d]); });
  state.saveState();
  return true;
}

module.exports = { list: list, save: save, remove: remove, run: run, getActive: getActive, clearActive: clearActive, ICONS: ICONS, LED_DEVICES: LED_DEVICES, RELAY_DEVICES: RELAY_DEVICES };

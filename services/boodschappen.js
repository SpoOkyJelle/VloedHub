var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var auth = require("./auth");

// De gezamenlijke boodschappenlijst. Iedere gebruiker kan er iets op zetten; bij elk ding staat wie het heeft
// toegevoegd. In de winkel vink je af wat in de kar ligt; iedereen kan afvinken en weghalen. Wat is afgevinkt
// blijft nog een dag onderaan staan (voor als het per ongeluk was) en verdwijnt daarna vanzelf.
// De lijst staat in data/boodschappen.json (niet in git).
var FILE = path.join(__dirname, "../data/boodschappen.json");
var MAX_ITEMS = 100;
var MAX_TEXT = 60;
var KEEP_DONE = 24 * 3600000;

// [{ id, text, by, byName, at, done, doneBy, doneAt }]: by en doneBy zijn het id van de gebruiker; de naam
// van wie het toevoegde staat erbij voor als die gebruiker later verwijderd wordt
var items = load();

function load() {
  try {
    var list = JSON.parse(fs.readFileSync(FILE, "utf8")).items;
    return Array.isArray(list) ? list.filter(function(x) { return x && x.id && x.text; }) : [];
  } catch (e) { return []; }
}

function save() {
  try {
    var dir = path.dirname(FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify({ items: items }, null, 2));
  } catch (e) { console.error("[boodschappen]", e.message); }
}

function find(id) {
  return items.filter(function(x) { return x.id === id; })[0] || null;
}

// Geeft een foutmelding terug, of null
function add(user, text) {
  text = String(text == null ? "" : text).replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
  if (!text) return "Vul in wat er gehaald moet worden";
  var open = items.filter(function(x) { return !x.done; });
  if (open.some(function(x) { return x.text.toLowerCase() === text.toLowerCase(); })) return "Dat staat al op de lijst";
  if (items.length >= MAX_ITEMS) return "De lijst is vol; haal eerst iets weg";
  items.push({ id: crypto.randomBytes(6).toString("hex"), text: text, by: user.id, byName: user.name, at: Date.now(), done: false });
  save();
  return null;
}

function setDone(user, id, done) {
  var item = find(id);
  if (!item) return "Dat staat niet meer op de lijst";
  item.done = !!done;
  if (item.done) { item.doneBy = user.id; item.doneAt = Date.now(); }
  else { delete item.doneBy; delete item.doneAt; }
  save();
  return null;
}

function remove(id) {
  if (!find(id)) return null;
  items = items.filter(function(x) { return x.id !== id; });
  save();
  return null;
}

// Alles weghalen wat is afgevinkt
function clearDone() {
  items = items.filter(function(x) { return !x.done; });
  save();
  return null;
}

// Voor de browser: eerst wat nog gehaald moet worden (oudste bovenaan), daaronder wat net is afgevinkt
function getStatus(me) {
  var now = Date.now(), before = items.length;
  items = items.filter(function(x) { return !x.done || now - (x.doneAt || 0) < KEEP_DONE; });
  if (items.length !== before) save();
  var users = auth.listUsers().map(function(u) { return { id: u.id, name: u.name, photo: u.photo }; });
  return {
    items: items.filter(function(x) { return !x.done; }).concat(items.filter(function(x) { return x.done; }).sort(function(a, b) { return b.doneAt - a.doneAt; })),
    users: users,
    me: me ? me.id : null
  };
}

module.exports = { getStatus: getStatus, add: add, setDone: setDone, remove: remove, clearDone: clearDone };

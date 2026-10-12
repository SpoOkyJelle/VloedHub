var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var auth = require("./auth");

// De gezamenlijke boodschappenlijst. Iedere gebruiker kan er iets op zetten; bij elk ding staat wie het heeft
// toegevoegd. In de winkel vink je af wat in de kar ligt; iedereen kan afvinken en weghalen. Wat is afgevinkt
// blijft nog een dag onderaan staan (voor als het per ongeluk was) en verdwijnt daarna vanzelf.
// Wat ooit op de lijst stond wordt geteld; de dingen die het vaakst terugkomen staan als voorstel boven de lijst,
// zodat je ze met één tik weer toevoegt.
// De lijst staat in data/boodschappen.json (niet in git).
var FILE = path.join(__dirname, "../data/boodschappen.json");
var MAX_ITEMS = 100;
var MAX_TEXT = 60;
var KEEP_DONE = 24 * 3600000;
var MAX_HISTORY = 200;
var SUGGESTIONS = 8;

// [{ id, text, by, byName, at, done, doneBy, doneAt }]: by en doneBy zijn het id van de gebruiker; de naam
// van wie het toevoegde staat erbij voor als die gebruiker later verwijderd wordt
var stored = load();
var items = stored.items;
var history = stored.history;   // [{ text, n, at }]: hoe vaak iets op de lijst is gezet, en wanneer voor het laatst

function load() {
  var data = {};
  try { data = JSON.parse(fs.readFileSync(FILE, "utf8")) || {}; } catch (e) {}
  return {
    items: Array.isArray(data.items) ? data.items.filter(function(x) { return x && x.id && x.text; }) : [],
    history: Array.isArray(data.history) ? data.history.filter(function(h) { return h && h.text; }) : []
  };
}

function save() {
  try {
    var dir = path.dirname(FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify({ items: items, history: history }, null, 2));
  } catch (e) { console.error("[boodschappen]", e.message); }
}

function find(id) {
  return items.filter(function(x) { return x.id === id; })[0] || null;
}

function remember(text) {
  var known = history.filter(function(h) { return h.text.toLowerCase() === text.toLowerCase(); })[0];
  if (known) { known.n++; known.at = Date.now(); known.text = text; }
  else history.push({ text: text, n: 1, at: Date.now() });
  // het minst gebruikte en oudste valt af
  if (history.length > MAX_HISTORY) history = history.sort(function(a, b) { return b.n - a.n || b.at - a.at; }).slice(0, MAX_HISTORY);
}

// Meer dingen tegelijk kan met een komma, puntkomma of nieuwe regel ertussen. Wat er al op staat wordt
// overgeslagen. Geeft een foutmelding terug als er niets is toegevoegd, anders null.
function add(user, text) {
  var parts = String(text == null ? "" : text).split(/[,;\n]+/).map(function(p) { return p.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT); }).filter(Boolean);
  if (!parts.length) return "Vul in wat er gehaald moet worden";
  var added = 0, full = false;
  parts.forEach(function(part) {
    // elke boodschap begint met een hoofdletter, zodat de lijst er netjes uitziet
    part = part.charAt(0).toUpperCase() + part.slice(1);
    if (items.some(function(x) { return !x.done && x.text.toLowerCase() === part.toLowerCase(); })) return;
    if (items.length >= MAX_ITEMS) { full = true; return; }
    items.push({ id: crypto.randomBytes(6).toString("hex"), text: part, by: user.id, byName: user.name, at: Date.now(), done: false });
    remember(part);
    added++;
  });
  if (added) save();
  return added ? null : full ? "De lijst is vol; ruim eerst op wat in de kar ligt" : "Dat staat al op de lijst";
}

// Wat het vaakst op de lijst stond en er nu niet op staat
function suggestions() {
  var open = items.filter(function(x) { return !x.done; }).map(function(x) { return x.text.toLowerCase(); });
  return history.filter(function(h) { return open.indexOf(h.text.toLowerCase()) === -1; })
    .sort(function(a, b) { return b.n - a.n || b.at - a.at; }).slice(0, SUGGESTIONS).map(function(h) { return h.text; });
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
    suggestions: suggestions(),
    me: me && !auth.isReadOnly(me) ? me.id : null
  };
}

module.exports = { getStatus: getStatus, add: add, setDone: setDone, remove: remove, clearDone: clearDone };

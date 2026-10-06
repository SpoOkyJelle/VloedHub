var fs = require("fs");
var path = require("path");

// Onthoudt waarover al een melding is verstuurd (storing, weerwaarschuwing), zodat een herstart
// van de server niet alles opnieuw meldt. Staat in data/notified.json, niet in git.
var FILE = path.join(__dirname, "../data/notified.json");
var MAX = 300;

function load() {
  try { var list = JSON.parse(fs.readFileSync(FILE, "utf8")); return Array.isArray(list) ? list : []; }
  catch (e) { return []; }
}

function has(key) {
  return load().indexOf(key) !== -1;
}

function add(key) {
  var list = load();
  if (list.indexOf(key) !== -1) return;
  list.push(key);
  try {
    var dir = path.dirname(FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(list.slice(-MAX)));
  } catch (e) {}
}

module.exports = { has: has, add: add };

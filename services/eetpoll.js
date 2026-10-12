var fs = require("fs");
var path = require("path");
var auth = require("./auth");
var discord = require("./discord");
var modules = require("./modules");
var time = require("../utils/time");

// Wie eet welke dag mee. Elke maandag om 08:00 gaat er een nieuwe poll open met de zeven dagen van die week;
// iedere gebruiker geeft per dag aan of hij mee-eet of niet, en iedereen ziet elkaars keuze. Tot maandag 08:00
// blijft de poll van de week ervoor staan. Een dag die voorbij is kan niet meer gewijzigd worden.
// De stemmen staan in data/eetpoll.json (niet in git).
var FILE = path.join(__dirname, "../data/eetpoll.json");
var OPENS_AT = 8 * 3600000;   // zo lang na middernacht op maandag
var DAYS = [0, 1, 2, 3, 4, 5, 6];

var poll = load();   // { week: "2026-10-12" (de maandag), votes: { gebruiker-id: [ja/nee/null per dag, maandag eerst] } }

function load() {
  try {
    var data = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return data && typeof data.week === "string" && data.votes && typeof data.votes === "object" ? data : null;
  } catch (e) { return null; }
}

function save() {
  try {
    var dir = path.dirname(FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(poll, null, 2));
  } catch (e) { console.error("[eetpoll]", e.message); }
}

function addDays(date, n) {
  return new Date(Date.parse(date + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
}

// De maandag van de poll die nu open staat (Nederlandse tijd)
function weekStart() {
  var day = time.cutoff(OPENS_AT).slice(0, 10);
  return addDays(day, -((new Date(day + "T00:00:00Z").getUTCDay() + 6) % 7));
}

// De poll van deze week; is de week om, dan begint er een lege en gaat er een melding uit
function current() {
  var week = weekStart();
  if (!poll || poll.week !== week) {
    poll = { week: week, votes: {} };
    save();
    if (modules.isOn("eetpoll") && auth.hasUsers()) discord.notify("eten", "🍽️ **De eetpoll van deze week staat open** — geef in VloedHub aan op welke dagen je mee-eet.");
  }
  return poll;
}

// eat: true (eet mee), false (eet niet mee) of null (keuze weghalen). Geeft een foutmelding terug, of null.
function vote(userId, day, eat) {
  var p = current();
  if (DAYS.indexOf(day) === -1) return "Onbekende dag";
  if (eat !== true && eat !== false && eat !== null) return "Ongeldige keuze";
  if (addDays(p.week, day) < time.todayAms()) return "Die dag is al voorbij";
  var mine = p.votes[userId] || (p.votes[userId] = DAYS.map(function() { return null; }));
  mine[day] = eat;
  save();
  return null;
}

// Voor de browser. me is de ingelogde gebruiker, of null zolang iedereen de gedeelde PIN gebruikt.
function getStatus(me) {
  var p = current(), today = time.todayAms(), votes = {};
  var users = auth.listUsers().map(function(u) { return { id: u.id, name: u.name, photo: u.photo }; });
  // wie verwijderd is telt niet meer mee
  users.forEach(function(u) { votes[u.id] = p.votes[u.id] || DAYS.map(function() { return null; }); });
  return {
    week: p.week,
    days: DAYS.map(function(i) { var date = addDays(p.week, i); return { date: date, past: date < today, today: date === today }; }),
    users: users,
    votes: votes,
    me: me ? me.id : null
  };
}

// Ook als niemand de app open heeft moet de nieuwe poll op maandag om 08:00 beginnen
function start() {
  setTimeout(current, 20000);
  setInterval(current, 60 * 1000);
}

module.exports = { getStatus: getStatus, vote: vote, start: start };

var fs = require("fs");
var path = require("path");
var auth = require("../services/auth");

// De indeling van de schermen. Iedere gebruiker heeft zijn eigen indeling (data/user-layouts.json, niet in git);
// wie nog niets heeft aangepast ziet de gezamenlijke uit data/layout.json. Zolang er geen gebruikers zijn is er
// alleen die gezamenlijke.
var LAYOUT_FILE = path.join(__dirname, "../data/layout.json");
var USER_FILE = path.join(__dirname, "../data/user-layouts.json");
var MAX_SIZE = 50 * 1024;

// "0" is Home; "kiosk" is Home in de tabletweergave (/?kiosk=1), met alleen wat je aan de wand wilt zien
var DEFAULT_LAYOUT = {
  "0": [
    {type:"weather",size:"2"},
    {type:"power_live",size:"1"},
    {type:"afval",size:"1"},
    {type:"led_default",size:"1"},
    {type:"led_keuken",size:"1"},
    {type:"led_gang",size:"1"},
    {type:"relay_gang",size:"1"},
    {type:"scenes",size:"4"},
    {type:"eetpoll",size:"2"},
    {type:"boodschappen",size:"2"},
    {type:"status",size:"2"},
    {type:"camera",size:"2"},
    {type:"today_vs_normal",size:"2"},
    {type:"internet",size:"2"},
    {type:"chart_power",size:"2"},
    {type:"month_forecast",size:"1"},
    {type:"standby",size:"1"}
  ],
  "kiosk": [
    {type:"weather",size:"2"},
    {type:"afval",size:"1"},
    {type:"power_live",size:"1"},
    {type:"led_default",size:"1"},
    {type:"led_keuken",size:"1"},
    {type:"led_gang",size:"1"},
    {type:"relay_gang",size:"1"},
    {type:"scenes",size:"4"},
    {type:"eetpoll",size:"2"},
    {type:"boodschappen",size:"2"},
    {type:"camera",size:"2"},
    {type:"status",size:"2"}
  ]
};

function readJson(file) {
  try { var data = JSON.parse(fs.readFileSync(file, "utf8")); return data && typeof data === "object" ? data : null; }
  catch(e) { return null; }
}

function writeJson(file, data) {
  var dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(file, JSON.stringify(data,null,2));
}

// De indeling van deze gebruiker, anders de gezamenlijke. Een bewaarde indeling van voor de tabletweergave
// mist dat deel; dat komt dan uit de standaard.
function load(userId) {
  var saved = (userId && (readJson(USER_FILE) || {})[userId]) || readJson(LAYOUT_FILE);
  if (!saved) return DEFAULT_LAYOUT;
  Object.keys(DEFAULT_LAYOUT).forEach(function(k) { if (!Array.isArray(saved[k])) saved[k] = DEFAULT_LAYOUT[k]; });
  return saved;
}
function save(data, userId) {
  if (!userId) return writeJson(LAYOUT_FILE, data);
  var all = readJson(USER_FILE) || {};
  all[userId] = data;
  writeJson(USER_FILE, all);
}
// Een verwijderde gebruiker laat geen indeling achter
function forget(userId) {
  var all = readJson(USER_FILE);
  if (!all || !all[userId]) return;
  delete all[userId];
  writeJson(USER_FILE, all);
}

function sessionUserId(req) {
  var me = auth.sessionUser(auth.getSessionToken(req));
  return me ? me.id : null;
}

module.exports = function(req, res) {
  if (req.method === "GET" && req.url === "/api/layout") {
    res.writeHead(200,{"Content-Type":"application/json"});
    res.end(JSON.stringify(load(sessionUserId(req))));
    return true;
  }
  if (req.method === "POST" && req.url === "/api/layout") {
    var body = "";
    req.on("data", function(c){ body += c; });
    req.on("end", function() {
      try {
        var data = JSON.parse(body);
        if (!data || typeof data !== "object" || Array.isArray(data) || body.length > MAX_SIZE) throw new Error("invalid");
        save(data, sessionUserId(req));
        res.writeHead(200,{"Content-Type":"application/json"});
        res.end(JSON.stringify({status:"ok"}));
      } catch(e) {
        res.writeHead(400,{"Content-Type":"application/json"});
        res.end(JSON.stringify({error:"invalid JSON"}));
      }
    });
    return true;
  }
  return false;
};

module.exports.load = load;
module.exports.forget = forget;

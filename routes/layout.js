var fs = require("fs");
var path = require("path");

var LAYOUT_FILE = path.join(__dirname, "../data/layout.json");

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
    {type:"camera",size:"2"},
    {type:"status",size:"2"}
  ]
};

// Een bewaarde indeling van voor de tabletweergave mist dat deel; dat komt dan uit de standaard
function load() {
  var saved;
  try { saved = JSON.parse(fs.readFileSync(LAYOUT_FILE,"utf8")); }
  catch(e) { return DEFAULT_LAYOUT; }
  Object.keys(DEFAULT_LAYOUT).forEach(function(k) { if (!Array.isArray(saved[k])) saved[k] = DEFAULT_LAYOUT[k]; });
  return saved;
}
function save(data) {
  var dir = path.dirname(LAYOUT_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(LAYOUT_FILE, JSON.stringify(data,null,2));
}

module.exports = function(req, res) {
  if (req.method === "GET" && req.url === "/api/layout") {
    res.writeHead(200,{"Content-Type":"application/json"});
    res.end(JSON.stringify(load()));
    return true;
  }
  if (req.method === "POST" && req.url === "/api/layout") {
    var body = "";
    req.on("data", function(c){ body += c; });
    req.on("end", function() {
      try {
        var data = JSON.parse(body);
        save(data);
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

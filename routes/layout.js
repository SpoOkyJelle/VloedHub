var fs = require("fs");
var path = require("path");

var LAYOUT_FILE = path.join(__dirname, "../data/layout.json");

var DEFAULT_LAYOUT = {
  "0": [
    {type:"weather",size:"2"},
    {type:"power_live",size:"1"},
    {type:"afval",size:"1"},
    {type:"led_default",size:"1"},
    {type:"led_keuken",size:"1"},
    {type:"led_gang",size:"1"},
    {type:"relay_gang",size:"1"},
    {type:"outages",size:"4"},
    {type:"rain",size:"2"},
    {type:"traffic",size:"2"},
    {type:"p2000",size:"2"},
    {type:"scenes",size:"4"},
    {type:"fridge",size:"2"},
    {type:"internet",size:"2"},
    {type:"camera",size:"2"},
    {type:"chart_power",size:"2"},
    {type:"phases",size:"2"},
    {type:"phase_load",size:"2"},
    {type:"today_vs_normal",size:"2"},
    {type:"month_forecast",size:"1"},
    {type:"standby",size:"1"}
  ]
};

function load() {
  try { return JSON.parse(fs.readFileSync(LAYOUT_FILE,"utf8")); }
  catch(e) { return DEFAULT_LAYOUT; }
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

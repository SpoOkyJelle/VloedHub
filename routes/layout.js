var fs = require("fs");
var path = require("path");

var LAYOUT_FILE = path.join(__dirname, "../data/layout.json");

var DEFAULT_LAYOUT = {
  "0": [
    {type:"weather",size:"full"},
    {type:"power_live",size:"full"},
    {type:"info_stats",size:"full"},
    {type:"device_controls",size:"full"},
    {type:"phases",size:"full"},
    {type:"recent_readings",size:"full"}
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

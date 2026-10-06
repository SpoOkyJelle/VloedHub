var https = require("https");
var os = require("os");
var modules = require("./modules");

function getLocalIP() {
  var ifaces = os.networkInterfaces();
  for (var name of Object.keys(ifaces)) {
    for (var iface of ifaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return "localhost";
}

var LOCAL_IP = getLocalIP();
var WAN_IP = "ophalen\u2026";

var DISCORD_WEBHOOK = "https://discord.com/api/webhooks/1542267218073616445/Q5m05IVLBKR5Au5CGnY54Rp-9NeHW5qyBZ6-QWLzYK6bEr8EA1aYDai14L363aljodxR";

function sendDiscord(message) {
  // uit te zetten bij Instellingen > Modules
  if (!modules.isOn("discord")) return;
  var body = JSON.stringify({ content: message });
  var url = new URL(DISCORD_WEBHOOK);
  var options = {
    hostname: url.hostname,
    path: url.pathname,
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
  };
  var req = https.request(options, function(res) { res.resume(); });
  req.on("error", function() {});
  req.write(body);
  req.end();
}

function fetchWanIP(callback) {
  https.get("https://api.ipify.org", function(res) {
    var data = "";
    res.on("data", function(c) { data += c; });
    res.on("end", function() { callback(null, data.trim()); });
  }).on("error", function(e) { callback(e); });
}

function init() {
  fetchWanIP(function(err, ip) {
    if (err) { WAN_IP = "onbekend"; return; }
    WAN_IP = ip;
    sendDiscord("\u2705 **VloedHub gestart** \u2014 WAN IP: http://" + WAN_IP + ":5000");
  });

  setInterval(function() {
    fetchWanIP(function(err, ip) {
      if (err || !ip) return;
      if (ip !== WAN_IP) {
        var old = WAN_IP;
        WAN_IP = ip;
        sendDiscord("\u26a0\ufe0f **WAN IP gewijzigd**\n~~`" + old + "`~~ \u2192 http://" + WAN_IP + ":5000");
      }
    });
  }, 5 * 60 * 1000);
}

module.exports = {
  sendDiscord: sendDiscord,
  fetchWanIP: fetchWanIP,
  get LOCAL_IP() { return LOCAL_IP; },
  get WAN_IP() { return WAN_IP; },
  DISCORD_WEBHOOK: DISCORD_WEBHOOK,
  init: init
};

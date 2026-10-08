var https = require("https");
var fs = require("fs");
var path = require("path");
var os = require("os");
var modules = require("./modules");
var notifications = require("./notifications");

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

// De webhook staat niet in de code: hij komt uit de omgevingsvariabele DISCORD_WEBHOOK
// of uit data/discord.json, en is in te stellen bij Instellingen.
var CONFIG_FILE = path.join(__dirname, "../data/discord.json");

function getWebhook() {
  if (process.env.DISCORD_WEBHOOK) return process.env.DISCORD_WEBHOOK;
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")).webhook || null; } catch (e) { return null; }
}

function validWebhook(url) {
  try {
    var u = new URL(url);
    return u.protocol === "https:" && /^((canary|ptb)\.)?(discord|discordapp)\.com$/.test(u.hostname) && u.pathname.indexOf("/api/webhooks/") === 0;
  } catch (e) { return false; }
}

// Lege waarde wist de webhook; false als het geen Discord-webhook is
function setWebhook(url) {
  url = String(url || "").trim();
  if (url && !validWebhook(url)) return false;
  var dir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ webhook: url || null }, null, 2));
  return true;
}

function getStatus() {
  var url = getWebhook();
  return { configured: !!url, hint: url ? url.slice(-4) : null, fromEnv: !!process.env.DISCORD_WEBHOOK, enabled: modules.isOn("discord") };
}

function post(webhook, message, cb) {
  var body = JSON.stringify({ content: message });
  var url = new URL(webhook);
  var req = https.request({
    hostname: url.hostname,
    path: url.pathname,
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
  }, function(res) { res.resume(); if (cb) cb(null, res.statusCode); });
  req.on("error", function(e) { if (cb) cb(e); });
  req.write(body);
  req.end();
}

// otherWebhook: een andere Discord-webhook voor dit ene bericht (bijv. vanuit een flow)
function sendDiscord(message, otherWebhook) {
  // uit te zetten bij Instellingen > Modules
  if (!modules.isOn("discord")) return;
  var webhook = (otherWebhook && validWebhook(otherWebhook)) ? otherWebhook : getWebhook();
  if (!webhook) return;
  post(webhook, message);
}

// Een melding: komt in het meldingenoverzicht van VloedHub en gaat naar Discord (als dat aan staat).
// category bepaalt het icoon: weer, storing, apparaat, wasmachine, vaatwasser, afval, deurbel, nlalert, p2000, flow, systeem.
function notify(category, message, otherWebhook) {
  notifications.add(category, message);
  sendDiscord(message, otherWebhook);
}

// Stuurt een testbericht, ook als de meldingen uit staan. cb(foutmelding of null)
function sendTest(cb) {
  var webhook = getWebhook();
  if (!webhook) return cb("Nog geen webhook ingesteld");
  post(webhook, "\u2705 Testbericht van VloedHub", function(err, status) {
    if (err) return cb("Discord niet bereikbaar");
    cb(status >= 200 && status < 300 ? null : "Discord weigerde het bericht (code " + status + ")");
  });
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
        notify("systeem", "\u26a0\ufe0f **WAN IP gewijzigd**\n~~`" + old + "`~~ \u2192 http://" + WAN_IP + ":5000");
      }
    });
  }, 5 * 60 * 1000);
}

module.exports = {
  sendDiscord: sendDiscord,
  notify: notify,
  fetchWanIP: fetchWanIP,
  get LOCAL_IP() { return LOCAL_IP; },
  get WAN_IP() { return WAN_IP; },
  sendTest: sendTest,
  setWebhook: setWebhook,
  getStatus: getStatus,
  init: init
};

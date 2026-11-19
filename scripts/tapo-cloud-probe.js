#!/usr/bin/env node
//
// Tapo cloud-probe voor VloedHub
// ------------------------------------------------------------------
// Doel: uitzoeken OF en WAT we van jouw Tapo-apparaten via de TP-Link
// cloud kunnen uitlezen, voordat we er een echte integratie tegenaan
// bouwen. Dit script wijzigt niets — het logt alleen in, somt je
// apparaten op en probeert per apparaat wat gegevens op te halen.
//
// Gebruik (je wachtwoord komt NIET in je shell-geschiedenis via env):
//   PowerShell:
//     $env:TAPO_EMAIL="jij@voorbeeld.nl"; $env:TAPO_PASSWORD="geheim"; node scripts/tapo-cloud-probe.js
//   Bash:
//     TAPO_EMAIL=jij@voorbeeld.nl TAPO_PASSWORD=geheim node scripts/tapo-cloud-probe.js
//
// Optioneel: TAPO_REGION (standaard "eu-wap"; andere opties bv. "wap", "aps1-wap", "use1-wap").
//
// Draai dit bij voorkeur op de machine waar VloedHub draait, of op een
// machine met gewoon internet — de cloud is overal bereikbaar.
//
// LET OP: deel de uitvoer niet zomaar openbaar; er staan apparaat-id's
// en MAC-adressen in. Het cloud-token wordt hieronder NIET afgedrukt.

var https = require("https");
var crypto = require("crypto");

var EMAIL = process.env.TAPO_EMAIL;
var PASSWORD = process.env.TAPO_PASSWORD;
var REGION = process.env.TAPO_REGION || "eu-wap";

if (!EMAIL || !PASSWORD) {
  console.error("Zet eerst TAPO_EMAIL en TAPO_PASSWORD (zie de uitleg bovenin dit bestand).");
  process.exit(1);
}

var LOGIN_URL = "https://" + REGION + ".tplinkcloud.com/";
var TERMINAL_UUID = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");

// Eenvoudige JSON-POST; cb(err, parsedBody)
function post(url, body, cb) {
  var u = new URL(url);
  var payload = JSON.stringify(body);
  var req = https.request({
    hostname: u.hostname,
    path: u.pathname + u.search,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload)
    },
    timeout: 20000
  }, function(res) {
    var chunks = "";
    res.on("data", function(c) { chunks += c; });
    res.on("end", function() {
      var data = null;
      try { data = JSON.parse(chunks); } catch (e) {}
      cb(null, data, res.statusCode, chunks);
    });
  });
  req.on("timeout", function() { req.destroy(new Error("timeout")); });
  req.on("error", cb);
  req.write(payload);
  req.end();
}

function login(cb) {
  post(LOGIN_URL, {
    method: "login",
    params: {
      appType: "Tapo_Android",
      cloudUserName: EMAIL,
      cloudPassword: PASSWORD,
      terminalUUID: TERMINAL_UUID
    }
  }, function(err, body) {
    if (err) return cb(err);
    if (!body || body.error_code !== 0 || !body.result || !body.result.token) {
      return cb(new Error("Inloggen mislukt: " + JSON.stringify(body)));
    }
    cb(null, body.result.token);
  });
}

function getDeviceList(token, cb) {
  post(LOGIN_URL + "?token=" + encodeURIComponent(token), { method: "getDeviceList" }, function(err, body) {
    if (err) return cb(err);
    if (!body || body.error_code !== 0 || !body.result) {
      return cb(new Error("getDeviceList mislukt: " + JSON.stringify(body)));
    }
    cb(null, body.result.deviceList || []);
  });
}

// Probeer één device-commando via cloud-passthrough. requestData is een JSON-string.
function passthrough(token, dev, innerMethod, cb) {
  var appUrl = (dev.appServerUrl || LOGIN_URL).replace(/\/$/, "") + "/";
  post(appUrl + "?token=" + encodeURIComponent(token), {
    method: "passthrough",
    params: {
      deviceId: dev.deviceId,
      requestData: JSON.stringify({ method: innerMethod })
    }
  }, function(err, body, status, raw) {
    if (err) return cb(err);
    // Bij Tapo komt het antwoord vaak als versleutelde string in result.responseData terug,
    // of als een foutcode. We geven alles terug zodat we kunnen zien wat er gebeurt.
    var inner = null;
    if (body && body.result && typeof body.result.responseData === "string") {
      try { inner = JSON.parse(body.result.responseData); } catch (e) { inner = "(niet-JSON / versleuteld: " + body.result.responseData.slice(0, 60) + "...)"; }
    }
    cb(null, { error_code: body && body.error_code, inner: inner, raw: body });
  });
}

function b64(s) {
  try { return Buffer.from(String(s), "base64").toString("utf8"); } catch (e) { return s; }
}

function tryMethods(token, dev, methods, done) {
  var out = {};
  (function next(i) {
    if (i >= methods.length) return done(out);
    passthrough(token, dev, methods[i], function(err, r) {
      out[methods[i]] = err ? ("ERROR: " + err.message) : r;
      next(i + 1);
    });
  })(0);
}

console.log("→ Inloggen bij " + LOGIN_URL + " ...");
login(function(err, token) {
  if (err) { console.error("✗ " + err.message); process.exit(1); }
  console.log("✓ Ingelogd (token verborgen).\n");

  getDeviceList(token, function(err, devices) {
    if (err) { console.error("✗ " + err.message); process.exit(1); }
    console.log("Gevonden apparaten: " + devices.length + "\n");

    devices.forEach(function(d, i) {
      console.log("[" + (i + 1) + "] " + b64(d.alias) + "  (" + (d.deviceName || "?") + " / " + (d.deviceModel || "?") + ")");
      console.log("     type:   " + d.deviceType);
      console.log("     id:     " + d.deviceId);
      console.log("     fw:     " + (d.fwVer || "?") + "   status(online): " + d.status);
      console.log("     server: " + d.appServerUrl);
      console.log("");
    });

    // Per relevant apparaat een paar reads proberen
    var targets = devices.filter(function(d) {
      var t = (d.deviceType || "").toUpperCase();
      return t.indexOf("PLUG") !== -1 || t.indexOf("HUB") !== -1;
    });

    if (!targets.length) {
      console.log("Geen plug/hub gevonden om uit te lezen. Klaar.");
      process.exit(0);
    }

    (function probeNext(i) {
      if (i >= targets.length) {
        console.log("\nKlaar. Stuur de uitvoer hierboven terug, dan bouw ik de integratie tegen wat echt werkt.");
        process.exit(0);
      }
      var d = targets[i];
      var t = (d.deviceType || "").toUpperCase();
      var methods = t.indexOf("HUB") !== -1
        ? ["get_device_info", "get_child_device_list"]        // hub: de T310 zit als 'child'
        : ["get_device_info", "get_current_power", "get_energy_usage"]; // plug: vermogen/verbruik
      console.log("── Passthrough-test: " + b64(d.alias) + " (" + d.deviceModel + ") ──");
      tryMethods(token, d, methods, function(res) {
        Object.keys(res).forEach(function(m) {
          console.log("  " + m + ":");
          console.log("    " + JSON.stringify(res[m]).slice(0, 800));
        });
        console.log("");
        probeNext(i + 1);
      });
    })(0);
  });
});

var db = require("../db/setup");
var logging = require("../db/logging");
var discord = require("../services/discord");
var time = require("../utils/time");

module.exports = function(req, res) {
  if (req.method === "POST" && req.url === "/api/wasmachine") {
    var contentTypeW = req.headers["content-type"] || "";
    if (!contentTypeW.includes("application/json")) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "expected application/json" }));
      return true;
    }

    var bodyW = "";
    req.on("data", function(chunk) { bodyW += chunk; });
    req.on("end", function() {
      var dataW;
      try { dataW = JSON.parse(bodyW); }
      catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid JSON" }));
        return;
      }
      logging.logWashCycle(dataW, function(err) {
        if (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "db error" }));
          return;
        }
        logging.setWashStatus("done", dataW.device);
        if (require("../services/modules").isOn("wasmachine")) discord.sendDiscord("\ud83e\uddf8 **Was is klaar!** (" + (dataW.device || "wasmachine") + ")");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      });
    });
    return true;
  }

  if (req.method === "GET" && req.url === "/api/wasmachine/stats") {
    db.get(
      "SELECT COUNT(*) as total," +
      " SUM(CASE WHEN finished_at >= ? THEN 1 ELSE 0 END) as today," +
      " SUM(CASE WHEN finished_at >= ? THEN 1 ELSE 0 END) as this_week," +
      " SUM(CASE WHEN finished_at >= ? THEN 1 ELSE 0 END) as this_month," +
      " MAX(finished_at) as last_finished_at" +
      " FROM wasmachine_cycles",
      [time.todayAms() + "T00:00:00", time.cutoff(604800000), time.cutoff(2592000000)],
      function(err, row) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(row || {}));
      }
    );
    return true;
  }

  if (req.method === "GET" && req.url.indexOf("/api/wasmachine/recent") === 0) {
    var limitW = 50;
    var qsW = req.url.indexOf("?limit=");
    if (qsW !== -1) limitW = parseInt(req.url.slice(qsW + 7), 10) || 50;
    db.all(
      "SELECT id, finished_at, device FROM wasmachine_cycles ORDER BY id DESC LIMIT ?",
      [limitW],
      function(err, rows) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(rows || []));
      }
    );
    return true;
  }

  if (req.method === "GET" && req.url === "/api/wasmachine/weekday") {
    db.all(
      "SELECT strftime('%w', finished_at) as dow, COUNT(*) as n" +
      " FROM wasmachine_cycles" +
      " GROUP BY dow ORDER BY dow",
      function(err, rows) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(rows || []));
      }
    );
    return true;
  }

  if (req.method === "POST" && req.url === "/api/wasmachine/start") {
    var contentTypeS = req.headers["content-type"] || "";
    if (!contentTypeS.includes("application/json")) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "expected application/json" }));
      return true;
    }
    var bodyS = "";
    req.on("data", function(chunk) { bodyS += chunk; });
    req.on("end", function() {
      var dataS;
      try { dataS = JSON.parse(bodyS); }
      catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid JSON" }));
        return;
      }
      logging.setWashStatus("running", dataS.device, function(err) {
        if (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "db error" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      });
    });
    return true;
  }

  if (req.method === "POST" && req.url === "/api/wasmachine/reset") {
    var contentTypeR = req.headers["content-type"] || "";
    if (!contentTypeR.includes("application/json")) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "expected application/json" }));
      return true;
    }
    var bodyR = "";
    req.on("data", function(chunk) { bodyR += chunk; });
    req.on("end", function() {
      var dataR;
      try { dataR = JSON.parse(bodyR); }
      catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid JSON" }));
        return;
      }
      logging.setWashStatus("idle", dataR.device, function(err) {
        if (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "db error" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      });
    });
    return true;
  }

  if (req.method === "GET" && req.url === "/api/wasmachine/status") {
    db.get("SELECT state, since, device FROM wasmachine_status WHERE id = 1", function(err, row) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(row || { state: "idle", since: null, device: null }));
    });
    return true;
  }

  return false;
};

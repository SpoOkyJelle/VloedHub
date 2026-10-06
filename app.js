/*
 * Simple local server for the GoonESP32-P1meter dongle.
 *
 * Receives JSON P1 readings via HTTP POST and stores them in SQLite.
 * Visit http://localhost:5000 for a live dashboard.
 *
 * Run with:
 *     npm install
 *     node app.js
 *
 * The ESP32 sketch expects this reachable at:
 *     http://192.168.178.10:5000/api/p1data
 */

var server     = require("./server");
var discord    = require("./services/discord");
var flowrunner = require("./services/flowrunner");
var afval      = require("./services/afval");
var prices     = require("./services/prices");
var monitor    = require("./services/monitor");
var outages    = require("./services/outages");
var warnings   = require("./services/warnings");
var db         = require("./db/setup");

var PORT = 5000;

discord.init();
flowrunner.start(db);
afval.startReminder();
prices.backfill();
monitor.start();
outages.start();
warnings.start();

server.listen(PORT, "0.0.0.0", function() {
  console.log("Server listening on http://0.0.0.0:" + PORT);
});

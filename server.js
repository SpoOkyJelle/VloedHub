var http = require("http");

var routes = [
  require("./routes/p1"),
  require("./routes/wasmachine"),
  require("./routes/temperature"),
  require("./routes/gas"),
  require("./routes/costs"),
  require("./routes/weather"),
  require("./routes/led"),
  require("./routes/debug"),
  require("./routes/pages")
];

var server = http.createServer(function(req, res) {
  for (var i = 0; i < routes.length; i++) {
    if (routes[i](req, res)) return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

module.exports = server;

var db = require("../db/setup");
var time = require("../utils/time");

module.exports = function(req, res) {
  if (req.method === "GET" && req.url === "/api/gas-daily") {
    db.all(
      "SELECT date(received_at) as day," +
      " MAX(gas_m3) - MIN(gas_m3) as gas_used" +
      " FROM readings" +
      " WHERE received_at >= ?" +
      " AND gas_m3 IS NOT NULL" +
      " GROUP BY date(received_at)" +
      " ORDER BY day ASC",
      [time.effectiveCutoff(2592000000)],
      function(err, rows) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(rows || []));
      }
    );
    return true;
  }

  if (req.method === "GET" && req.url === "/api/gas-monthly") {
    db.all(
      "SELECT strftime('%Y-%m', received_at) as month, MAX(gas_m3)-MIN(gas_m3) as gas_used," +
      " MIN(date(received_at)) as first_day" +
      " FROM readings" +
      " WHERE gas_m3 IS NOT NULL AND received_at >= ?" +
      " GROUP BY month ORDER BY month ASC",
      [time.dataFloor()],
      function(err, rows) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(rows || []));
      }
    );
    return true;
  }

  return false;
};

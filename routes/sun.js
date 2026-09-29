var sun = require('../services/sun');

module.exports = function(req, res) {
  if (req.url !== '/api/sun' || req.method !== 'GET') return false;
  sun.getSunTimes(function(err, times) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(err ? null : times));
  });
  return true;
};

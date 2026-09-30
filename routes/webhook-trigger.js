var db         = require('../db/setup');
var flowrunner = require('../services/flowrunner');

module.exports = function(req, res) {
  var match = req.url.match(/^\/api\/webhook\/([^/?]+)/);
  if (!match) return false;
  if (req.method !== 'POST' && req.method !== 'GET') return false;

  var token = decodeURIComponent(match[1]);
  flowrunner.triggerWebhook(token, db);

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, token: token }));
  return true;
};

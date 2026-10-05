var state = require('../utils/state');

function readBody(req, cb) {
  var body = '';
  req.on('data', function(c) { body += c; });
  req.on('end', function() {
    try { cb(null, JSON.parse(body || '{}')); } catch(e) { cb(e); }
  });
}

module.exports = function(req, res) {
  if (req.url.indexOf('/api/relay/state') !== 0) return false;

  var qs     = req.url.indexOf('?device=');
  var device = qs !== -1 ? decodeURIComponent(req.url.slice(qs + 8).split('&')[0]) : 'gang';

  if (req.method === 'GET') {
    var ua = req.headers['user-agent'] || '';
    if (!ua.includes('Mozilla')) {
      var ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').replace('::ffff:', '');
      var rs2 = state.getRelayState(device);
      if (ip) { rs2.ip = ip; state.saveState(); }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(state.getRelayState(device)));
    return true;
  }

  if (req.method === 'POST') {
    readBody(req, function(err, body) {
      var rs = state.getRelayState(device);
      if (body.on !== undefined) rs.on = !!body.on;
      state.saveState();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(rs));
    });
    return true;
  }

  return false;
};

var fs   = require('fs');
var path = require('path');
var auth = require('../services/auth');

var PIN_PAGE = fs.readFileSync(path.join(__dirname, '../public/pin.html'), 'utf8');

function readBody(req, cb) {
  var body = '';
  req.on('data', function(c) { body += c; });
  req.on('end', function() {
    try { cb(null, JSON.parse(body || '{}')); } catch(e) { cb(e); }
  });
}

module.exports = function(req, res) {

  // ── PIN entry page ──────────────────────────────────────────────────────
  if (req.method === 'GET' && req.url.split('?')[0] === '/pin') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PIN_PAGE);
    return true;
  }

  // ── Login ───────────────────────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/api/auth/login') {
    readBody(req, function(err, body) {
      if (err || !body.pin) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Ongeldige aanvraag' }));
        return;
      }
      if (auth.pinIsCorrect(body.pin)) {
        var token = auth.createSession();
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Set-Cookie': auth.sessionCookie(token)
        });
        res.end(JSON.stringify({ ok: true }));
      } else {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Verkeerde pincode' }));
      }
    });
    return true;
  }

  // ── Logout ──────────────────────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/api/auth/logout') {
    var token = auth.getSessionToken(req);
    if (token) auth.destroySession(token);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': auth.clearCookie()
    });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  // ── Set / change PIN ─────────────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/api/auth/set-pin') {
    var sessionToken = auth.getSessionToken(req);
    if (!auth.isValidSession(sessionToken)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Niet ingelogd' }));
      return true;
    }
    readBody(req, function(err, body) {
      if (err || !body.pin || !/^\d{4}$/.test(body.pin)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Voer een geldige 4-cijferige pincode in' }));
        return;
      }
      // Require current PIN when one is already set
      if (auth.pinIsSet() && !auth.pinIsCorrect(body.current)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Huidige pincode onjuist' }));
        return;
      }
      auth.setPin(body.pin);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    return true;
  }

  // ── Auth status ──────────────────────────────────────────────────────────
  if (req.method === 'GET' && req.url === '/api/auth/status') {
    var tok = auth.getSessionToken(req);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ loggedIn: auth.isValidSession(tok), pinSet: auth.pinIsSet() }));
    return true;
  }

  return false;
};

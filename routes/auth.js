var fs   = require('fs');
var path = require('path');
var auth = require('../services/auth');
var notifications = require('../services/notifications');
var layout = require('./layout');

var PIN_PAGE = fs.readFileSync(path.join(__dirname, '../public/pin.html'), 'utf8');

function readBody(req, cb) {
  var body = '';
  req.on('data', function(c) { body += c; });
  req.on('end', function() {
    try { cb(null, JSON.parse(body || '{}')); } catch(e) { cb(e); }
  });
}

function clientIp(req) {
  return String(req.socket.remoteAddress || '').replace('::ffff:', '');
}

function waitText(seconds) {
  return 'Te veel pogingen. Probeer het over ' + (seconds >= 90 ? Math.ceil(seconds / 60) + ' minuten' : seconds + ' seconden') + ' opnieuw';
}

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// De lijst voor Instellingen > Systeem, met wie er zelf is ingelogd
function usersReply(req) {
  var me = auth.sessionUser(auth.getSessionToken(req));
  return { ok: true, users: auth.listUsers(), me: me ? me.id : null };
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
      var ip = clientIp(req);
      var wait = auth.loginWait(ip);
      if (wait > 0) {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': String(wait) });
        res.end(JSON.stringify({ ok: false, error: waitText(wait) }));
        return;
      }
      // met gebruikers hoort de PIN bij degene die is aangetikt; zonder geldt de gedeelde PIN
      var byUser = auth.hasUsers();
      if (byUser && typeof body.user !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Kies eerst wie je bent' }));
        return;
      }
      if (byUser ? auth.userPinIsCorrect(body.user, body.pin) : auth.pinIsCorrect(body.pin)) {
        auth.loginSucceeded(ip);
        var token = auth.createSession(byUser ? body.user : null);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Set-Cookie': auth.sessionCookie(token)
        });
        res.end(JSON.stringify({ ok: true }));
      } else {
        auth.loginFailed(ip);
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
    readBody(req, function(err, body) {
      if (err || !body.pin || !/^\d{4}$/.test(body.pin)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Voer een geldige 4-cijferige pincode in' }));
        return;
      }
      if (auth.pinIsSet()) {
        // PIN already exists: require valid session OR correct current PIN
        var sessionToken = auth.getSessionToken(req);
        var hasSession = auth.isValidSession(sessionToken);
        if (!hasSession) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Niet ingelogd' }));
          return;
        }
        var ipC = clientIp(req), waitC = auth.loginWait(ipC);
        if (waitC > 0) {
          res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': String(waitC) });
          res.end(JSON.stringify({ ok: false, error: waitText(waitC) }));
          return;
        }
        // een gebruiker wijzigt zijn eigen PIN; zonder gebruikers is het de gedeelde
        var me = auth.sessionUser(sessionToken);
        if (!(me ? auth.userPinIsCorrect(me.id, body.current) : auth.pinIsCorrect(body.current))) {
          auth.loginFailed(ipC);
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Huidige pincode onjuist' }));
          return;
        }
        if (me) {
          auth.updateUser(me.id, { pin: body.pin });
          auth.destroyUserSessions(me.id, sessionToken);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
          return;
        }
      }
      // First-time setup or authenticated change: allow
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
    var who = auth.sessionUser(tok);
    // het inlogscherm laat de namen en foto's zien om uit te kiezen, dus die zijn zonder inlog op te vragen
    res.end(JSON.stringify({
      loggedIn: auth.isValidSession(tok), pinSet: auth.pinIsSet(),
      users: auth.listUsers().map(function(u) { return { id: u.id, name: u.name, photo: u.photo }; }),
      user: who ? { id: who.id, name: who.name, role: who.role } : null
    }));
    return true;
  }

  // ── Profielfoto ──────────────────────────────────────────────────────────
  // Ook zonder inlog, voor het inlogscherm. Het adres krijgt het moment van opslaan mee (?v=), dus de browser
  // mag de foto lang bewaren: een nieuwe foto heeft een nieuw adres.
  var avatar = req.method === 'GET' && req.url.match(/^\/api\/auth\/avatar\/([a-f0-9]{12})(?:\?.*)?$/);
  if (avatar) {
    var file = auth.photoFile(avatar[1]), image = null;
    try { image = file && fs.readFileSync(file); } catch(e) {}
    if (!image) { send(res, 404, { error: 'not found' }); return true; }
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=31536000, immutable' });
    res.end(image);
    return true;
  }

  // ── Gebruikers ───────────────────────────────────────────────────────────
  if (req.method === 'GET' && req.url === '/api/auth/users') {
    send(res, 200, usersReply(req));
    return true;
  }

  // De eerste gebruiker mag iedereen aanmaken die (nog met de gedeelde PIN) is ingelogd: die wordt beheerder
  if (req.method === 'POST' && req.url === '/api/auth/users/add') {
    readBody(req, function(err, body) {
      if (err) return send(res, 400, { ok: false, error: 'Ongeldige aanvraag' });
      var token = auth.getSessionToken(req), me = auth.sessionUser(token), first = !auth.hasUsers();
      if (!first && !auth.isAdmin(me)) return send(res, 403, { ok: false, error: 'Alleen de beheerder kan gebruikers toevoegen' });
      var added = auth.addUser(body.name, body.pin);
      if (added.error) return send(res, 400, { ok: false, error: added.error });
      if (first) auth.bindSession(token, added.user.id);
      send(res, 200, usersReply(req));
    });
    return true;
  }

  // Naam wijzigen kan iedereen bij zichzelf; een nieuwe PIN of een andere rol geeft de beheerder aan een ander
  if (req.method === 'POST' && req.url === '/api/auth/users/update') {
    readBody(req, function(err, body) {
      if (err) return send(res, 400, { ok: false, error: 'Ongeldige aanvraag' });
      var me = auth.sessionUser(auth.getSessionToken(req)), self = !!me && body.id === me.id;
      var newPin = body.pin !== undefined, newRole = body.role !== undefined;
      if (!me || (!auth.isAdmin(me) && (newPin || newRole || !self))) return send(res, 403, { ok: false, error: 'Dat kan alleen de beheerder' });
      if (newPin && self) return send(res, 400, { ok: false, error: 'Je eigen PIN wijzig je bij Beveiliging' });
      if (newRole) {
        var refused = auth.setRole(body.id, body.role);
        if (refused) return send(res, 400, { ok: false, error: refused });
        notifications.add('systeem', '👤 **Je rol is nu ' + auth.roleLabel(body.role) + '** — aangepast door ' + me.name + '.', body.id);
      }
      var changes = {};
      if (body.name !== undefined) changes.name = body.name;
      if (newPin) changes.pin = body.pin;
      var failed = auth.updateUser(body.id, changes);
      if (failed) return send(res, 400, { ok: false, error: failed });
      if (newPin) {
        auth.destroyUserSessions(body.id);
        notifications.add('systeem', '🔑 **Je hebt een nieuwe PIN gekregen** — ingesteld door ' + me.name + '. Kies zelf een nieuwe bij Instellingen > Systeem > Beveiliging.', body.id);
      }
      send(res, 200, usersReply(req));
    });
    return true;
  }

  // Een profielfoto zetten of weghalen (image: null): bij jezelf, of de beheerder bij een ander
  if (req.method === 'POST' && req.url === '/api/auth/users/photo') {
    readBody(req, function(err, body) {
      if (err) return send(res, 400, { ok: false, error: 'Ongeldige aanvraag' });
      var me = auth.sessionUser(auth.getSessionToken(req));
      if (!me || (!auth.isAdmin(me) && body.id !== me.id)) return send(res, 403, { ok: false, error: 'Dat kan alleen de beheerder' });
      var failed = auth.setPhoto(body.id, body.image);
      if (failed) return send(res, 400, { ok: false, error: failed });
      send(res, 200, usersReply(req));
    });
    return true;
  }

  // Er is één beheerder; die kan het beheer aan een ander geven en wordt dan zelf bewoner
  if (req.method === 'POST' && req.url === '/api/auth/users/transfer') {
    readBody(req, function(err, body) {
      if (err) return send(res, 400, { ok: false, error: 'Ongeldige aanvraag' });
      var me = auth.sessionUser(auth.getSessionToken(req));
      if (!auth.isAdmin(me)) return send(res, 403, { ok: false, error: 'Dat kan alleen de beheerder' });
      var failed = auth.transferAdmin(body.id);
      if (failed) return send(res, 400, { ok: false, error: failed });
      if (body.id !== me.id) notifications.add('systeem', '🛡️ **Je bent nu de beheerder** — ' + me.name + ' heeft het beheer aan jou overgedragen.', body.id);
      send(res, 200, usersReply(req));
    });
    return true;
  }

  if (req.method === 'POST' && req.url === '/api/auth/users/remove') {
    readBody(req, function(err, body) {
      if (err) return send(res, 400, { ok: false, error: 'Ongeldige aanvraag' });
      var me = auth.sessionUser(auth.getSessionToken(req));
      if (!auth.isAdmin(me)) return send(res, 403, { ok: false, error: 'Dat kan alleen de beheerder' });
      var failed = auth.removeUser(body.id);
      if (failed) return send(res, 400, { ok: false, error: failed });
      notifications.forget(body.id);
      layout.forget(body.id);
      send(res, 200, usersReply(req));
    });
    return true;
  }

  return false;
};

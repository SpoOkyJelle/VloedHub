var fs   = require('fs');
var path = require('path');
var db   = require('../db/setup');

var HTML = fs.readFileSync(path.join(__dirname, '../public/flows.html'), 'utf8');

function readBody(req, cb) {
  var body = '';
  req.on('data', function(c) { body += c; });
  req.on('end', function() {
    try { cb(null, JSON.parse(body || '{}')); } catch(e) { cb(e); }
  });
}

function nowAms() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Amsterdam' }).replace(' ', 'T');
}

module.exports = function(req, res) {

  // ── Page ────────────────────────────────────────────────────────────────
  if (req.method === 'GET' && req.url === '/flows') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(HTML);
    return true;
  }

  // ── List ────────────────────────────────────────────────────────────────
  if (req.method === 'GET' && req.url === '/api/flows') {
    db.all('SELECT id, name, enabled, created_at FROM flows ORDER BY id ASC', function(err, rows) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(rows || []));
    });
    return true;
  }

  // ── Create ──────────────────────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/api/flows') {
    readBody(req, function(err, body) {
      var name = (body && body.name) || 'Naamloos';
      db.run(
        'INSERT INTO flows (name, enabled, data, created_at) VALUES (?,1,?,?)',
        [name, '{}', nowAms()],
        function(dbErr) {
          if (dbErr) { res.writeHead(500); res.end('{}'); return; }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id: this.lastID, name: name, enabled: 1 }));
        }
      );
    });
    return true;
  }

  // ── Single flow (GET / PUT / DELETE) ────────────────────────────────────
  var single = req.url.match(/^\/api\/flows\/(\d+)$/);
  if (single) {
    var flowId = single[1];

    if (req.method === 'GET') {
      db.get('SELECT * FROM flows WHERE id = ?', [flowId], function(err, row) {
        if (!row) { res.writeHead(404); res.end('{}'); return; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(row));
      });
      return true;
    }

    if (req.method === 'PUT') {
      readBody(req, function(err, body) {
        if (err) { res.writeHead(400); res.end('{}'); return; }
        var fields = [], vals = [];
        if (body.name    !== undefined) { fields.push('name = ?');    vals.push(body.name); }
        if (body.enabled !== undefined) { fields.push('enabled = ?'); vals.push(body.enabled ? 1 : 0); }
        if (body.data    !== undefined) {
          fields.push('data = ?');
          vals.push(typeof body.data === 'string' ? body.data : JSON.stringify(body.data));
        }
        if (!fields.length) { res.writeHead(200); res.end('{"ok":true}'); return; }
        vals.push(flowId);
        db.run('UPDATE flows SET ' + fields.join(', ') + ' WHERE id = ?', vals, function(dbErr) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: !dbErr }));
        });
      });
      return true;
    }

    if (req.method === 'DELETE') {
      db.run('DELETE FROM flows WHERE id = ?', [flowId], function() {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      });
      return true;
    }
  }

  // ── Manual run ──────────────────────────────────────────────────────────
  var runMatch = req.url.match(/^\/api\/flows\/(\d+)\/run$/);
  if (runMatch && req.method === 'POST') {
    var runId = runMatch[1];
    var runner = require('../services/flowrunner');
    db.get('SELECT * FROM flows WHERE id = ?', [runId], function(err, flow) {
      if (!flow) { res.writeHead(404); res.end('{}'); return; }
      runner.runFlow(flow, db, function(actions) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, actions: actions }));
      });
    });
    return true;
  }

  return false;
};

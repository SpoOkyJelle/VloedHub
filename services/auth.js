var fs     = require('fs');
var path   = require('path');
var crypto = require('crypto');

var CONFIG_PATH = path.join(__dirname, '../data/config.json');

// ── Config helpers ────────────────────────────────────────────────────────
function readConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return {};
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch(e) { return {}; }
}

function writeConfig(cfg) {
  var dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

function hashPin(pin) {
  return crypto.createHash('sha256').update('vloedhub:' + pin).digest('hex');
}

// ── PIN management ────────────────────────────────────────────────────────
function pinIsSet() {
  return !!readConfig().pinHash;
}

function pinIsCorrect(pin) {
  var cfg = readConfig();
  if (!cfg.pinHash) return true; // no PIN set yet → always pass
  return cfg.pinHash === hashPin(pin);
}

function setPin(pin) {
  var cfg = readConfig();
  cfg.pinHash = hashPin(pin);
  writeConfig(cfg);
}

// ── Session management ────────────────────────────────────────────────────
var sessions = {};  // token → expiry timestamp
var SESSION_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

function createSession() {
  var token = crypto.randomBytes(32).toString('hex');
  sessions[token] = Date.now() + SESSION_TTL;
  return token;
}

function isValidSession(token) {
  if (!token) return false;
  var exp = sessions[token];
  if (!exp) return false;
  if (Date.now() > exp) { delete sessions[token]; return false; }
  return true;
}

function destroySession(token) {
  delete sessions[token];
}

// Parse session token from Cookie header
function getSessionToken(req) {
  var header = req.headers['cookie'] || '';
  var match = header.match(/(?:^|;\s*)vloedhub_session=([a-f0-9]{64})/);
  return match ? match[1] : null;
}

function sessionCookie(token) {
  return 'vloedhub_session=' + token + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + (SESSION_TTL / 1000);
}

function clearCookie() {
  return 'vloedhub_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0';
}

// Purge expired sessions every hour
setInterval(function() {
  var now = Date.now();
  Object.keys(sessions).forEach(function(t) { if (sessions[t] < now) delete sessions[t]; });
}, 3600000);

module.exports = { readConfig, writeConfig, pinIsSet, pinIsCorrect, setPin, createSession, isValidSession, destroySession, getSessionToken, sessionCookie, clearCookie };

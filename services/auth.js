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

// Oude opslag: één ronde SHA-256 met een vast zout. Wordt nog herkend en bij de eerstvolgende goede
// inlog vervangen door scrypt met een willekeurig zout ("scrypt$<zout>$<hash>").
function legacyHash(pin) {
  return crypto.createHash('sha256').update('vloedhub:' + pin).digest('hex');
}

function hashPin(pin, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  return 'scrypt$' + salt + '$' + crypto.scryptSync(String(pin), salt, 32).toString('hex');
}

function sameString(a, b) {
  var x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ── PIN management ────────────────────────────────────────────────────────
function pinIsSet() {
  return !!readConfig().pinHash;
}

function pinIsCorrect(pin) {
  var cfg = readConfig();
  if (!cfg.pinHash) return true; // no PIN set yet → always pass
  if (pin == null) return false;
  var parts = String(cfg.pinHash).split('$');
  if (parts[0] === 'scrypt') return sameString(cfg.pinHash, hashPin(pin, parts[1]));
  if (!sameString(cfg.pinHash, legacyHash(pin))) return false;
  setPin(pin); // oude opslag omzetten
  return true;
}

function setPin(pin) {
  var cfg = readConfig();
  cfg.pinHash = hashPin(pin);
  writeConfig(cfg);
}

// ── Rem op gokken ─────────────────────────────────────────────────────────
// Een PIN van vier cijfers is in tienduizend pogingen geraden. Na vijf fouten vanaf één adres volgt een
// wachttijd die elke keer verdubbelt (30 s tot een kwartier); daarnaast geldt een grens voor alle adressen
// samen, zodat gokken vanaf veel adressen tegelijk ook niet opschiet.
var attempts = {};   // ip → { fails, until }
var globalFails = [];
var FREE_TRIES = 5, GLOBAL_LIMIT = 30, GLOBAL_WINDOW = 15 * 60 * 1000;

// Aantal seconden dat dit adres nog moet wachten (0 = mag proberen)
function loginWait(ip) {
  var now = Date.now();
  globalFails = globalFails.filter(function(t) { return now - t < GLOBAL_WINDOW; });
  var a = attempts[ip];
  var wait = a && a.until > now ? a.until - now : 0;
  if (globalFails.length >= GLOBAL_LIMIT) wait = Math.max(wait, GLOBAL_WINDOW - (now - globalFails[0]));
  return Math.ceil(wait / 1000);
}

function loginFailed(ip) {
  var now = Date.now();
  var a = attempts[ip] || (attempts[ip] = { fails: 0, until: 0 });
  a.fails++;
  a.last = now;
  if (a.fails >= FREE_TRIES) a.until = now + Math.min(15 * 60 * 1000, 30000 * Math.pow(2, a.fails - FREE_TRIES));
  globalFails.push(now);
}

function loginSucceeded(ip) {
  delete attempts[ip];
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
  // adressen die een dag niets fout deden beginnen weer met een schone lei
  Object.keys(attempts).forEach(function(ip) { if (now - attempts[ip].last > 24 * 3600000) delete attempts[ip]; });
}, 3600000);

module.exports = { readConfig, writeConfig, pinIsSet, pinIsCorrect, setPin, loginWait, loginFailed, loginSucceeded, createSession, isValidSession, destroySession, getSessionToken, sessionCookie, clearCookie };

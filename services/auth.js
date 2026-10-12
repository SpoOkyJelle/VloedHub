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

function hashMatches(hash, pin) {
  var parts = String(hash).split('$');
  return parts[0] === 'scrypt' && sameString(hash, hashPin(pin, parts[1]));
}

// ── Gebruikers ────────────────────────────────────────────────────────────
// Iedere huisgenoot heeft een eigen naam en PIN. Ze staan in data/users.json (niet in git), de profielfoto's
// in data/avatars/. Iedereen heeft een rol: er is precies één beheerder ("admin"), de rest is bewoner. De eerste
// gebruiker wordt beheerder; alleen die kan anderen toevoegen, verwijderen of een nieuwe PIN geven, en het
// beheer overdragen aan een ander. Wat verder alleen de beheerder mag staat in server.js.
// Zolang er nog geen gebruikers zijn werkt de gedeelde PIN uit config.json zoals voorheen; daarna niet meer.
var USERS_PATH = path.join(__dirname, '../data/users.json');
var AVATAR_DIR = path.join(__dirname, '../data/avatars');
var MAX_USERS = 10;
var MAX_PHOTO = 300 * 1024;   // de browser verkleint de foto eerst; een echte is een paar tientallen kB
var users = loadUsers();   // [{ id, name, pinHash, role, photo }]: photo is het moment van opslaan, of ontbreekt

function loadUsers() {
  var list;
  try { list = JSON.parse(fs.readFileSync(USERS_PATH, 'utf8')).users; } catch(e) { return []; }
  if (!Array.isArray(list)) return [];
  list = list.filter(function(u) { return u && u.id && u.name && u.pinHash; });
  // precies één beheerder: de eerste die zo staat aangemerkt, anders de eerste gebruiker
  var boss = list.filter(function(u) { return u.role === 'admin' || u.admin; })[0] || list[0];
  list.forEach(function(u) { u.role = u === boss ? 'admin' : 'bewoner'; delete u.admin; });
  return list;
}

function saveUsers() {
  var dir = path.dirname(USERS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(USERS_PATH, JSON.stringify({ users: users }, null, 2));
}

function hasUsers() {
  return users.length > 0;
}

function getUser(id) {
  return users.filter(function(u) { return u.id === id; })[0] || null;
}

// Voor de browser; de PIN blijft op de server
function listUsers() {
  return users.map(function(u) { return { id: u.id, name: u.name, role: u.role, photo: u.photo || null }; });
}

function isAdmin(user) {
  return !!user && user.role === 'admin';
}

function validPin(pin) {
  return /^\d{4}$/.test(String(pin == null ? '' : pin));
}

// Geeft de opgeschoonde naam terug, of { error } als hij niet kan
function checkName(name, exceptId) {
  name = String(name == null ? '' : name).trim().slice(0, 30);
  if (!name) return { error: 'Vul een naam in' };
  var taken = users.some(function(u) { return u.id !== exceptId && u.name.toLowerCase() === name.toLowerCase(); });
  return taken ? { error: 'Er is al een gebruiker met die naam' } : { name: name };
}

function userPinIsCorrect(id, pin) {
  var u = getUser(id);
  return !!u && pin != null && hashMatches(u.pinHash, pin);
}

// { user } of { error }
function addUser(name, pin) {
  if (users.length >= MAX_USERS) return { error: 'Er zijn al ' + MAX_USERS + ' gebruikers' };
  var n = checkName(name);
  if (n.error) return n;
  if (!validPin(pin)) return { error: 'Voer een geldige 4-cijferige pincode in' };
  var u = { id: crypto.randomBytes(6).toString('hex'), name: n.name, pinHash: hashPin(pin), role: users.length ? 'bewoner' : 'admin' };
  users.push(u);
  saveUsers();
  return { user: u };
}

// changes: { name, pin }, elk optioneel. Geeft een foutmelding terug, of null.
function updateUser(id, changes) {
  var u = getUser(id), n = null;
  if (!u) return 'Onbekende gebruiker';
  if (changes.name !== undefined) {
    n = checkName(changes.name, id);
    if (n.error) return n.error;
  }
  if (changes.pin !== undefined && !validPin(changes.pin)) return 'Voer een geldige 4-cijferige pincode in';
  if (n) u.name = n.name;
  if (changes.pin !== undefined) u.pinHash = hashPin(changes.pin);
  saveUsers();
  return null;
}

// De beheerder geeft het beheer aan een ander en wordt zelf bewoner
function transferAdmin(toId) {
  var to = getUser(toId);
  if (!to) return 'Onbekende gebruiker';
  users.forEach(function(u) { u.role = u === to ? 'admin' : 'bewoner'; });
  saveUsers();
  return null;
}

function removeUser(id) {
  var u = getUser(id);
  if (!u) return 'Onbekende gebruiker';
  if (isAdmin(u)) return 'De beheerder kan niet verwijderd worden; draag het beheer eerst over';
  users = users.filter(function(x) { return x.id !== id; });
  saveUsers();
  try { fs.unlinkSync(path.join(AVATAR_DIR, id + '.jpg')); } catch(e) {}
  destroyUserSessions(id);
  return null;
}

// ── Profielfoto's ─────────────────────────────────────────────────────────
// Het bestand van de foto van deze gebruiker, of null als die er geen heeft
function photoFile(id) {
  var u = getUser(id);
  return u && u.photo ? path.join(AVATAR_DIR, u.id + '.jpg') : null;
}

// image: een data-URL met een JPEG (de browser snijdt en verkleint de foto eerst), of null om hem weg te halen.
// Geeft een foutmelding terug, of null.
function setPhoto(id, image) {
  var u = getUser(id);
  if (!u) return 'Onbekende gebruiker';
  var file = path.join(AVATAR_DIR, u.id + '.jpg');
  if (image == null) {
    try { fs.unlinkSync(file); } catch(e) {}
    delete u.photo;
    saveUsers();
    return null;
  }
  var m = String(image).match(/^data:image\/jpeg;base64,([A-Za-z0-9+\/]+=*)$/);
  var data = m && Buffer.from(m[1], 'base64');
  if (!data || data.length < 4 || data[0] !== 0xFF || data[1] !== 0xD8 || data[2] !== 0xFF) return 'Dat is geen geldige foto';
  if (data.length > MAX_PHOTO) return 'De foto is te groot';
  if (!fs.existsSync(AVATAR_DIR)) fs.mkdirSync(AVATAR_DIR, { recursive: true });
  fs.writeFileSync(file, data);
  u.photo = Date.now();
  saveUsers();
  return null;
}

// ── PIN management ────────────────────────────────────────────────────────
function pinIsSet() {
  return hasUsers() || !!readConfig().pinHash;
}

function pinIsCorrect(pin) {
  var cfg = readConfig();
  if (!cfg.pinHash) return true; // no PIN set yet → always pass
  if (pin == null) return false;
  if (String(cfg.pinHash).indexOf('scrypt$') === 0) return hashMatches(cfg.pinHash, pin);
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
var sessions = {};  // token → { exp, user }: user is het id van de gebruiker, of null bij een inlog met de gedeelde PIN
var SESSION_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

function createSession(userId) {
  var token = crypto.randomBytes(32).toString('hex');
  sessions[token] = { exp: Date.now() + SESSION_TTL, user: userId || null };
  return token;
}

function isValidSession(token) {
  if (!token) return false;
  var s = sessions[token];
  if (!s) return false;
  if (Date.now() > s.exp) { delete sessions[token]; return false; }
  // zodra er gebruikers zijn telt een inlog met de gedeelde PIN niet meer, en ook niet die van een verwijderde gebruiker
  if (users.length && !getUser(s.user)) { delete sessions[token]; return false; }
  return true;
}

// De gebruiker die bij deze sessie hoort, of null
function sessionUser(token) {
  return isValidSession(token) ? getUser(sessions[token].user) : null;
}

// Wie de eerste gebruiker aanmaakt was nog met de gedeelde PIN ingelogd; die sessie gaat verder als die gebruiker
function bindSession(token, userId) {
  if (sessions[token]) sessions[token].user = userId;
}

function destroySession(token) {
  delete sessions[token];
}

// Na een nieuwe PIN of het verwijderen van een gebruiker moeten diens andere apparaten opnieuw inloggen
function destroyUserSessions(userId, exceptToken) {
  Object.keys(sessions).forEach(function(t) { if (sessions[t].user === userId && t !== exceptToken) delete sessions[t]; });
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
  Object.keys(sessions).forEach(function(t) { if (sessions[t].exp < now) delete sessions[t]; });
  // adressen die een dag niets fout deden beginnen weer met een schone lei
  Object.keys(attempts).forEach(function(ip) { if (now - attempts[ip].last > 24 * 3600000) delete attempts[ip]; });
}, 3600000);

module.exports = { readConfig, writeConfig, pinIsSet, pinIsCorrect, setPin, loginWait, loginFailed, loginSucceeded, hasUsers, listUsers, userPinIsCorrect, isAdmin, addUser, updateUser, transferAdmin, removeUser, photoFile, setPhoto, createSession, isValidSession, sessionUser, bindSession, destroySession, destroyUserSessions, getSessionToken, sessionCookie, clearCookie };

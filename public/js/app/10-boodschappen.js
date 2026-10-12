// ── Boodschappen ──
// Blok op Home: de gezamenlijke boodschappenlijst. Iedereen kan iets toevoegen; achter elk ding staat de
// profielfoto van wie het erop zette. Tik op het rondje om af te vinken wat in de kar ligt; afgevinkte dingen
// zakken naar onderen en verdwijnen na een dag vanzelf, of meteen met "Afgevinkte weghalen".
var boodData = null;
function boodFace(item, users) {
  var u = users.filter(function(x) { return x.id === item.by; })[0];
  var name = u ? u.name : item.byName || 'Onbekend';
  return '<span class="bood-by" title="Toegevoegd door ' + escHtml(name) + '">' +
    (u && u.photo ? '<img src="' + userPhotoUrl(u) + '" alt="">' : '<b>' + escHtml(name.charAt(0).toUpperCase()) + '</b>') + '</span>';
}
function showBoodschappen(d, error) {
  var el = document.getElementById('blk-bood-list'), count = document.getElementById('blk-bood-count'), form = document.getElementById('blk-bood-form');
  if (!el || !d) return;
  boodData = d;
  var open = d.items.filter(function(x) { return !x.done; }).length, done = d.items.length - open;
  if (count) count.textContent = d.users.length ? (open ? open + ' te halen' : 'Niets te halen') : '';
  if (form) form.hidden = !d.me;
  if (!d.users.length) { el.innerHTML = '<div class="afval-empty">Voor de boodschappenlijst heeft iedereen een eigen account nodig<button class="btn btn-ghost" onclick="showScreen(5,null)">Gebruikers aanmaken</button></div>'; return; }
  el.innerHTML = (error ? '<div class="outage-sub c-red">' + escHtml(error) + '</div>' : '') +
    (d.items.length ? d.items.map(function(x) {
      var who = d.users.filter(function(u) { return u.id === x.by; })[0];
      return '<div class="bood-row' + (x.done ? ' done' : '') + '">' +
        '<button class="bood-check" role="checkbox" aria-checked="' + !!x.done + '" aria-label="' + escHtml(x.text) + (x.done ? ' terugzetten' : ' afvinken') + '" onclick="boodCheck(\'' + x.id + '\',' + !x.done + ')"><i class="fa-solid fa-check"></i></button>' +
        '<div class="bood-text"><span>' + escHtml(x.text) + '</span><small>' + escHtml(who ? who.name : x.byName || 'Onbekend') + ' · ' + shortWhen(x.at) + '</small></div>' +
        boodFace(x, d.users) +
        '<button class="bood-remove" aria-label="' + escHtml(x.text) + ' weghalen" onclick="boodPost(\'remove\',{id:\'' + x.id + '\'})"><i class="fa-solid fa-xmark"></i></button></div>';
    }).join('') : '<div class="bood-empty">De lijst is leeg. Zet erop wat er gehaald moet worden.</div>') +
    (done ? '<button class="presence-remove bood-clear" onclick="boodPost(\'clear\',{})">Afgevinkte weghalen (' + done + ')</button>' : '');
}
function loadBoodschappen() {
  if (!moduleOn('boodschappen') || !document.getElementById('blk-bood-list')) return;
  fetch('/api/boodschappen').then(function(r){return r.json();}).then(function(d) { showBoodschappen(d); }).catch(function(){});
}
function boodPost(action, body, done) {
  fetch('/api/boodschappen/' + action, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)})
    .then(function(r){return r.json();}).then(function(d) {
      // ook bij een fout komt de lijst mee terug: iemand anders kan hem net hebben aangepast
      if (!d.ok) { showBoodschappen(d.items ? d : boodData, d.error || 'Opslaan mislukt'); return; }
      showBoodschappen(d);
      if (done) done();
    }).catch(function() { showBoodschappen(boodData, 'Verbindingsfout'); });
}
function boodAdd() {
  var input = document.getElementById('blk-bood-input');
  if (!input || !input.value.trim()) return;
  boodPost('add', { text: input.value }, function() { input.value = ''; input.focus(); });
}
function boodCheck(id, done) {
  // het vinkje staat er meteen; het antwoord van de server zet de lijst daarna goed
  var item = boodData && boodData.items.filter(function(x) { return x.id === id; })[0];
  if (item) { item.done = done; showBoodschappen(boodData); }
  boodPost('check', { id: id, done: done });
}
// wat de anderen toevoegen of afvinken komt vanzelf binnen zolang Home open staat
setInterval(function() { if (currentScreen === 0 && !document.hidden) loadBoodschappen(); }, 30000);

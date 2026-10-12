// ── Boodschappen ──
// Blok op Home: de gezamenlijke boodschappenlijst. Typ wat er gehaald moet worden (meer dingen tegelijk kan met
// komma's ertussen) of tik op een van de voorstellen: dat zijn de dingen die het vaakst op de lijst stonden.
// Achter elk ding staat de profielfoto van wie het erop zette. In de winkel tik je op een regel om hem af te vinken;
// die zakt dan naar "In de kar". Daar tik je hem zo weer terug als het per ongeluk was, en met "Opruimen" is alles
// wat is afgevinkt weg (na een dag gebeurt dat vanzelf).
var boodData = null;
function boodFace(item, users) {
  var u = users.filter(function(x) { return x.id === item.by; })[0];
  var name = u ? u.name : item.byName || 'Onbekend';
  return '<span class="bood-by" title="Toegevoegd door ' + escHtml(name) + '">' +
    (u && u.photo ? '<img src="' + userPhotoUrl(u) + '" alt="">' : '<b>' + escHtml(name.charAt(0).toUpperCase()) + '</b>') + '</span>';
}
function boodRow(x, d) {
  var who = d.users.filter(function(u) { return u.id === x.by; })[0];
  var inner = '<span class="bood-check"><i class="fa-solid fa-check"></i></span>' +
    '<span class="bood-text"><span>' + escHtml(x.text) + '</span><small>' + escHtml(who ? who.name : x.byName || 'Onbekend') + ' · ' + shortWhen(x.at) + '</small></span>' + boodFace(x, d.users);
  // wie alleen kijkt (een gast) krijgt dezelfde regel zonder knop
  return d.me ? '<button class="bood-row' + (x.done ? ' done' : '') + '" role="checkbox" aria-checked="' + !!x.done + '" onclick="boodCheck(\'' + x.id + '\',' + !x.done + ')">' + inner + '</button>' :
    '<div class="bood-row' + (x.done ? ' done' : '') + '">' + inner + '</div>';
}
function showBoodschappen(d, error) {
  var el = document.getElementById('blk-bood-list'), count = document.getElementById('blk-bood-count'), form = document.getElementById('blk-bood-form');
  if (!el || !d) return;
  boodData = d;
  var open = d.items.filter(function(x) { return !x.done; }), done = d.items.filter(function(x) { return x.done; });
  if (count) count.textContent = d.users.length && open.length ? open.length + ' te halen' : '';
  if (form) form.hidden = !d.me;
  if (!d.users.length) { el.innerHTML = '<div class="afval-empty">Voor de boodschappenlijst heeft iedereen een eigen account nodig<button class="btn btn-ghost" onclick="showScreen(5,null)">Gebruikers aanmaken</button></div>'; return; }
  var chips = d.me && d.suggestions && d.suggestions.length ? '<div class="bood-chips" aria-label="Vaak gehaald">' + d.suggestions.map(function(t, i) {
    return '<button class="bood-chip" onclick="boodSuggest(' + i + ')"><i class="fa-solid fa-plus"></i>' + escHtml(t) + '</button>';
  }).join('') + '</div>' : '';
  el.innerHTML = (error ? '<div class="outage-sub c-red" role="alert">' + escHtml(error) + '</div>' : '') + chips +
    (open.length ? open.map(function(x) { return boodRow(x, d); }).join('') :
      '<div class="bood-empty"><i class="fa-solid fa-basket-shopping"></i><span>' + (done.length ? 'Alles is gehaald' : 'De lijst is leeg') + '</span></div>') +
    (done.length ? '<div class="bood-done-head"><span>In de kar (' + done.length + ')</span>' + (d.me ? '<button class="presence-remove" onclick="boodPost(\'clear\',{})">Opruimen</button>' : '') + '</div>' +
      done.map(function(x) { return boodRow(x, d); }).join('') : '');
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
  // het veld blijft actief, zodat je meteen het volgende kunt typen
  boodPost('add', { text: input.value }, function() { input.value = ''; input.focus(); });
}
function boodSuggest(i) {
  if (boodData && boodData.suggestions[i]) boodPost('add', { text: boodData.suggestions[i] });
}
function boodCheck(id, done) {
  // het vinkje staat er meteen; het antwoord van de server zet de lijst daarna goed
  var item = boodData && boodData.items.filter(function(x) { return x.id === id; })[0];
  if (item) { item.done = done; item.doneAt = Date.now(); showBoodschappen(boodData); }
  boodPost('check', { id: id, done: done });
}
// wat de anderen toevoegen of afvinken komt vanzelf binnen zolang Home open staat
setInterval(function() { if (currentScreen === 0 && !document.hidden) loadBoodschappen(); }, 30000);

// ── Eetpoll ──
// Blok op Home: wie eet welke dag mee. Elke maandag om 08:00 begint de server een nieuwe week.
// Het stemmen is bewust simpel: tik op je bolletje op de dagen dat je mee-eet, en anders niet.
// Bovenaan staat vandaag, want dat is wat de kok wil weten: hoeveel er mee-eten en wie. Daaronder de hele week als
// tabel: een kolom per huisgenoot (altijd op dezelfde plek) en een rij per dag.
var EET_DAYS = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'];
var EET_DAYS_LONG = ['Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag', 'Zondag'];
var EET_MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
var eetData = null;
function eetDate(date) { return +date.slice(8, 10) + ' ' + EET_MONTHS[+date.slice(5, 7) - 1]; }
function eetAvatar(u) {
  return u.photo ? '<img src="' + userPhotoUrl(u) + '" alt="">' : '<b>' + escHtml(u.name.charAt(0).toUpperCase()) + '</b>';
}
// Vandaag: het aantal eters groot, en wie dat zijn met foto
function eetTodayHtml(d, i) {
  var eaters = d.users.filter(function(u) { return d.votes[u.id][i]; }), n = eaters.length;
  return '<div class="eet-today"><div class="eet-today-head"><span class="eet-today-n">' + n + '</span><div><b>' + (n === 1 ? 'eet vandaag mee' : 'eten vandaag mee') + '</b>' +
    '<span>' + EET_DAYS_LONG[i] + ' ' + eetDate(d.days[i].date) + '</span></div>' +
    '<div class="eet-today-faces">' + eaters.map(function(u) { return '<span class="eet-face" title="' + escHtml(u.name) + ' eet mee">' + eetAvatar(u) + '</span>'; }).join('') + '</div></div></div>';
}
function showEetpoll(d, error) {
  var el = document.getElementById('blk-eetpoll'), week = document.getElementById('blk-eetpoll-week');
  if (!el || !d) return;
  eetData = d;
  if (week) week.textContent = eetDate(d.days[0].date) + ' – ' + eetDate(d.days[6].date);
  if (!d.users.length) { el.innerHTML = '<div class="afval-empty">Voor de eetpoll heeft iedereen een eigen account nodig<button class="btn btn-ghost" onclick="showScreen(5,null)">Gebruikers aanmaken</button></div>'; return; }
  var today = -1;
  d.days.forEach(function(day, i) { if (day.today) today = i; });
  var html = error ? '<div class="outage-sub c-red">' + escHtml(error) + '</div>' : '';
  html += today !== -1 ? eetTodayHtml(d, today) : '<div class="eet-today-rest"><span><i class="fa-regular fa-clock"></i>Deze week is voorbij. Maandag om 08:00 gaat de nieuwe poll open.</span></div>';
  html += '<div class="eet-scroll"><table class="eet-table"><thead><tr><th></th>' + d.users.map(function(u) {
    return '<th scope="col"' + (u.id === d.me ? ' class="me"' : '') + '><span class="eet-face">' + eetAvatar(u) + '</span><span class="eet-name">' + (u.id === d.me ? 'Jij' : escHtml(u.name)) + '</span></th>';
  }).join('') + '<th scope="col" class="eet-count" title="Aantal dat mee-eet"><i class="fa-solid fa-utensils"></i></th></tr></thead><tbody>' +
  d.days.map(function(day, i) {
    var n = 0;
    var cells = d.users.map(function(u) {
      var eats = d.votes[u.id][i], mine = u.id === d.me;
      if (eats) n++;
      var mark = eats ? '<i class="fa-solid fa-check"></i>' : '';
      return '<td' + (mine ? ' class="me"' : '') + '>' + (mine && !day.past ?
        '<button class="eet-mark' + (eats ? ' yes' : '') + '" role="checkbox" aria-checked="' + eats + '" aria-label="Ik eet ' + EET_DAYS_LONG[i].toLowerCase() + ' mee" onclick="eetToggle(' + i + ')">' + mark + '</button>' :
        '<span class="eet-mark' + (eats ? ' yes' : '') + '" title="' + escHtml(u.name + (eats ? ' eet mee' : ' eet niet mee')) + '">' + mark + '<span class="sr-only">' + (eats ? 'eet mee' : 'eet niet mee') + '</span></span>') + '</td>';
    }).join('');
    return '<tr class="' + (day.past ? 'past' : '') + (day.today ? ' today' : '') + '"><th scope="row"><b>' + EET_DAYS[i] + '</b><span>' + (day.today ? 'vandaag' : eetDate(day.date)) + '</span></th>' + cells + '<td class="eet-count">' + n + '</td></tr>';
  }).join('') + '</tbody></table></div>';
  if (d.me) html += '<div class="eet-hint">Tik op je bolletje op de dagen dat je mee-eet.</div>';
  el.innerHTML = html;
}
function loadEetpoll() {
  if (!moduleOn('eetpoll') || !document.getElementById('blk-eetpoll')) return;
  fetch('/api/eetpoll').then(function(r){return r.json();}).then(function(d) { showEetpoll(d); }).catch(function(){});
}
// Je bolletje aan of uit; het scherm loopt alvast vooruit op het antwoord van de server
function eetToggle(day) {
  if (!eetData || !eetData.me) return;
  var mine = eetData.votes[eetData.me], eat = !mine[day];
  mine[day] = eat;
  showEetpoll(eetData);
  fetch('/api/eetpoll/vote', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ day: day, eat: eat })})
    .then(function(r){return r.json();}).then(function(d) {
      if (d.ok) return showEetpoll(d);
      mine[day] = !eat;
      showEetpoll(eetData, d.error || 'Opslaan mislukt');
    }).catch(function() { mine[day] = !eat; showEetpoll(eetData, 'Verbindingsfout'); });
}
// de keuzes van de anderen komen vanzelf binnen zolang Home open staat
setInterval(function() { if (currentScreen === 0 && !document.hidden) loadEetpoll(); }, 30000);

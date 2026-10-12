// ── Eetpoll ──
// Blok op Home: wie eet welke dag mee. Elke maandag om 08:00 begint de server een nieuwe week. Per dag staan de
// profielfoto's van iedereen: gekleurd met een groen vinkje wie mee-eet, grijs met een kruisje wie niet, en vaag
// wie nog niet gekozen heeft. Met de twee knoppen kies je zelf; nog een keer tikken haalt je keuze weer weg.
var EET_DAYS = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'];
var EET_MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
var eetData = null;
function eetDate(date) { return +date.slice(8, 10) + ' ' + EET_MONTHS[+date.slice(5, 7) - 1]; }
function eetFace(u, state) {
  var what = state === 'yes' ? ' eet mee' : state === 'no' ? ' eet niet mee' : ' heeft nog niet gekozen';
  return '<span class="eet-face ' + state + '" title="' + escHtml(u.name + what) + '">' +
    (u.photo ? '<img src="' + userPhotoUrl(u) + '" alt="">' : '<b>' + escHtml(u.name.charAt(0).toUpperCase()) + '</b>') +
    (state === 'open' ? '' : '<i class="fa-solid ' + (state === 'yes' ? 'fa-check' : 'fa-xmark') + '"></i>') +
    '<span class="sr-only">' + escHtml(u.name + what) + '</span></span>';
}
function showEetpoll(d, error) {
  var el = document.getElementById('blk-eetpoll'), week = document.getElementById('blk-eetpoll-week');
  if (!el || !d) return;
  eetData = d;
  if (week) week.textContent = eetDate(d.days[0].date) + ' – ' + eetDate(d.days[6].date);
  if (!d.users.length) { el.innerHTML = '<div class="afval-empty">Voor de eetpoll heeft iedereen een eigen account nodig<button class="btn btn-ghost" onclick="showScreen(5,null)">Gebruikers aanmaken</button></div>'; return; }
  el.innerHTML = (error ? '<div class="outage-sub c-red">' + escHtml(error) + '</div>' : '') + d.days.map(function(day, i) {
    var groups = { yes: [], open: [], no: [] };
    d.users.forEach(function(u) { var v = d.votes[u.id][i]; groups[v === true ? 'yes' : v === false ? 'no' : 'open'].push(u); });
    var mine = d.me ? d.votes[d.me][i] : null, n = groups.yes.length;
    return '<div class="eet-row' + (day.past ? ' past' : '') + (day.today ? ' today' : '') + '">' +
      '<div class="eet-day"><b>' + EET_DAYS[i] + '</b><span>' + (day.today ? 'vandaag' : eetDate(day.date)) + '</span></div>' +
      '<div class="eet-faces">' + ['yes', 'open', 'no'].map(function(s) { return groups[s].map(function(u) { return eetFace(u, s); }).join(''); }).join('') + '</div>' +
      '<div class="eet-count" title="' + n + (n === 1 ? ' eet' : ' eten') + ' mee"><i class="fa-solid fa-utensils"></i>' + n + '</div>' +
      (d.me ? '<div class="eet-vote">' +
        '<button class="eet-btn yes' + (mine === true ? ' on' : '') + '" aria-pressed="' + (mine === true) + '" aria-label="Ik eet ' + EET_DAYS[i] + ' mee"' + (day.past ? ' disabled' : '') + ' onclick="eetVote(' + i + ',true)"><i class="fa-solid fa-check"></i></button>' +
        '<button class="eet-btn no' + (mine === false ? ' on' : '') + '" aria-pressed="' + (mine === false) + '" aria-label="Ik eet ' + EET_DAYS[i] + ' niet mee"' + (day.past ? ' disabled' : '') + ' onclick="eetVote(' + i + ',false)"><i class="fa-solid fa-xmark"></i></button></div>' : '') +
      '</div>';
  }).join('');
}
function loadEetpoll() {
  if (!moduleOn('eetpoll') || !document.getElementById('blk-eetpoll')) return;
  fetch('/api/eetpoll').then(function(r){return r.json();}).then(function(d) { showEetpoll(d); }).catch(function(){});
}
function eetVote(day, eat) {
  if (!eetData || !eetData.me) return;
  // dezelfde knop nog een keer haalt de keuze weg; het scherm loopt alvast vooruit op het antwoord
  if (eetData.votes[eetData.me][day] === eat) eat = null;
  var before = eetData.votes[eetData.me][day];
  eetData.votes[eetData.me][day] = eat;
  showEetpoll(eetData);
  fetch('/api/eetpoll/vote', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ day: day, eat: eat })})
    .then(function(r){return r.json();}).then(function(d) {
      if (d.ok) return showEetpoll(d);
      eetData.votes[eetData.me][day] = before;
      showEetpoll(eetData, d.error || 'Opslaan mislukt');
    }).catch(function() { eetData.votes[eetData.me][day] = before; showEetpoll(eetData, 'Verbindingsfout'); });
}
// de keuzes van de anderen komen vanzelf binnen zolang Home open staat
setInterval(function() { if (currentScreen === 0 && !document.hidden) loadEetpoll(); }, 30000);

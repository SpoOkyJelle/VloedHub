// ── Weerwaarschuwingen ──
function loadWarnings() {
  var el = document.getElementById('weather-warnings');
  if (!el) return;
  fetch('/api/warnings').then(function(r){return r.json();}).then(function(d) {
    var list = (d && d.warnings) || [];
    if (!list.length) { el.hidden = true; el.innerHTML = ''; return; }
    function t(iso) { var x = new Date(iso); return isNaN(x.getTime()) ? '' : x.toLocaleString('nl-NL', {weekday:'short', hour:'2-digit', minute:'2-digit', hour12:false}); }
    el.innerHTML = list.map(function(w) {
      var period = w.from ? t(w.from) + (w.until ? ' tot ' + t(w.until) : '') : '';
      return '<div class="wx-warning wx-' + w.code + '" title="' + escHtml(w.description) + '"><i class="fa-solid fa-triangle-exclamation"></i>' +
        '<span><strong>Code ' + w.code + '</strong> · ' + escHtml(w.type) + (period ? ' · ' + period : '') + '</span></div>';
    }).join('');
    el.hidden = false;
  }).catch(function(){});
}
loadWarnings();
setInterval(loadWarnings, 15 * 60 * 1000);

// ── Stroomstoringen ──
// ── Meldingen ──
var MELDING_ICONS = { weer:'fa-cloud-bolt', storing:'fa-bolt', apparaat:'fa-plug-circle-xmark', wasmachine:'fa-shirt', vaatwasser:'fa-sink', afval:'fa-trash-can', deurbel:'fa-bell', nlalert:'fa-tower-broadcast', p2000:'fa-truck-medical', ziggo:'fa-wifi', flow:'fa-diagram-project', systeem:'fa-server' };
var meldingenAll = false, meldingenClearArmed = false;
// Een bericht is opgemaakt voor Discord ("⚠️ **Titel** — rest"): hier wordt dat een titel, een ondertitel en eventueel een link
function meldingParts(msg) {
  var url = (msg.match(/https?:\/\/\S+/) || [null])[0];
  var text = (url ? msg.replace(url, '') : msg).replace(/^[^A-Za-z0-9\u00C0-\u00FF*]+/, '').replace(/~~|`/g, '');
  var m = text.match(/^\*\*([\s\S]+?)\*\*([\s\S]*)$/);
  var title = m ? m[1] : text.split('\n')[0];
  var rest = (m ? m[2] : text.split('\n').slice(1).join('\n')).replace(/\*\*/g, '').replace(/^[\s\u2014\-]+/, '').trim();
  return { title: title.trim(), sub: rest, url: url };
}
function renderMeldingen(el, rows, inPanel) {
  var shown = inPanel || meldingenAll ? rows : rows.slice(0, 5);
  function line(icon, title, sub, when, url, cls) {
    return '<div class="outage-line ' + cls + '"><i class="fa-solid ' + (MELDING_ICONS[icon] || 'fa-bell') + '"></i><div><div class="outage-text">' + escHtml(title) + '</div>' +
      (sub ? '<div class="outage-sub meld-sub">' + escHtml(sub) + '</div>' : '') + '</div><span class="meld-time">' + when + '</span>' +
      (url ? '<a href="' + escHtml(url) + '" target="_blank" rel="noopener" class="outage-link" aria-label="Meer informatie"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>' : '') + '</div>';
  }
  var html = '<div class="meld-head"><span class="section-title">Meldingen</span><span class="meld-actions">' +
    (rows.length > 5 && !inPanel ? '<button onclick="toggleMeldingen()">' + (meldingenAll ? 'Minder' : 'Alles') + '</button>' : '') +
    (rows.length ? '<button onclick="clearMeldingen(this)">Wissen</button>' : '') + '</span></div>';
  meldingenActive.forEach(function(x) { html += line(x.category, x.title, x.sub, 'nu', x.url, 'warn meld-active'); });
  if (!rows.length && !meldingenActive.length) html += '<div class="outage-line muted"><i class="fa-solid fa-bell-slash"></i><div><div class="outage-text">Nog geen meldingen</div><div class="outage-sub">Weerwaarschuwingen, storingen, apparaten, wasmachine, vaatwasser en flows verschijnen hier</div></div></div>';
  shown.forEach(function(r) {
    var p = meldingParts(r.message);
    html += line(r.category, p.title, p.sub, shortWhen(r.created_at), p.url, r.id > meldingenSeen ? 'meld-new' : '');
  });
  el.innerHTML = html;
}
// Tot welke melding je het paneel hebt gezien; alles daarna telt mee in het bolletje op de bel
var meldingenSeen = 0, meldingenRows = [], meldingenActive = [];
try { meldingenSeen = parseInt(localStorage.getItem('meldingenSeen'), 10) || 0; } catch (e) {}
function meldPanelOpen() { return document.getElementById('meld-panel').classList.contains('open'); }
function showMeldBadge() {
  var unread = meldingenRows.filter(function(r) { return r.id > meldingenSeen; }).length;
  document.querySelectorAll('.meld-badge').forEach(function(b) { b.textContent = unread > 9 ? '9+' : unread; b.classList.toggle('show', unread > 0); });
  document.querySelectorAll('.meld-bell').forEach(function(b) { b.classList.toggle('has-active', meldingenActive.length > 0); });
}
function loadMeldingen() {
  Promise.all([
    fetch('/api/meldingen?limit=50').then(function(r){return r.json();}),
    fetch('/api/meldingen/actief').then(function(r){return r.json();}).catch(function(){ return []; })
  ]).then(function(res) {
    var rows = res[0];
    meldingenRows = rows;
    meldingenActive = Array.isArray(res[1]) ? res[1] : [];
    meldingenClearArmed = false;
    var blk = document.getElementById('blk-meldingen');
    if (blk) renderMeldingen(blk, rows, false);
    if (meldPanelOpen()) renderMeldingen(document.getElementById('meld-panel'), rows, true);
    showMeldBadge();
  }).catch(function(){});
}
function toggleMeldPanel(e) {
  e.stopPropagation();
  var panel = document.getElementById('meld-panel');
  if (meldPanelOpen()) return closeMeldPanel();
  // breed scherm: de bel zit in de zijbalk, het paneel klapt ernaast uit
  var r = e.currentTarget.getBoundingClientRect();
  if (window.innerWidth >= 720) { panel.style.left = (r.right + 8) + 'px'; panel.style.right = 'auto'; panel.style.top = Math.max(8, Math.min(r.top, window.innerHeight * 0.3 - 8)) + 'px'; }
  else { panel.style.left = ''; panel.style.right = ''; panel.style.top = ''; }
  renderMeldingen(panel, meldingenRows, true);
  panel.classList.add('open');
  loadMeldingen();
}
function closeMeldPanel() {
  if (!meldPanelOpen()) return;
  document.getElementById('meld-panel').classList.remove('open');
  // bij het sluiten geldt alles als gezien
  if (meldingenRows.length) { meldingenSeen = meldingenRows[0].id; try { localStorage.setItem('meldingenSeen', meldingenSeen); } catch (e) {} }
  showMeldBadge();
}
document.addEventListener('click', function(e) { if (meldPanelOpen() && !e.target.closest('#meld-panel')) closeMeldPanel(); });
document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeMeldPanel(); });
function toggleMeldingen() { meldingenAll = !meldingenAll; loadMeldingen(); }
// Wissen vraagt een tweede tik ter bevestiging
function clearMeldingen(btn) {
  if (!meldingenClearArmed) { meldingenClearArmed = true; btn.textContent = 'Zeker weten?'; setTimeout(function() { if (meldingenClearArmed) { meldingenClearArmed = false; btn.textContent = 'Wissen'; } }, 4000); return; }
  fetch('/api/meldingen/clear', {method:'POST'}).then(function() { meldingenAll = false; loadMeldingen(); }).catch(actionFailed('Meldingen wissen lukte niet'));
}
loadMeldingen();
setInterval(loadMeldingen, 60000);

function loadOutages() {
  fetch('/api/outages').then(function(r){return r.json();}).then(function(d) {
    var el = document.getElementById('blk-outages');
    if (!el) return;
    el.className = 'card outage-card';
    function line(icon, text, sub, cls, url) {
      return '<div class="outage-line ' + (cls || '') + '"><i class="fa-solid ' + icon + '"></i><div><div class="outage-text">' + text + '</div>' + (sub ? '<div class="outage-sub">' + sub + '</div>' : '') + '</div>' +
        (url ? '<a href="' + url + '" target="_blank" rel="noopener" class="outage-link" aria-label="Meer informatie bij Enexis"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>' : '') + '</div>';
    }
    if (!d.ok) { el.innerHTML = line('fa-plug-circle-xmark', escHtml(d.error || 'Storingen niet beschikbaar'), '', 'muted'); return; }
    if (!d.postcode) { el.innerHTML = line('fa-plug-circle-bolt', 'Stroomstoringen', 'Vul je adres in bij Instellingen (Afvalkalender) om storingen op je postcode te zien', 'muted'); return; }
    var html = '';
    d.mine.filter(function(e) { return !e.planned; }).forEach(function(e) {
      html += line('fa-bolt', escHtml(e.kind) + ' op ' + d.postcode, escHtml(e.status || '') + (e.when ? ' · ' + escHtml((e.whenLabel || 'Tijd') + ': ' + e.when) : ''), 'bad', e.url);
    });
    d.mine.filter(function(e) { return e.planned; }).forEach(function(e) {
      html += line('fa-calendar-day', 'Geplande ' + escHtml(e.kind.toLowerCase()) + ' op ' + d.postcode, escHtml(e.when || ''), 'warn', e.url);
    });
    d.nearby.forEach(function(e) {
      html += line(e.planned ? 'fa-calendar-day' : 'fa-bolt', (e.planned ? 'Geplande ' + escHtml(e.kind.toLowerCase()) : escHtml(e.kind)) + ' in de buurt', escHtml([e.status, e.when, e.postcodeText].filter(Boolean).join(' · ')), 'muted', e.url);
    });
    if (d.mine.some(function(e) { return !e.planned; })) el.className += ' has-outage';
    el.innerHTML = html || line('fa-circle-check', 'Geen storingen op ' + d.postcode, 'Enexis · elke 10 minuten bijgewerkt', 'good');
  }).catch(function(){});
}


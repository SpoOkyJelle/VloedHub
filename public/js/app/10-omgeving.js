// ── Omgeving: regen, files en 112-meldingen ──
// Elk een blok op Home; de server haalt de gegevens op en bewaart ze een paar minuten.
function envLine(icon, text, sub, cls, right, url) {
  return '<div class="outage-line ' + (cls || '') + '"><i class="fa-solid ' + icon + '"></i><div><div class="outage-text">' + text + '</div>' +
    (sub ? '<div class="outage-sub">' + sub + '</div>' : '') + '</div>' + (right ? '<span class="meld-time">' + right + '</span>' : '') +
    (url ? '<a href="' + escHtml(url) + '" target="_blank" rel="noopener" class="outage-link" aria-label="Meer informatie"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>' : '') + '</div>';
}
function envHead(title, right) {
  return '<div class="meld-head"><span class="section-title">' + title + '</span>' + (right ? '<span class="meld-time">' + right + '</span>' : '') + '</div>';
}

// ── Regen ──
// Staafjes per vijf minuten; de hoogte loopt af naar boven toe, zodat motregen zichtbaar blijft naast een bui
var RAIN_FULL = 10; // mm per uur waarbij een staafje vol is
function rainStrength(mm) { return mm >= 5 ? 'Zware regen' : mm >= 1 ? 'Regen' : 'Lichte regen'; }
function loadRain() {
  fetch('/api/rain').then(function(r){return r.json();}).then(function(d) {
    var el = document.getElementById('blk-rain');
    if (!el) return;
    if (!d.ok) { el.innerHTML = envHead('Regen') + envLine('fa-cloud-rain', escHtml(d.error || 'Regenverwachting niet beschikbaar'), '', 'muted'); return; }
    var last = d.points[d.points.length - 1].time, icon, text, sub, cls;
    if (d.raining) {
      icon = 'fa-cloud-showers-heavy'; cls = 'rain';
      text = d.until ? 'Het regent tot ' + d.until : 'Het blijft regenen';
      sub = d.until ? '' : 'Tot minstens ' + last;
    } else if (d.from) {
      icon = 'fa-cloud-rain'; cls = d.in_min <= 30 ? 'warn' : 'rain';
      text = rainStrength(d.max_mm) + ' vanaf ' + d.from;
      sub = 'Over ' + d.in_min + ' minuten';
    } else {
      icon = 'fa-sun'; cls = 'good';
      text = 'Droog tot minstens ' + last;
      sub = '';
    }
    var bars = d.points.map(function(p) {
      var h = p.mm > 0 ? Math.max(8, Math.min(100, Math.sqrt(p.mm / RAIN_FULL) * 100)) : 0;
      return '<span title="' + p.time + ' · ' + nlNum(p.mm, 1) + ' mm/u"><i style="height:' + h + '%"></i></span>';
    }).join('');
    el.innerHTML = envHead('Regen', 'Buienradar') + envLine(icon, text, sub, cls) +
      '<div class="rain-bars">' + bars + '</div>' +
      '<div class="rain-axis"><span>' + d.points[0].time + '</span><span>' + d.points[Math.floor(d.points.length / 2)].time + '</span><span>' + last + '</span></div>';
  }).catch(function(){});
}

// ── Files ──
var TRAFFIC_MAX = 5;
function loadTraffic() {
  fetch('/api/traffic').then(function(r){return r.json();}).then(function(d) {
    var el = document.getElementById('blk-traffic');
    if (!el) return;
    if (!d.ok) { el.innerHTML = envHead('Files') + envLine('fa-road-circle-xmark', escHtml(d.error || 'Files niet beschikbaar'), '', 'muted'); return; }
    function where(o) { return escHtml([o.direction.replace(' - ', ' → '), o.location.replace(/\.$/, '')].filter(Boolean).join(' · ')); }
    var html = '', rows = 0, total = 0;
    d.jams.forEach(function(j) {
      total += j.delay_min;
      if (rows++ >= TRAFFIC_MAX) return;
      html += envLine('fa-car-side', '<span class="road-nr">' + escHtml(j.road) + '</span>' + escHtml(j.title), where(j), j.delay_min >= 20 ? 'bad' : j.delay_min >= 10 ? 'warn' : '',
        (j.delay_min ? '+' + j.delay_min + ' min' : '') + (j.length_km ? ' · ' + nlNum(j.length_km, 0) + ' km' : ''));
    });
    d.other.forEach(function(o) {
      if (rows++ >= TRAFFIC_MAX) return;
      html += envLine(o.works ? 'fa-person-digging' : 'fa-road-barrier', '<span class="road-nr">' + escHtml(o.road) + '</span>' + escHtml(o.title), where(o), 'muted');
    });
    if (rows > TRAFFIC_MAX) html += '<div class="outage-sub env-more">en nog ' + (rows - TRAFFIC_MAX) + ' meer</div>';
    el.innerHTML = envHead('Files in de buurt', d.jams.length ? d.jams.length + (d.jams.length === 1 ? ' file' : ' files') + ' · ' + total + ' min' : '') +
      (html || envLine('fa-circle-check', 'Geen files in de buurt', 'Rijkswaterstaat · binnen 30 km', 'good'));
  }).catch(function(){});
}

// ── 112-meldingen ──
// Alleen oproepen met een adres; de vele ambulanceritten zonder adres ("naar Breda") tellen alleen mee in de kop
var P2000_ICONS = { ambulance:'fa-truck-medical', brandweer:'fa-fire-extinguisher', politie:'fa-shield-halved', heli:'fa-helicopter', overig:'fa-tower-broadcast' };
var P2000_MAX = 5;
function loadP2000() {
  fetch('/api/p2000').then(function(r){return r.json();}).then(function(d) {
    var el = document.getElementById('blk-p2000');
    if (!el) return;
    if (!d.ok) { el.innerHTML = envHead('112-meldingen') + envLine('fa-tower-broadcast', escHtml(d.error || '112-meldingen niet beschikbaar'), '', 'muted'); return; }
    var day = Date.now() - 24 * 3600 * 1000;
    var recent = d.calls.filter(function(c) { return c.at && Date.parse(c.at) > day; });
    var shown = d.calls.filter(function(c) { return c.located || c.own_street; }).slice(0, P2000_MAX);
    var html = shown.map(function(c) {
      return envLine(P2000_ICONS[c.kind] || P2000_ICONS.overig, escHtml(c.text), c.own_street ? 'In jouw straat' : '', c.own_street ? 'bad' : '', c.at ? shortWhen(c.at) : '', c.url);
    }).join('');
    el.className = 'card outage-card' + (shown.some(function(c) { return c.own_street && Date.parse(c.at) > Date.now() - 3600 * 1000; }) ? ' has-outage' : '');
    el.innerHTML = envHead('112-meldingen ' + escHtml(d.place.charAt(0).toUpperCase() + d.place.slice(1)), recent.length + (recent.length === d.calls.length ? '+' : '') + ' in 24 uur') +
      (html || envLine('fa-circle-check', 'Geen oproepen met een adres', '', 'good'));
  }).catch(function(){});
}

// ── Internetstoringen (Ziggo) ──
function loadZiggo() {
  fetch('/api/ziggo').then(function(r){return r.json();}).then(function(d) {
    var el = document.getElementById('blk-ziggo');
    if (!el) return;
    el.className = 'card outage-card';
    if (!d.ok) { el.innerHTML = envHead('Internetstoringen') + envLine('fa-wifi', escHtml(d.error || 'Ziggo niet beschikbaar'), '', 'muted'); return; }
    if (!d.address) { el.innerHTML = envHead('Internetstoringen') + envLine('fa-wifi', 'Ziggo-storingen', 'Vul je adres in bij Instellingen (Afvalkalender) om storingen op je adres te zien', 'muted'); return; }
    var html = '';
    d.outages.forEach(function(o) {
      html += envLine('fa-wifi', 'Storing: ' + escHtml(o.title), escHtml([o.from ? 'Sinds ' + o.from : '', o.expected ? 'verwacht opgelost ' + o.expected : o.status].filter(Boolean).join(' · ')), 'bad');
    });
    d.maintenance.forEach(function(m) {
      html += envLine('fa-screwdriver-wrench', escHtml(m.title), escHtml((m.from || '') + (m.until ? ' tot ' + m.until : '')), 'warn');
    });
    if (d.outages.length) el.className += ' has-outage';
    el.innerHTML = envHead('Internetstoringen', 'Ziggo') + (html || envLine('fa-circle-check', 'Geen storingen op ' + escHtml(d.address), 'Elke 10 minuten bijgewerkt', 'good'));
  }).catch(function(){});
}

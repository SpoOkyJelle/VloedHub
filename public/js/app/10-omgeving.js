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
// Wat er over de regen te zeggen valt: een regel tekst en de staafjes
function rainView(d) {
  var last = d.points[d.points.length - 1].time, v = {};
  if (d.raining) {
    v.icon = 'fa-cloud-showers-heavy'; v.cls = 'rain';
    v.text = d.until ? 'Het regent tot ' + d.until : 'Het blijft regenen';
    v.sub = d.until ? '' : 'Tot minstens ' + last;
  } else if (d.from) {
    v.icon = 'fa-cloud-rain'; v.cls = d.in_min <= 30 ? 'warn' : 'rain';
    v.text = rainStrength(d.max_mm) + ' vanaf ' + d.from;
    v.sub = 'Over ' + d.in_min + ' minuten';
  } else {
    v.icon = 'fa-sun'; v.cls = 'good';
    v.text = 'Droog tot minstens ' + last;
    v.sub = '';
  }
  v.bars = '<div class="rain-bars">' + d.points.map(function(p) {
    var h = p.mm > 0 ? Math.max(8, Math.min(100, Math.sqrt(p.mm / RAIN_FULL) * 100)) : 0;
    return '<span title="' + p.time + ' · ' + nlNum(p.mm, 1) + ' mm/u"><i style="height:' + h + '%"></i></span>';
  }).join('') + '</div>' +
    '<div class="rain-axis"><span>' + d.points[0].time + '</span><span>' + d.points[Math.floor(d.points.length / 2)].time + '</span><span>' + last + '</span></div>';
  return v;
}
// De verwachting staat als uitklapdeel in de weerkaart, en in het losse blok als dat op Home is gezet
function loadRain() {
  if (!moduleOn('regen')) return;
  fetch('/api/rain').then(function(r){return r.json();}).then(function(d) {
    var el = document.getElementById('blk-rain'), v = d.ok ? rainView(d) : null;
    if (el) el.innerHTML = v ? envHead('Regen', 'Buienradar') + envLine(v.icon, v.text, v.sub, v.cls) + v.bars :
      envHead('Regen') + envLine('fa-cloud-rain', escHtml(d.error || 'Regenverwachting niet beschikbaar'), '', 'muted');
    var icon = document.getElementById('wx-rain-icon');
    if (!icon) return;
    icon.className = 'fa-solid ' + (v ? v.icon + ' ' + v.cls : 'fa-cloud-rain');
    setEl('wx-rain-summary', v ? v.text + (v.sub ? ' · ' + v.sub.toLowerCase() : '') : escHtml(d.error || 'Regenverwachting niet beschikbaar'));
    setEl('wx-rain-detail', v ? v.bars + '<div class="rain-source">Buienradar · neerslag per vijf minuten</div>' : '');
  }).catch(function(){});
}
function toggleWeatherRain() {
  var open = document.getElementById('wx-rain-fold').classList.toggle('open');
  var btn = document.querySelector('.wx-rain-toggle');
  btn.classList.toggle('open', open);
  btn.setAttribute('aria-expanded', open);
}
loadRain();
setInterval(loadRain, 5 * 60 * 1000);

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

// ── Status omgeving ──
// Eén blok in plaats van vier: per onderdeel een knop met de stand van zaken. Een tik klapt het bijbehorende
// blok eronder open, met dezelfde inhoud als wanneer het los op Home zou staan.
var STATUS_ITEMS = [
  {key:'outages', module:'storingen', label:'Stroom', icon:'fa-bolt', url:'/api/outages', sum:function(d) {
    if (!d.postcode) return {cls:'muted', text:'Geen adres'};
    if (d.mine.some(function(e) { return !e.planned; })) return {cls:'bad', text:'Storing'};
    if (d.nearby.length) return {cls:'warn', text:'Grote storing'};
    return d.mine.length ? {cls:'warn', text:'Gepland'} : {cls:'good', text:'Geen storing'};
  }},
  {key:'ziggo', module:'ziggo', label:'Internet', icon:'fa-wifi', url:'/api/ziggo', sum:function(d) {
    if (!d.address) return {cls:'muted', text:'Geen adres'};
    if (d.outages.length) return {cls:'bad', text:'Storing'};
    return d.maintenance.length ? {cls:'warn', text:'Onderhoud'} : {cls:'good', text:'Geen storing'};
  }},
  {key:'traffic', module:'files', label:'Files', icon:'fa-car-side', url:'/api/traffic', sum:function(d) {
    if (!d.jams.length) return {cls:'good', text:'Geen files'};
    var max = Math.max.apply(null, d.jams.map(function(j) { return j.delay_min; }));
    return {cls: max >= 15 ? 'warn' : '', text: d.jams.length + ' · tot +' + max + ' min'};
  }},
  {key:'p2000', module:'p2000', label:'112', icon:'fa-truck-medical', url:'/api/p2000', sum:function(d) {
    var hour = Date.now() - 3600 * 1000;
    var recent = d.calls.filter(function(c) { return c.at && Date.parse(c.at) > hour && (c.located || c.own_street); });
    if (recent.some(function(c) { return c.own_street; })) return {cls:'bad', text:'In jouw straat'};
    return recent.length ? {cls:'', text: recent.length + ' dit uur'} : {cls:'good', text:'Rustig'};
  }}
];
var statusOpen = null;
function loadStatus() {
  var items = STATUS_ITEMS.filter(function(it) { return moduleOn(it.module); });
  Promise.all(items.map(function(it) { return fetch(it.url).then(function(r){return r.json();}).catch(function(){ return null; }); })).then(function(res) {
    var chips = document.querySelector('#blk-status .status-chips');
    if (!chips) return;
    chips.innerHTML = items.map(function(it, n) {
      var s = res[n] && res[n].ok !== false ? it.sum(res[n]) : {cls:'muted', text:'Onbekend'};
      return '<button class="status-chip ' + s.cls + (statusOpen === it.key ? ' open' : '') + '" data-status="' + it.key + '" onclick="toggleStatus(\'' + it.key + '\')">' +
        '<i class="fa-solid ' + it.icon + '"></i><span><span class="status-label">' + it.label + '</span><span class="status-value">' + escHtml(s.text) + '</span></span></button>';
    }).join('') || '<span class="outage-sub">Zet een module aan bij Instellingen om hier de status te zien</span>';
    if (statusOpen && BLOCKS[statusOpen]) BLOCKS[statusOpen].refresh();
  });
}
var statusCloseTimer = null;
function toggleStatus(key) {
  var detail = document.querySelector('#blk-status .status-detail');
  if (!detail || layoutEditMode) return;
  statusOpen = statusOpen === key ? null : key;
  document.querySelectorAll('#blk-status .status-chip').forEach(function(c) { c.classList.toggle('open', c.dataset.status === statusOpen); });
  clearTimeout(statusCloseTimer);
  detail.parentNode.classList.toggle('open', !!statusOpen);
  // bij het sluiten blijft de inhoud staan tot het dichtklappen klaar is
  if (!statusOpen) { statusCloseTimer = setTimeout(function() { detail.innerHTML = ''; }, 320); return; }
  detail.innerHTML = '';
  BLOCKS[key].render(detail);
  BLOCKS[key].refresh();
}

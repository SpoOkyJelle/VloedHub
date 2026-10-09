// ── Feeststand ──
// Voor een avond met gasten (aan te zetten bij Instellingen > Algemeen). Zolang hij aan staat staat er een proostknop
// bij de scènes, verwelkomt de app wie aanbelt, en houdt de server bij hoe de avond verloopt. Elk open scherm vraagt
// de stand om de paar tellen na, zodat de wandtablet meedoet als iemand op zijn telefoon proost.
var PARTY_POLL = 4000, PARTY_FRESH = 12000;
var partyState = { on: false }, partySeen = null;   // partySeen: de momenten waar dit scherm al op gereageerd heeft

function partyApply(d) {
  var was = partyState.on;
  partyState = d;
  if (partySeen === null) partySeen = { proost: d.proost_at || 0, welcome: d.welcome_at || 0 };
  // alleen iets wat net gebeurd is krijgt confetti; een scherm dat later opent viert niet alsnog
  if (d.proost_at > partySeen.proost) { partySeen.proost = d.proost_at; if (d.now - d.proost_at < PARTY_FRESH) confetti('Proost!', 'fa-champagne-glasses'); }
  if (d.welcome_at > partySeen.welcome) { partySeen.welcome = d.welcome_at; if (d.now - d.welcome_at < PARTY_FRESH) confetti('Nieuwe gast!', 'fa-door-open'); }
  if (was !== d.on) renderScenes();
  var sw = document.getElementById('party-on');
  if (sw) { sw.classList.toggle('on', !!d.on); sw.setAttribute('aria-checked', !!d.on); }
}
function partySync() {
  if (document.hidden) return;
  fetch('/api/party').then(function(r){return r.json();}).then(partyApply).catch(function(){});
}
setInterval(partySync, PARTY_POLL);
document.addEventListener('DOMContentLoaded', partySync);

function toggleParty(btn) {
  var on = !btn.classList.contains('on');
  btn.disabled = true;
  fetch('/api/party', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({on: on})})
    .then(function(r){return r.json();}).then(function(d) {
      btn.disabled = false;
      if (!d.ok) { toast(d.error || 'Feeststand omzetten lukte niet', 'error'); return; }
      partyApply(d);
      loadPartyStats();
      toast(on ? 'Feeststand aan: veel plezier!' : 'Feeststand uit', 'ok');
    }).catch(function() { btn.disabled = false; toast('Feeststand omzetten lukte niet', 'error'); });
}

// De knop naast de scènes: alle ledstrips tien tellen op confetti, daarna terug naar hoe ze stonden
function proost(btn) {
  btn.disabled = true;
  fetch('/api/party/proost', {method:'POST'}).then(function(r){return r.json();}).then(function(d) {
    setTimeout(function() { btn.disabled = false; }, 1500);
    if (!d.ok) { toast('Proosten lukte niet', 'error'); return; }
    if (partySeen) partySeen.proost = d.proost_at;
    confetti('Proost!', 'fa-champagne-glasses');
    partyApply(d);
    // de lampen staan nu even anders, en straks weer terug
    lampsRefresh();
    setTimeout(lampsRefresh, 11000);
  }).catch(function() { btn.disabled = false; toast('Proosten lukte niet', 'error'); });
}

// ── Confetti ──
// Papiersnippers die van boven naar beneden dwarrelen, met een woord groot in beeld. Eén laag over alles heen
// (ook over het camerabeeld), die geen tikken afvangt en zichzelf opruimt.
var CONFETTI_COLORS = ['#F87171', '#FBBF24', '#4ADE80', '#38BDF8', '#C084FC', '#F472B6', '#FDE68A'];
var confettiRun = null;
function confetti(word, icon) {
  var label = document.getElementById('confetti-word');
  if (label) {
    label.innerHTML = '<i class="fa-solid ' + (icon || 'fa-champagne-glasses') + '"></i><span></span>';
    label.lastChild.textContent = word || '';
    label.classList.remove('show');
    label.offsetWidth;
    label.classList.add('show');
    clearTimeout(label._hide);
    label._hide = setTimeout(function() { label.classList.remove('show'); }, 2600);
  }
  var canvas = document.getElementById('confetti');
  // wie minder beweging wil krijgt alleen het woord
  if (!canvas || noMotion || !canvas.getContext) return;
  var ctx = canvas.getContext('2d'), ratio = Math.min(window.devicePixelRatio || 1, 2);
  var w = canvas.width = window.innerWidth * ratio, h = canvas.height = window.innerHeight * ratio;
  var bits = [];
  for (var i = 0; i < 150; i++) {
    bits.push({
      x: Math.random() * w, y: -Math.random() * h * 0.6, vx: (Math.random() - 0.5) * 3 * ratio, vy: (2 + Math.random() * 4) * ratio,
      size: (5 + Math.random() * 7) * ratio, spin: Math.random() * 6.28, vspin: (Math.random() - 0.5) * 0.3,
      sway: Math.random() * 6.28, color: CONFETTI_COLORS[i % CONFETTI_COLORS.length]
    });
  }
  canvas.classList.add('show');
  var run = confettiRun = {};
  var start = performance.now(), LAST = 4200;
  (function frame(now) {
    if (confettiRun !== run) return;   // een nieuwe ronde heeft deze vervangen
    var t = now - start;
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = t > LAST - 800 ? Math.max(0, (LAST - t) / 800) : 1;
    bits.forEach(function(b) {
      b.sway += 0.05; b.spin += b.vspin;
      b.x += b.vx + Math.sin(b.sway) * 1.2 * ratio; b.y += b.vy;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.spin);
      ctx.fillStyle = b.color;
      // de snipper lijkt te draaien doordat zijn hoogte meebeweegt
      ctx.fillRect(-b.size / 2, -b.size / 4 * Math.cos(b.sway), b.size, b.size / 2 * Math.cos(b.sway));
      ctx.restore();
    });
    if (t < LAST) requestAnimationFrame(frame);
    else { ctx.clearRect(0, 0, w, h); canvas.classList.remove('show'); confettiRun = null; }
  })(start);
}

// ── Het feest in cijfers ──
// Bij Instellingen, en als blok op Home voor wie dat wil. Tijdens het feest loopt het mee; daarna blijft het staan
// tot de feeststand opnieuw wordt aangezet.
function partyDuration(ms) {
  var min = Math.max(0, Math.round(ms / 60000));
  return min >= 60 ? Math.floor(min / 60) + ' u ' + (min % 60) + ' min' : min + ' min';
}
function partyStatsHtml(s) {
  if (!s || s.never) return '<div class="empty-note">Zet de feeststand aan als de eerste gasten komen. Na afloop staat hier hoe de avond verliep: gasten, proosten, piekverbruik en wat het kostte.</div>';
  var end = s.ended_at || Date.now();
  function tile(icon, label, value, sub) {
    return '<div class="party-tile"><i class="fa-solid ' + icon + '"></i><div class="party-value">' + value + '</div><div class="party-label">' + label + '</div>' + (sub ? '<div class="party-sub">' + sub + '</div>' : '') + '</div>';
  }
  var when = s.on ? 'Bezig sinds ' + shortWhen(s.started_at) : shortWhen(s.started_at) + ' tot ' + shortWhen(s.ended_at);
  return '<div class="party-when">' + (s.on ? '<span class="status-dot on"></span>' : '') + when + ' · ' + partyDuration(end - s.started_at) + '</div>' +
    '<div class="party-grid">' +
    tile('fa-door-open', 'Keer aangebeld', s.guests, s.guests ? 'eerste om ' + shortWhen(s.first_ring) + (s.guests > 1 ? ', laatste om ' + shortWhen(s.last_ring) : '') : 'telt mee via de deurbel') +
    tile('fa-champagne-glasses', 'Keer geproost', s.proosts) +
    tile('fa-music', 'Keer disco', s.discos) +
    tile('fa-bolt', 'Piekverbruik', s.peak_kw != null ? powerText(s.peak_kw) : '—', s.peak_at ? 'om ' + shortWhen(s.peak_at) : '') +
    tile('fa-plug', 'Stroom verbruikt', s.kwh != null ? nlNum(s.kwh, 1) + ' kWh' : '—', s.avg_kw != null ? 'gemiddeld ' + powerText(s.avg_kw) : '') +
    tile('fa-coins', 'Kosten stroom', s.cost != null ? eur(s.cost) : '—', s.cost != null ? 'per uurprijs, zonder vaste kosten' : '') +
    '</div>';
}
function loadPartyStats() {
  var slots = document.querySelectorAll('.party-stats');
  if (!slots.length) return;
  fetch('/api/party/stats').then(function(r){return r.json();}).then(function(s) {
    var html = partyStatsHtml(s);
    Array.prototype.forEach.call(document.querySelectorAll('.party-stats'), function(el) { el.innerHTML = html; });
  }).catch(function(){});
}
BLOCKS.party = {label:'Het feest in cijfers', icon:'fa-champagne-glasses', dynamic:true,
  render: function(el) { el.innerHTML = '<div class="card insight-card"><div class="chart-title">Het feest in cijfers</div><div class="party-stats"><span class="skel-line"></span></div></div>'; },
  refresh: function() { loadPartyStats(); }
};
// tijdens het feest lopen de cijfers mee op het scherm waar ze in beeld staan
setInterval(function() { if (partyState.on && !document.hidden && (currentScreen === 0 || currentScreen === 5)) loadPartyStats(); }, 60000);

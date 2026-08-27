// Generator: builds new app.js with mobile-first HTML
var fs = require('fs');

var before = fs.readFileSync('_before.txt', 'utf8');
var after  = fs.readFileSync('_after.txt',  'utf8');

// HTML before LOCAL_IP insertion
var html1 = `<!DOCTYPE html>
<html lang='nl'>
<head>
<meta charset='UTF-8'>
<meta name='viewport' content='width=device-width,initial-scale=1,viewport-fit=cover'>
<meta name='apple-mobile-web-app-capable' content='yes'>
<meta name='apple-mobile-web-app-status-bar-style' content='black-translucent'>
<title>VloedHub</title>
<link rel='preconnect' href='https://fonts.googleapis.com'>
<link rel='preconnect' href='https://fonts.gstatic.com' crossorigin>
<link href='https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap' rel='stylesheet'>
<style>
:root{--bg:#0C0F1D;--surface:#141728;--border:rgba(255,255,255,0.06);--text:#F1F5F9;--muted:#4A5880;--dim:#3D4D6A;--purple:#A855F7;--pl:#C084FC;--green:#22C55E;--orange:#F97316;--blue:#38BDF8;--yellow:#FBBF24;--red:#F87171;--nav-h:64px;--header-h:52px}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{font-family:'Poppins',system-ui,sans-serif;background:var(--bg);color:var(--text);height:100vh;display:flex;flex-direction:column;overflow:hidden}
.app-header{height:var(--header-h);flex-shrink:0;display:flex;align-items:center;justify-content:space-between;padding:0 1rem;background:rgba(12,15,29,0.97);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid var(--border);z-index:10}
.app-title{display:flex;align-items:center;gap:0.5rem;font-size:1.05rem;font-weight:700;letter-spacing:-0.01em}
.header-right{display:flex;align-items:center;gap:0.5rem}
.updated-text{font-size:0.62rem;color:var(--dim)}
.icon-link{display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;background:rgba(255,255,255,0.05);border:1px solid var(--border);color:var(--muted);text-decoration:none;font-size:0.85rem;transition:background 0.15s,color 0.15s}
.icon-link:hover{background:rgba(168,85,247,0.15);color:var(--pl)}
.screens-outer{flex:1;overflow:hidden;position:relative}
.screens-track{display:flex;width:500%;height:100%;transition:transform 0.38s cubic-bezier(0.4,0,0.2,1);will-change:transform}
.screen{width:20%;height:100%;overflow-y:auto;overflow-x:hidden;padding:0.75rem 0.85rem calc(var(--nav-h) + 0.85rem);-webkit-overflow-scrolling:touch;display:flex;flex-direction:column;gap:0.6rem}
.screen::-webkit-scrollbar{display:none}
.screen{scrollbar-width:none}
.bottom-nav{height:var(--nav-h);flex-shrink:0;display:flex;background:rgba(20,23,40,0.97);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-top:1px solid var(--border)}
.nav-item{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.18rem;background:none;border:none;cursor:pointer;color:var(--dim);font-family:inherit;transition:color 0.2s;position:relative;overflow:hidden;-webkit-tap-highlight-color:transparent;padding:0}
.nav-item.active{color:var(--pl)}
.nav-item::before{content:'';position:absolute;top:0;left:50%;transform:translateX(-50%);width:0;height:2px;background:var(--purple);border-radius:0 0 2px 2px;transition:width 0.25s cubic-bezier(0.4,0,0.2,1)}
.nav-item.active::before{width:36px}
.nav-icon{font-size:1.35rem;line-height:1;transition:transform 0.2s}
.nav-item.active .nav-icon{transform:scale(1.12)}
.nav-label{font-size:0.52rem;font-weight:600;letter-spacing:0.05em;text-transform:uppercase}
@keyframes ripple{to{transform:scale(4);opacity:0}}
.ripple-circle{position:absolute;border-radius:50%;background:rgba(168,85,247,0.2);width:36px;height:36px;margin:-18px;animation:ripple 0.45s ease forwards;pointer-events:none}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 8px var(--green);animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1;box-shadow:0 0 8px var(--green)}50%{opacity:0.35;box-shadow:0 0 2px var(--green)}}
@keyframes valueFlash{0%{}40%{color:#fff;transform:scale(1.06)}100%{transform:scale(1)}}
.flash{animation:valueFlash 0.5s ease}
@keyframes slideUp{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
.screen-entering>*{animation:slideUp 0.35s ease forwards;opacity:0}
.screen-entering>*:nth-child(1){animation-delay:0.04s}
.screen-entering>*:nth-child(2){animation-delay:0.09s}
.screen-entering>*:nth-child(3){animation-delay:0.14s}
.screen-entering>*:nth-child(4){animation-delay:0.19s}
.screen-entering>*:nth-child(5){animation-delay:0.24s}
.screen-entering>*:nth-child(6){animation-delay:0.29s}
.screen-entering>*:nth-child(7){animation-delay:0.34s}
.delivered{color:var(--purple)}.returned{color:var(--green)}.gas-c{color:var(--orange)}.voltage{color:var(--blue)}
.power-hero{background:var(--surface);border:1px solid rgba(168,85,247,0.2);border-radius:20px;padding:1.25rem 1.25rem 1rem;display:flex;flex-direction:column;gap:0.25rem;position:relative;overflow:hidden;box-shadow:0 4px 32px rgba(168,85,247,0.08)}
.power-hero::after{content:'';position:absolute;top:-50px;right:-50px;width:200px;height:200px;background:radial-gradient(circle,rgba(168,85,247,0.12) 0%,transparent 70%);pointer-events:none}
.power-label{font-size:0.58rem;text-transform:uppercase;color:var(--muted);letter-spacing:0.1em;font-weight:600}
.power-value{font-size:clamp(2.8rem,13vw,4.5rem);font-weight:700;letter-spacing:-0.04em;color:var(--pl);line-height:1}
.power-value .unit{font-size:1.1rem;color:var(--muted);font-weight:400;margin-left:0.15rem}
.power-sub{font-size:0.68rem;color:var(--muted)}
.info-strip{display:grid;grid-template-columns:repeat(3,1fr);gap:0.5rem}
.info-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:0.7rem 0.8rem;display:flex;flex-direction:column;transition:transform 0.2s,box-shadow 0.2s}
.info-card:active{transform:scale(0.97)}
.info-label{font-size:0.52rem;text-transform:uppercase;color:var(--dim);letter-spacing:0.07em;font-weight:600;margin-bottom:0.25rem}
.info-value{font-size:1.15rem;font-weight:700;letter-spacing:-0.02em}
.info-sub{font-size:0.58rem;color:var(--muted);margin-top:0.15rem}
.card-unit{font-size:0.65rem;color:var(--muted);margin-left:0.1rem;font-weight:400}
.phase-row{display:grid;grid-template-columns:repeat(3,1fr);gap:0.5rem}
.phase-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:0.7rem 0.8rem;transition:transform 0.2s}
.phase-card:active{transform:scale(0.97)}
.phase-name{font-size:0.6rem;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:var(--dim);margin-bottom:0.3rem}
.phase-power{font-size:1rem;font-weight:700;color:var(--pl)}
.phase-volt{font-size:0.7rem;color:var(--blue);margin-top:0.18rem}
.phase-amp{font-size:0.62rem;color:var(--muted);margin-top:0.05rem}
.phase-bar-track{height:3px;background:rgba(255,255,255,0.07);border-radius:2px;margin-top:0.45rem;overflow:hidden}
.phase-bar-fill{height:100%;border-radius:2px;background:linear-gradient(90deg,var(--purple),var(--pl));transition:width 0.6s cubic-bezier(0.4,0,0.2,1)}
.log-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;overflow:hidden}
.log-header{padding:0.75rem 0.85rem 0.4rem;display:flex;align-items:center;justify-content:space-between}
.log-table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
.log-table{width:100%;border-collapse:collapse;font-size:0.7rem}
.log-table th{text-align:left;padding:0.3rem 0.85rem;color:var(--dim);font-size:0.55rem;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;border-bottom:1px solid rgba(255,255,255,0.06);white-space:nowrap}
.log-table td{padding:0.27rem 0.85rem;color:#94A3B8;border-bottom:1px solid rgba(255,255,255,0.03);white-space:nowrap}
.log-table tr:last-child td{border-bottom:none}
.chart-card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:0.85rem 1rem;display:flex;flex-direction:column;gap:0.5rem;min-height:230px}
.chart-header{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.35rem}
.chart-title{font-size:0.58rem;text-transform:uppercase;color:var(--dim);letter-spacing:0.08em;font-weight:600}
.chart-wrap{flex:1;position:relative;min-height:170px}
.tab-bar{display:flex;gap:0.3rem;flex-wrap:wrap}
.tab{background:transparent;border:1px solid rgba(255,255,255,0.08);color:var(--muted);border-radius:20px;padding:0.16rem 0.6rem;font-size:0.6rem;cursor:pointer;font-family:inherit;font-weight:600;transition:all 0.2s;-webkit-tap-highlight-color:transparent}
.tab.active{background:rgba(168,85,247,0.2);border-color:rgba(168,85,247,0.5);color:var(--pl)}
.cost-table{width:100%;border-collapse:collapse;font-size:0.71rem}
.cost-table th{text-align:left;padding:0.25rem 0.5rem;color:var(--dim);font-size:0.56rem;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;border-bottom:1px solid rgba(255,255,255,0.06)}
.cost-table td{padding:0.27rem 0.5rem;color:#94A3B8;border-bottom:1px solid rgba(255,255,255,0.03)}
.cost-table tr:last-child td{border-bottom:none}
.cost-table .num{text-align:right;font-variant-numeric:tabular-nums}
.compare-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:0.5rem}
.compare-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:0.75rem 0.85rem;transition:transform 0.2s}
.compare-card:active{transform:scale(0.97)}
.compare-title{font-size:0.52rem;text-transform:uppercase;color:var(--dim);letter-spacing:0.07em;font-weight:600;margin-bottom:0.5rem}
.compare-row{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:0.2rem}
.compare-label{font-size:0.6rem;color:var(--muted)}
.compare-value{font-size:0.78rem;font-weight:600;font-variant-numeric:tabular-nums}
.delta-up{color:var(--red);font-size:0.6rem;margin-left:0.2rem}
.delta-down{color:var(--green);font-size:0.6rem;margin-left:0.2rem}
.delta-same{color:var(--dim);font-size:0.6rem;margin-left:0.2rem}
.card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:0.85rem 1rem}
.section-title{font-size:0.58rem;text-transform:uppercase;color:var(--dim);letter-spacing:0.09em;font-weight:600}
.stats-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:0.5rem}
.stat-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:0.7rem 0.85rem;transition:transform 0.2s}
.stat-card:active{transform:scale(0.97)}
.stat-label{font-size:0.54rem;text-transform:uppercase;color:var(--dim);letter-spacing:0.07em;font-weight:600;margin-bottom:0.25rem}
.stat-value{font-size:1.05rem;font-weight:700;letter-spacing:-0.02em}
.stat-unit{font-size:0.58rem;color:var(--muted);margin-left:0.1rem}
.safety-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:0.5rem}
.heatmap-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;margin-top:0.5rem}
.heatmap{display:grid;grid-template-columns:1.8rem repeat(24,1fr);gap:2px;font-size:0.47rem;min-width:340px}
.hm-label{color:var(--dim);display:flex;align-items:center;justify-content:flex-end;padding-right:4px;font-weight:600}
.hm-hour-label{color:var(--dim);text-align:center;padding-bottom:2px}
.hm-cell{height:16px;border-radius:2px}
.cheap-hours-grid{display:flex;flex-wrap:wrap;gap:0.3rem;margin-top:0.4rem}
.hour-cheap{background:rgba(34,197,94,0.15);color:#4ADE80;border:1px solid rgba(34,197,94,0.3);border-radius:20px;padding:0.15rem 0.5rem;font-size:0.62rem;font-weight:600}
.hour-mid{background:rgba(251,191,36,0.12);color:#FDE68A;border:1px solid rgba(251,191,36,0.25);border-radius:20px;padding:0.15rem 0.5rem;font-size:0.62rem;font-weight:600}
.hour-exp{background:rgba(248,113,113,0.1);color:#FCA5A5;border:1px solid rgba(248,113,113,0.2);border-radius:20px;padding:0.15rem 0.5rem;font-size:0.62rem;font-weight:600}
.ip-badge{font-size:0.58rem;color:var(--dim);border:1px solid var(--border);border-radius:20px;padding:0.1rem 0.5rem;white-space:nowrap}
.ip-row{display:flex;gap:0.4rem;flex-wrap:wrap;align-items:center}
@media(min-width:720px){
  body{flex-direction:row;height:100vh}
  .app-header{display:none}
  .bottom-nav{width:64px;height:100%;flex-direction:column;padding:1rem 0;border-top:none;border-right:1px solid var(--border);order:-1;flex-shrink:0}
  .nav-item{flex:0 0 auto;height:60px;width:100%;border-radius:0}
  .nav-label{display:none}
  .nav-item::before{top:50%;left:0;transform:translateY(-50%);width:3px;height:0;border-radius:0 2px 2px 0;transition:height 0.25s cubic-bezier(0.4,0,0.2,1)}
  .nav-item.active::before{width:3px;height:36px}
  .screens-outer{flex:1}
  .stats-grid{grid-template-columns:repeat(3,1fr)}
  .safety-grid{grid-template-columns:repeat(4,1fr)}
}
</style>
<script src='https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js'></script>
</head>
<body>
<header class='app-header'>
  <div class='app-title'><span class='dot'></span>VloedHub</div>
  <div class='header-right'>
    <span class='updated-text' id='updated'>Wachten op data\u2026</span>
    <a href='/debug' class='icon-link' title='Debug'>&#9881;</a>
  </div>
</header>
<div class='screens-outer' id='screens-outer'>
<div class='screens-track' id='screens-track'>

<!-- SCREEN 0: LIVE -->
<div class='screen screen-entering' id='screen-0'>
  <div class='ip-row'>
    <span class='ip-badge'>&#128421; `;

// HTML after LOCAL_IP insertion
var html2 = `:5000</span>
    <span class='ip-badge' id='wan-ip-badge'>&#127760; \u2026</span>
  </div>
  <div class='power-hero'>
    <div class='power-label'>Huidig verbruik</div>
    <div class='power-value delivered' id='del-total'>\u2014<span class='unit'>kW</span></div>
    <div class='power-sub' id='price-elec'>\u2014 \u20ac/kWh</div>
  </div>
  <div class='info-strip'>
    <div class='info-card'>
      <div class='info-label'>Kosten vandaag</div>
      <div class='info-value' style='color:var(--yellow)' id='hero-cost-today'>\u2014<span class='card-unit'>\u20ac</span></div>
    </div>
    <div class='info-card'>
      <div class='info-label'>Gas</div>
      <div class='info-value gas-c' id='gas'>\u2014<span class='card-unit'>m\u00b3</span></div>
      <div class='info-sub' id='price-gas'>\u2014 \u20ac/m\u00b3</div>
    </div>
    <div class='info-card'>
      <div class='info-label'>Metingen</div>
      <div class='info-value' id='stat-readings'>\u2014</div>
      <div class='info-sub'>vandaag</div>
    </div>
  </div>
  <div class='phase-row'>
    <div class='phase-card'>
      <div class='phase-name'>L1</div>
      <div class='phase-power' id='del-l1'>\u2014<span class='card-unit'>kW</span></div>
      <div class='phase-volt' id='v-l1'>\u2014<span class='card-unit'>V</span></div>
      <div class='phase-amp' id='a-l1'>\u2014<span class='card-unit'>A</span></div>
      <div class='phase-bar-track'><div class='phase-bar-fill' id='bar-l1' style='width:0%'></div></div>
    </div>
    <div class='phase-card'>
      <div class='phase-name'>L2</div>
      <div class='phase-power' id='del-l2'>\u2014<span class='card-unit'>kW</span></div>
      <div class='phase-volt' id='v-l2'>\u2014<span class='card-unit'>V</span></div>
      <div class='phase-amp' id='a-l2'>\u2014<span class='card-unit'>A</span></div>
      <div class='phase-bar-track'><div class='phase-bar-fill' id='bar-l2' style='width:0%'></div></div>
    </div>
    <div class='phase-card'>
      <div class='phase-name'>L3</div>
      <div class='phase-power' id='del-l3'>\u2014<span class='card-unit'>kW</span></div>
      <div class='phase-volt' id='v-l3'>\u2014<span class='card-unit'>V</span></div>
      <div class='phase-amp' id='a-l3'>\u2014<span class='card-unit'>A</span></div>
      <div class='phase-bar-track'><div class='phase-bar-fill' id='bar-l3' style='width:0%'></div></div>
    </div>
  </div>
  <div class='log-card'>
    <div class='log-header'><span class='section-title'>Recente metingen</span></div>
    <div class='log-table-wrap'>
      <table class='log-table'>
        <thead><tr><th>Tijd</th><th>Verbruik (kW)</th><th>Gas (m\u00b3)</th></tr></thead>
        <tbody id='rows'></tbody>
      </table>
    </div>
  </div>
</div>

<!-- SCREEN 1: VERLOOP -->
<div class='screen' id='screen-1'>
  <div class='chart-card'>
    <div class='chart-header'>
      <span class='chart-title'>Elektra verloop</span>
      <div class='tab-bar'>
        <button class='tab active' data-range='day' onclick='loadChart("day",this)'>Dag</button>
        <button class='tab' data-range='week' onclick='loadChart("week",this)'>Week</button>
        <button class='tab' data-range='month' onclick='loadChart("month",this)'>Maand</button>
      </div>
    </div>
    <div class='chart-wrap'><canvas id='chart'></canvas></div>
  </div>
  <div class='chart-card'>
    <div class='chart-header'><span class='chart-title'>Piekuren (gem. per uur)</span></div>
    <div class='chart-wrap'><canvas id='chart-peaks'></canvas></div>
  </div>
  <div class='chart-card'>
    <div class='chart-header'><span class='chart-title'>Weekdaggemiddelde (60 dgn)</span></div>
    <div class='chart-wrap'><canvas id='chart-weekday'></canvas></div>
  </div>
</div>

<!-- SCREEN 2: KOSTEN -->
<div class='screen' id='screen-2'>
  <div class='compare-grid'>
    <div class='compare-card'>
      <div class='compare-title'>Vandaag</div>
      <div class='compare-row'><span class='compare-label'>Stroom</span><span class='compare-value' id='cmp-today-elec'>\u2014</span></div>
      <div class='compare-row'><span class='compare-label'>Gas</span><span class='compare-value' id='cmp-today-gas'>\u2014</span></div>
      <div class='compare-row'><span class='compare-label'>Verwacht</span><span class='compare-value' id='cmp-today-exp' style='color:var(--yellow)'>\u2014</span></div>
    </div>
    <div class='compare-card'>
      <div class='compare-title'>Gisteren</div>
      <div class='compare-row'><span class='compare-label'>Stroom</span><span class='compare-value' id='cmp-yest-elec'>\u2014</span></div>
      <div class='compare-row'><span class='compare-label'>Gas</span><span class='compare-value' id='cmp-yest-gas'>\u2014</span></div>
    </div>
    <div class='compare-card'>
      <div class='compare-title'>Vr. week</div>
      <div class='compare-row'><span class='compare-label'>Stroom</span><span class='compare-value' id='cmp-week-elec'>\u2014</span></div>
      <div class='compare-row'><span class='compare-label'>Gas</span><span class='compare-value' id='cmp-week-gas'>\u2014</span></div>
    </div>
  </div>
  <div class='card'>
    <div class='section-title' style='margin-bottom:0.5rem'>Geschatte kosten <span style='color:var(--dim);font-size:0.55rem;font-weight:400'>(stroom = huidig uur \u00b7 gas = vandaag)</span></div>
    <table class='cost-table'>
      <thead><tr><th>Periode</th><th class='num'>kWh</th><th class='num'>Stroom \u20ac</th><th class='num'>m\u00b3</th><th class='num'>Gas \u20ac</th></tr></thead>
      <tbody id='cost-rows'><tr><td colspan='5' style='color:var(--dim);padding:0.3rem 0.5rem'>Laden\u2026</td></tr></tbody>
    </table>
  </div>
  <div class='chart-card'>
    <div class='chart-header'><span class='chart-title'>Kosten per dag (30 dgn)</span></div>
    <div class='chart-wrap'><canvas id='chart-costs-daily'></canvas></div>
  </div>
  <div class='card'>
    <div class='section-title'>Goedkoopste uren vandaag</div>
    <div class='cheap-hours-grid' id='cheap-hours-grid'></div>
  </div>
</div>

<!-- SCREEN 3: GAS -->
<div class='screen' id='screen-3'>
  <div class='chart-card'>
    <div class='chart-header'><span class='chart-title'>Faseverdeling (gem. + piek, 7 dgn)</span></div>
    <div class='chart-wrap'><canvas id='chart-phases'></canvas></div>
  </div>
  <div class='chart-card'>
    <div class='chart-header'><span class='chart-title'>Gas dagverbruik (30 dgn)</span></div>
    <div class='chart-wrap'><canvas id='chart-gas'></canvas></div>
  </div>
  <div class='chart-card'>
    <div class='chart-header'><span class='chart-title'>Gas per maand</span></div>
    <div class='chart-wrap'><canvas id='chart-gas-monthly'></canvas></div>
  </div>
</div>

<!-- SCREEN 4: INFO -->
<div class='screen' id='screen-4'>
  <div class='stats-grid'>
    <div class='stat-card'><div class='stat-label'>Gem. verbruik vandaag</div><div class='stat-value delivered' id='stat-avg-del'>\u2014<span class='stat-unit'>kW</span></div></div>
    <div class='stat-card'><div class='stat-label'>Piekverbruik vandaag</div><div class='stat-value delivered' id='stat-max-del'>\u2014<span class='stat-unit'>kW</span></div></div>
    <div class='stat-card'><div class='stat-label'>Gem. spanning</div><div class='stat-value voltage' id='stat-avg-v'>\u2014<span class='stat-unit'>V</span></div></div>
    <div class='stat-card'><div class='stat-label'>Meest actieve fase</div><div class='stat-value voltage' id='stat-top-phase'>\u2014</div></div>
    <div class='stat-card'><div class='stat-label'>Spanning min\u2013max</div><div class='stat-value' id='stat-voltage-range'>\u2014<span class='stat-unit'>V</span></div></div>
    <div class='stat-card'><div class='stat-label'>Metingen vandaag</div><div class='stat-value' id='stat-readings-info'>\u2014</div></div>
  </div>
  <div class='safety-grid'>
    <div class='stat-card'><div class='stat-label'>Spanningsdips (7 dgn)</div><div class='stat-value' id='saf-dips' style='color:var(--red)'>\u2014</div></div>
    <div class='stat-card'><div class='stat-label'>Max stroom L1/L2/L3</div><div class='stat-value voltage' id='saf-max-amp'>\u2014</div></div>
    <div class='stat-card'><div class='stat-label'>Nachtverbruik standby</div><div class='stat-value' style='color:var(--purple)' id='saf-night'>\u2014<span class='stat-unit'>kW</span></div></div>
    <div class='stat-card'><div class='stat-label'>CO\u2082 vandaag (est.)</div><div class='stat-value' id='saf-co2'>\u2014<span class='stat-unit'>kg</span></div></div>
  </div>
  <div class='card'>
    <div style='display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.4rem;margin-bottom:0.5rem'>
      <span class='section-title'>Heatmap (uur \u00d7 weekdag)</span>
      <div class='tab-bar'>
        <button class='tab active' data-hm='alltime' onclick='loadHeatmap("alltime",this)'>Alles</button>
        <button class='tab' data-hm='year' onclick='loadHeatmap("year",this)'>Jaar</button>
        <button class='tab' data-hm='month' onclick='loadHeatmap("month",this)'>Maand</button>
        <button class='tab' data-hm='day' onclick='loadHeatmap("day",this)'>Dag</button>
      </div>
    </div>
    <div class='heatmap-wrap'><div class='heatmap' id='heatmap'></div></div>
  </div>
</div>

</div><!-- /screens-track -->
</div><!-- /screens-outer -->

<nav class='bottom-nav'>
  <button class='nav-item active' data-screen='0' onclick='showScreen(0,this)'>
    <span class='nav-icon'>&#9889;</span><span class='nav-label'>Live</span>
  </button>
  <button class='nav-item' data-screen='1' onclick='showScreen(1,this)'>
    <span class='nav-icon'>&#128200;</span><span class='nav-label'>Verloop</span>
  </button>
  <button class='nav-item' data-screen='2' onclick='showScreen(2,this)'>
    <span class='nav-icon'>&#128176;</span><span class='nav-label'>Kosten</span>
  </button>
  <button class='nav-item' data-screen='3' onclick='showScreen(3,this)'>
    <span class='nav-icon'>&#128293;</span><span class='nav-label'>Gas</span>
  </button>
  <button class='nav-item' data-screen='4' onclick='showScreen(4,this)'>
    <span class='nav-icon'>&#128202;</span><span class='nav-label'>Info</span>
  </button>
</nav>

<script>
// ── Screen navigation ──
var currentScreen = 0;
var screenTrack = document.getElementById('screens-track');
var screenLoaded = [true, false, false, false, false];

function showScreen(n, btn, fromSwipe) {
  currentScreen = n;
  screenTrack.style.transition = fromSwipe
    ? 'transform 0.3s cubic-bezier(0.4,0,0.2,1)'
    : 'transform 0.38s cubic-bezier(0.4,0,0.2,1)';
  screenTrack.style.transform = 'translateX(calc(-20% * ' + n + '))';
  document.querySelectorAll('.nav-item').forEach(function(b) { b.classList.remove('active'); });
  if (btn) {
    btn.classList.add('active');
  } else {
    var nb = document.querySelector('.nav-item[data-screen="' + n + '"]');
    if (nb) nb.classList.add('active');
  }
  var screenEl = document.getElementById('screen-' + n);
  if (screenEl) {
    screenEl.classList.add('screen-entering');
    setTimeout(function() { screenEl.classList.remove('screen-entering'); }, 450);
  }
  if (!screenLoaded[n]) {
    screenLoaded[n] = true;
    if (n === 1) { loadChart('day', document.querySelector('[data-range="day"]')); loadPeaks(); loadWeekdayChart(); }
    if (n === 2) { refreshCosts(); refreshComparison(); loadCostsDaily(); refreshCheapHours(); }
    if (n === 3) { loadPhaseChart(); loadGasDaily(); loadGasMonthly(); }
    if (n === 4) { refreshStats(); refreshSafety(); loadHeatmap('alltime', document.querySelector('[data-hm="alltime"]')); }
  }
}

// ── Touch swipe ──
var touchX0 = 0, touchY0 = 0, isSwiping = false;
var outerEl = document.getElementById('screens-outer');
outerEl.addEventListener('touchstart', function(e) {
  touchX0 = e.touches[0].clientX;
  touchY0 = e.touches[0].clientY;
  isSwiping = false;
}, {passive: true});
outerEl.addEventListener('touchmove', function(e) {
  var dx = e.touches[0].clientX - touchX0;
  var dy = e.touches[0].clientY - touchY0;
  if (!isSwiping && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) { isSwiping = true; }
  if (isSwiping) {
    var pct = (currentScreen * 20) - (dx / window.innerWidth * 20);
    pct = Math.max(0, Math.min(80, pct));
    screenTrack.style.transition = 'none';
    screenTrack.style.transform = 'translateX(-' + pct + '%)';
  }
}, {passive: true});
outerEl.addEventListener('touchend', function(e) {
  var dx = e.changedTouches[0].clientX - touchX0;
  if (isSwiping) {
    if (dx < -50 && currentScreen < 4) showScreen(currentScreen + 1, null, true);
    else if (dx > 50 && currentScreen > 0) showScreen(currentScreen - 1, null, true);
    else showScreen(currentScreen, null, true);
  }
  isSwiping = false;
}, {passive: true});

// ── Ripple on nav ──
function addRipple(btn, e) {
  var rect = btn.getBoundingClientRect();
  var x = (e.clientX !== undefined ? e.clientX : rect.left + rect.width / 2) - rect.left;
  var y = (e.clientY !== undefined ? e.clientY : rect.top + rect.height / 2) - rect.top;
  var r = document.createElement('div');
  r.className = 'ripple-circle';
  r.style.left = x + 'px';
  r.style.top = y + 'px';
  btn.appendChild(r);
  setTimeout(function() { if (r.parentNode) r.parentNode.removeChild(r); }, 500);
}
document.querySelectorAll('.nav-item').forEach(function(btn) {
  btn.addEventListener('click', function(e) { addRipple(btn, e); });
});

// ── Value flash ──
function flashEl(id) {
  var el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
  setTimeout(function() { el.classList.remove('flash'); }, 500);
}

// ── WAN IP ──
fetch('/api/network-info').then(function(r) { return r.json(); }).then(function(d) {
  var el = document.getElementById('wan-ip-badge');
  if (el) el.textContent = '\uD83C\uDF10 ' + d.wan;
}).catch(function() {});

// ── Helpers ──
function val(v, dec) { return v != null ? Number(v).toFixed(dec != null ? dec : 3) : '\u2014'; }
function setEl(id, html) { var el = document.getElementById(id); if (el) el.innerHTML = html; }
function setCard(id, v, dec, unit) {
  setEl(id, val(v, dec) + '<span class="card-unit">' + unit + '</span>');
}

// ── Live refresh ──
var lastPowerVal = null;
function refresh() {
  fetch('/api/latest').then(function(r) { return r.json(); }).then(function(d) {
    var l = d.latest;
    if (!l) return;
    if (lastPowerVal !== null && Math.abs(l.power_delivered_total_kw - lastPowerVal) > 0.01) flashEl('del-total');
    lastPowerVal = l.power_delivered_total_kw;
    setCard('del-total', l.power_delivered_total_kw, 3, 'kW');
    setCard('gas',       l.gas_m3,                  3, 'm\u00b3');
    setCard('del-l1', l.power_delivered_l1_kw, 3, 'kW');
    setCard('del-l2', l.power_delivered_l2_kw, 3, 'kW');
    setCard('del-l3', l.power_delivered_l3_kw, 3, 'kW');
    setCard('v-l1', l.voltage_l1, 1, 'V');
    setCard('v-l2', l.voltage_l2, 1, 'V');
    setCard('v-l3', l.voltage_l3, 1, 'V');
    setCard('a-l1', l.current_l1, 0, 'A');
    setCard('a-l2', l.current_l2, 0, 'A');
    setCard('a-l3', l.current_l3, 0, 'A');
    var p1 = l.power_delivered_l1_kw || 0;
    var p2 = l.power_delivered_l2_kw || 0;
    var p3 = l.power_delivered_l3_kw || 0;
    var pMax = Math.max(p1, p2, p3, 0.001);
    var b1 = document.getElementById('bar-l1'); if (b1) b1.style.width = Math.round(p1/pMax*100) + '%';
    var b2 = document.getElementById('bar-l2'); if (b2) b2.style.width = Math.round(p2/pMax*100) + '%';
    var b3 = document.getElementById('bar-l3'); if (b3) b3.style.width = Math.round(p3/pMax*100) + '%';
    var updEl = document.getElementById('updated');
    if (updEl) {
      var age = Math.round((Date.now() - new Date(l.received_at).getTime()) / 1000);
      updEl.textContent = new Date(l.received_at).toLocaleTimeString('nl-NL', {hour12:false}) + ' (' + age + 's)';
      updEl.style.color = age > 60 ? '#F87171' : age > 30 ? '#FBBF24' : '#3D4D6A';
    }
    var html = '';
    for (var i = 0; i < d.recent.length; i++) {
      var rec = d.recent[i];
      html += '<tr><td>' + new Date(rec.received_at).toLocaleTimeString('nl-NL', {hour12:false}) + '</td>' +
        '<td>' + val(rec.power_delivered_total_kw) + '</td>' +
        '<td>' + val(rec.gas_m3) + '</td></tr>';
    }
    setEl('rows', html);
  }).catch(function(e) { console.error('[refresh]', e); });
}
refresh();
setInterval(refresh, 3000);

// ── Chart ──
var chart = null;
function loadChart(range, btn) {
  document.querySelectorAll('[data-range]').forEach(function(t) { t.classList.remove('active'); });
  if (btn) btn.classList.add('active');
  fetch('/api/history?range=' + range).then(function(r) { return r.json(); }).then(function(rows) {
    var labels = rows.map(function(r) { return r.period; });
    var del    = rows.map(function(r) { return r.del != null ? Number(r.del).toFixed(3) : null; });
    if (chart) chart.destroy();
    chart = new Chart(document.getElementById('chart'), {
      type: 'line',
      data: { labels: labels, datasets: [
        { label: 'Verbruik (kW)', data: del, borderColor: '#A855F7', backgroundColor: 'rgba(168,85,247,0.1)', tension: 0.3, pointRadius: 2, fill: true }
      ]},
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: '#94A3B8', boxWidth: 12, font: { size: 10 } } } },
        scales: {
          x: { ticks: { color: '#3D4D6A', maxRotation: 45, font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
          y: { ticks: { color: '#3D4D6A', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true }
        }
      }
    });
  }).catch(function() {});
}

function eur(v) { return v != null ? '\u20ac' + Number(v).toFixed(2) : '\u2014'; }
function num(v, d) { return v != null ? Number(v).toFixed(d != null ? d : 3) : '\u2014'; }

// ── Costs ──
function refreshCosts() {
  fetch('/api/costs').then(function(r) { return r.json(); }).then(function(c) {
    var rows = [['Uur','hour'],['Dag','day'],['Week','week'],['Maand','month']];
    setEl('cost-rows', rows.map(function(r) {
      var d = c[r[1]];
      return '<tr><td>' + r[0] + '</td><td class="num">' + num(d.elec_kwh) + '</td><td class="num">' + eur(d.elec_cost) + '</td><td class="num">' + num(d.gas_m3) + '</td><td class="num">' + eur(d.gas_cost) + '</td></tr>';
    }).join(''));
    var day = c.day;
    if (day && (day.elec_cost != null || day.gas_cost != null)) {
      var total = (day.elec_cost || 0) + (day.gas_cost || 0);
      setEl('hero-cost-today', '\u20ac' + total.toFixed(2) + '<span class="card-unit">/dag</span>');
    }
  }).catch(function() {});
}
refreshCosts();
setInterval(refreshCosts, 60000);

// ── Prices ──
function refreshPrices() {
  fetch('/api/prices').then(function(r) { return r.json(); }).then(function(p) {
    if (p.electricity_eur_kwh != null)
      setEl('price-elec', Number(p.electricity_eur_kwh).toFixed(4) + '<span class="card-unit">\u20ac/kWh</span>');
    if (p.gas_eur_m3 != null)
      setEl('price-gas', Number(p.gas_eur_m3).toFixed(4) + '<span class="card-unit">\u20ac/m\u00b3</span>');
  }).catch(function() {});
}
refreshPrices();
setInterval(refreshPrices, 900000);

// ── Stats ──
function refreshStats() {
  fetch('/api/stats').then(function(r) { return r.json(); }).then(function(s) {
    if (!s || s.avg_del == null) return;
    setEl('stat-avg-del', num(s.avg_del, 3) + '<span class="stat-unit">kW</span>');
    setEl('stat-max-del', num(s.max_del, 3) + '<span class="stat-unit">kW</span>');
    var phases = [['L1', s.avg_l1], ['L2', s.avg_l2], ['L3', s.avg_l3]];
    var top = phases.filter(function(p) { return p[1] != null; }).sort(function(a,b) { return b[1]-a[1]; })[0];
    var topEl = document.getElementById('stat-top-phase'); if (topEl) topEl.textContent = top ? top[0] : '\u2014';
    if (s.min_v1 != null && s.max_v1 != null) {
      setEl('stat-voltage-range', num(s.min_v1,1) + '\u2013' + num(s.max_v1,1) + '<span class="stat-unit">V</span>');
      setEl('stat-avg-v', num((s.min_v1+s.max_v1)/2,1) + '<span class="stat-unit">V</span>');
    }
    var rd = s.total_readings != null ? s.total_readings : '\u2014';
    var rdEl = document.getElementById('stat-readings'); if (rdEl) rdEl.textContent = rd;
    var rdEl2 = document.getElementById('stat-readings-info'); if (rdEl2) rdEl2.textContent = rd;
  }).catch(function() {});
}
refreshStats();
setInterval(refreshStats, 30000);

// ── Peaks ──
var chartPeaks = null;
function loadPeaks() {
  fetch('/api/peaks').then(function(r) { return r.json(); }).then(function(rows) {
    var byHour = {};
    rows.forEach(function(r) { byHour[parseInt(r.hour,10)] = r; });
    var labels = [], delData = [], counts = [];
    for (var h = 0; h < 24; h++) {
      labels.push(h + ':00');
      var d = byHour[h];
      delData.push(d && d.avg_del != null ? Number(d.avg_del).toFixed(3) : 0);
      counts.push(d ? d.n : 0);
    }
    if (chartPeaks) chartPeaks.destroy();
    chartPeaks = new Chart(document.getElementById('chart-peaks'), {
      type: 'bar',
      data: { labels: labels, datasets: [
        { label: 'Gem. verbruik (kW)', data: delData, backgroundColor: 'rgba(168,85,247,0.55)', borderColor: '#A855F7', borderWidth: 1, borderRadius: 3 }
      ]},
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#94A3B8', boxWidth: 10, font: { size: 10 } } }, tooltip: { callbacks: { afterLabel: function(ctx) { return 'Metingen: ' + counts[ctx.dataIndex]; } } } },
        scales: { x: { ticks: { color: '#3D4D6A', maxRotation: 45, font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' } }, y: { ticks: { color: '#3D4D6A', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true } }
      }
    });
  }).catch(function() {});
}

// ── Phase chart ──
var chartPhases = null;
function loadPhaseChart() {
  fetch('/api/phase-stats').then(function(r) { return r.json(); }).then(function(s) {
    if (!s || s.avg_l1 == null) return;
    if (chartPhases) chartPhases.destroy();
    chartPhases = new Chart(document.getElementById('chart-phases'), {
      type: 'bar',
      data: { labels: ['L1','L2','L3'], datasets: [
        { label: 'Gemiddeld (kW)', data: [s.avg_l1,s.avg_l2,s.avg_l3].map(function(v){return v!=null?Number(v).toFixed(3):0;}), backgroundColor: ['rgba(168,85,247,0.6)','rgba(56,189,248,0.6)','rgba(251,146,60,0.6)'], borderColor: ['#A855F7','#38BDF8','#F97316'], borderWidth: 1, borderRadius: 4 },
        { label: 'Piek (kW)', data: [s.max_l1,s.max_l2,s.max_l3].map(function(v){return v!=null?Number(v).toFixed(3):0;}), backgroundColor: ['rgba(168,85,247,0.2)','rgba(56,189,248,0.2)','rgba(251,146,60,0.2)'], borderColor: ['#A855F7','#38BDF8','#F97316'], borderWidth: 1, borderRadius: 4 }
      ]},
      options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { labels: { color: '#94A3B8', boxWidth: 10, font: { size: 10 } } } }, scales: { x: { ticks: { color: '#3D4D6A', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true }, y: { ticks: { color: '#94A3B8', font: { size: 11, weight: '600' } }, grid: { color: 'rgba(255,255,255,0.04)' } } } }
    });
  }).catch(function() {});
}

// ── Gas daily ──
var chartGas = null;
function loadGasDaily() {
  fetch('/api/gas-daily').then(function(r) { return r.json(); }).then(function(rows) {
    var labels = rows.map(function(r) { return r.day.slice(5); });
    var data   = rows.map(function(r) { return r.gas_used != null ? Number(r.gas_used).toFixed(3) : 0; });
    if (chartGas) chartGas.destroy();
    chartGas = new Chart(document.getElementById('chart-gas'), {
      type: 'bar',
      data: { labels: labels, datasets: [{ label: 'Gas (m\u00b3)', data: data, backgroundColor: 'rgba(249,115,22,0.55)', borderColor: '#F97316', borderWidth: 1, borderRadius: 3 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#94A3B8', boxWidth: 10, font: { size: 10 } } } }, scales: { x: { ticks: { color: '#3D4D6A', maxRotation: 45, font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' } }, y: { ticks: { color: '#3D4D6A', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true } } }
    });
  }).catch(function() {});
}

// ── Day comparison ──
function refreshComparison() {
  fetch('/api/day-comparison').then(function(r){return r.json();}).then(function(c) {
    var t = c.today, y = c.yesterday, w = c.lastweek;
    function kwh(v) { return v != null ? num(v,2)+' kWh' : '\u2014'; }
    function m3(v)  { return v != null ? num(v,3)+' m\u00b3' : '\u2014'; }
    function delta(now, ref) {
      if (now == null || ref == null || ref === 0) return '';
      var pct = ((now - ref) / ref * 100);
      var cls = pct > 5 ? 'delta-up' : pct < -5 ? 'delta-down' : 'delta-same';
      return '<span class="'+cls+'">'+(pct>0?'+':'')+pct.toFixed(0)+'%</span>';
    }
    setEl('cmp-today-elec', kwh(t && t.elec_kwh) + delta(t && t.elec_kwh, y && y.elec_kwh));
    setEl('cmp-today-gas',  m3(t && t.gas_used)  + delta(t && t.gas_used,  y && y.gas_used));
    setEl('cmp-yest-elec',  kwh(y && y.elec_kwh));
    setEl('cmp-yest-gas',   m3(y && y.gas_used));
    setEl('cmp-week-elec',  kwh(w && w.elec_kwh));
    setEl('cmp-week-gas',   m3(w && w.gas_used));
    if (t && t.elec_kwh != null) {
      var h = new Date().getHours() + new Date().getMinutes()/60;
      if (h > 0) setEl('cmp-today-exp', '~' + num(t.elec_kwh/h*24,2) + ' kWh/dag');
    }
  }).catch(function(){});
}

// ── Safety ──
function refreshSafety() {
  fetch('/api/voltage-dips').then(function(r){return r.json();}).then(function(s) {
    if (!s) return;
    var dipsEl = document.getElementById('saf-dips');
    if (dipsEl) { dipsEl.textContent = s.dips != null ? s.dips : '\u2014'; dipsEl.style.color = (s.dips > 0) ? '#F87171' : '#4ADE80'; }
    if (s.max_a1 != null) setEl('saf-max-amp', num(s.max_a1,0)+'A / '+num(s.max_a2,0)+'A / '+num(s.max_a3,0)+'A<span class="stat-unit"> max</span>');
  }).catch(function(){});
  fetch('/api/night-usage').then(function(r){return r.json();}).then(function(s) {
    if (!s) return;
    if (s.night_avg != null) setEl('saf-night', num(s.night_avg,3)+'<span class="stat-unit">kW</span>');
  }).catch(function(){});
  fetch('/api/stats').then(function(r){return r.json();}).then(function(s) {
    if (!s || s.avg_del == null) return;
    var h = new Date().getHours() + new Date().getMinutes()/60;
    var co2 = s.avg_del * h * 0.4;
    setEl('saf-co2', num(co2,2)+'<span class="stat-unit">kg</span>');
  }).catch(function(){});
}

// ── Cheap hours ──
function refreshCheapHours() {
  fetch('/api/prices').then(function(r){return r.json();}).then(function(p) {
    var grid = document.getElementById('cheap-hours-grid');
    if (!grid) return;
    if (p.electricity_eur_kwh != null) {
      var price = p.electricity_eur_kwh;
      var now = new Date().getHours();
      var html = '<div style="font-size:0.7rem;color:#94A3B8;width:100%">Huidig uur (' + now + ':00): <strong style="color:#FBBF24">\u20ac' + price.toFixed(4) + '/kWh</strong></div>';
      html += '<div style="font-size:0.62rem;color:#3D4D6A;width:100%;margin-top:0.3rem">Tip: plan grote apparaten in de avond (vaak lager tarief)</div>';
      grid.innerHTML = html;
    }
  }).catch(function(){});
}

// ── Weekday chart ──
var chartWeekday = null;
function loadWeekdayChart() {
  fetch('/api/weekday-avg').then(function(r){return r.json();}).then(function(rows) {
    var dayNames = ['Zo','Ma','Di','Wo','Do','Vr','Za'];
    var byDow = {};
    rows.forEach(function(r){ byDow[parseInt(r.dow,10)] = r; });
    var labels = [], data = [];
    for (var d = 0; d < 7; d++) {
      labels.push(dayNames[d]);
      var r = byDow[d];
      data.push(r && r.avg_del != null ? Number(r.avg_del).toFixed(3) : 0);
    }
    if (chartWeekday) chartWeekday.destroy();
    chartWeekday = new Chart(document.getElementById('chart-weekday'), {
      type: 'bar',
      data: { labels: labels, datasets: [{ label: 'Gem. verbruik (kW)', data: data, backgroundColor: ['rgba(168,85,247,0.4)','rgba(168,85,247,0.6)','rgba(168,85,247,0.6)','rgba(168,85,247,0.6)','rgba(168,85,247,0.6)','rgba(168,85,247,0.6)','rgba(168,85,247,0.4)'], borderColor: '#A855F7', borderWidth: 1, borderRadius: 4 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#94A3B8', font: { size: 11, weight: '600' } }, grid: { color: 'rgba(255,255,255,0.04)' } }, y: { ticks: { color: '#3D4D6A', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true } } }
    });
  }).catch(function(){});
}

// ── Heatmap ──
function loadHeatmap(range, btn) {
  document.querySelectorAll('[data-hm]').forEach(function(t) { t.classList.remove('active'); });
  if (btn) btn.classList.add('active');
  fetch('/api/heatmap?range=' + (range || 'alltime')).then(function(r){return r.json();}).then(function(rows) {
    var dayNames = ['Zo','Ma','Di','Wo','Do','Vr','Za'];
    var grid = {}, maxVal = 0;
    rows.forEach(function(r) {
      var v = r.avg_del != null ? Number(r.avg_del) : 0;
      grid[r.dow + '_' + parseInt(r.hour,10)] = v;
      if (v > maxVal) maxVal = v;
    });
    if (maxVal === 0) maxVal = 1;
    var html = '<div class="hm-label"></div>';
    for (var h = 0; h < 24; h++) html += '<div class="hm-hour-label">' + h + '</div>';
    for (var d = 0; d < 7; d++) {
      html += '<div class="hm-label">' + dayNames[d] + '</div>';
      for (var h = 0; h < 24; h++) {
        var v = grid[d + '_' + h] || 0;
        var ratio = v / maxVal;
        var r2 = Math.round(168 + ratio*(248-168)), g2 = Math.round(85 - ratio*85), b2 = Math.round(247 - ratio*100);
        var alpha = 0.1 + ratio*0.8;
        var bg = 'rgba('+r2+','+g2+','+b2+','+alpha.toFixed(2)+')';
        html += '<div class="hm-cell" style="background:'+bg+'" title="'+dayNames[d]+' '+h+':00 \u2014 '+v.toFixed(3)+' kW"></div>';
      }
    }
    var hmEl = document.getElementById('heatmap'); if (hmEl) hmEl.innerHTML = html;
  }).catch(function(){});
}

// ── Daily costs chart ──
var chartCostsDaily = null;
function loadCostsDaily() {
  fetch('/api/costs-daily').then(function(r){return r.json();}).then(function(rows) {
    var labels  = rows.map(function(r){ return r.day.slice(5); });
    var elecD   = rows.map(function(r){ return r.elec_cost != null ? Number(r.elec_cost).toFixed(2) : 0; });
    var gasD    = rows.map(function(r){ return r.gas_cost  != null ? Number(r.gas_cost).toFixed(2)  : 0; });
    if (chartCostsDaily) chartCostsDaily.destroy();
    chartCostsDaily = new Chart(document.getElementById('chart-costs-daily'), {
      type: 'bar',
      data: { labels: labels, datasets: [
        { label: 'Stroom (\u20ac)', data: elecD, backgroundColor: 'rgba(168,85,247,0.55)', borderColor: '#A855F7', borderWidth: 1, borderRadius: 3, stack: 'cost' },
        { label: 'Gas (\u20ac)',    data: gasD,  backgroundColor: 'rgba(249,115,22,0.55)', borderColor: '#F97316', borderWidth: 1, borderRadius: 3, stack: 'cost' }
      ]},
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#94A3B8', boxWidth: 10, font: { size: 10 } } } }, scales: { x: { ticks: { color: '#3D4D6A', maxRotation: 45, font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' }, stacked: true }, y: { ticks: { color: '#3D4D6A', font: { size: 9 }, callback: function(v){ return '\u20ac'+v; } }, grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true, stacked: true } } }
    });
  }).catch(function(){});
}

// ── Gas monthly ──
var chartGasMonthly = null;
function loadGasMonthly() {
  fetch('/api/gas-monthly').then(function(r){return r.json();}).then(function(rows) {
    var labels = rows.map(function(r){ return r.month; });
    var data   = rows.map(function(r){ return r.gas_used != null ? Number(r.gas_used).toFixed(2) : 0; });
    if (chartGasMonthly) chartGasMonthly.destroy();
    chartGasMonthly = new Chart(document.getElementById('chart-gas-monthly'), {
      type: 'bar',
      data: { labels: labels, datasets: [{ label: 'Gas (m\u00b3)', data: data, backgroundColor: 'rgba(249,115,22,0.55)', borderColor: '#F97316', borderWidth: 1, borderRadius: 4 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#3D4D6A', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' } }, y: { ticks: { color: '#3D4D6A', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true } } }
    });
  }).catch(function(){});
}

// ── Periodic refresh for non-active screens ──
setInterval(function() {
  if (currentScreen === 1) { var a = document.querySelector('[data-range].active'); if(a) loadChart(a.dataset.range, a); }
  if (currentScreen === 2) { refreshCosts(); refreshComparison(); }
  if (currentScreen === 3) { loadPhaseChart(); loadGasDaily(); }
  if (currentScreen === 4) { refreshStats(); refreshSafety(); }
}, 60000);
setInterval(function() {
  if (currentScreen === 1) { loadPeaks(); loadWeekdayChart(); }
  if (currentScreen === 3) { loadGasMonthly(); }
  if (currentScreen === 2) { loadCostsDaily(); }
  if (currentScreen === 4) { var hb = document.querySelector('[data-hm].active'); loadHeatmap(hb ? hb.dataset.hm : 'alltime', hb || null); }
}, 300000);
</script>
</body>
</html>`;

// Produce the JavaScript string for var HTML
// Split at LOCAL_IP insertion point
var p1 = JSON.stringify(html1);
var p2 = JSON.stringify(html2);
var htmlLine = 'var HTML = ' + p1 + ' + LOCAL_IP + ' + p2 + ';';

var newContent = before + '\n' + htmlLine + '\n' + after;
fs.writeFileSync('app.js', newContent, 'utf8');
console.log('Done. Total lines:', newContent.split('\n').length);

// Cleanup
fs.unlinkSync('_before.txt');
fs.unlinkSync('_after.txt');

// ── Wasmachine ──
var chartWashWeekday = null;function loadWashWeekdayChart() { fetch('/api/wasmachine/weekday').then(function(r){return r.json();}).then(function(rows) { var dayNames = ['Zo','Ma','Di','Wo','Do','Vr','Za']; var byDow = {}; rows.forEach(function(r){ byDow[parseInt(r.dow,10)] = r; }); var labels = [], data = []; for (var d = 0; d < 7; d++) { labels.push(dayNames[d]); var r = byDow[d]; data.push(r ? r.n : 0); } if (chartWashWeekday) chartWashWeekday.destroy(); chartWashWeekday = new Chart(document.getElementById('chart-wash-weekday'), { type: 'bar', data: { labels: labels, datasets: [{ label: 'Aantal wasbeurten', data: data, backgroundColor: 'rgba(141,178,85,0.55)', borderColor: '#8DB255', borderWidth: 1, borderRadius: 4 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: CHART_TEXT, font: { size: 11, weight: '600' } }, grid: { color: CHART_GRID } }, y: { ticks: { color: CHART_TICK, font: { size: 11 }, precision: 0 }, grid: { color: CHART_GRID }, beginAtZero: true } } } }); }).catch(function(){}); }

function refreshWasmachine() { fetch('/api/wasmachine/stats').then(function(r){return r.json();}).then(function(s) { setEl('wash-total', s.total != null ? s.total : '—'); var hwt = document.getElementById('home-wash-total'); if (hwt) hwt.textContent = s.total != null ? s.total : '—'; setEl('wash-today', s.today != null ? s.today : 0); setEl('wash-week', s.this_week != null ? s.this_week : 0); setEl('wash-month', s.this_month != null ? s.this_month : 0); var lastEl = document.getElementById('wash-last'); if (lastEl) lastEl.textContent = 'Laatste was: ' + (s.last_finished_at ? shortWhen(s.last_finished_at) : '—'); }).catch(function(){}); fetch('/api/wasmachine/recent?limit=25').then(function(r){return r.json();}).then(function(rows) { var html = rows.length ? rows.map(function(r) { return '<tr><td>' + shortWhen(r.finished_at) + '</td><td>' + (r.device || '—') + '</td></tr>'; }).join('') : '<tr><td colspan="2" class="table-empty">Nog geen wasbeurten gelogd</td></tr>'; setEl('wash-rows', html); }).catch(function(){}); refreshWashStatus(); }
function esphomeCards(rows, editable) {
  if (!rows.length) return '<div class="esp-card"><div class="esp-head">Nog geen data</div></div>';
  var byDevice = {}, order = [];
  rows.forEach(function(r) {
    var d = r.device || '?';
    if (!byDevice[d]) { byDevice[d] = []; order.push(d); }
    byDevice[d].push(r);
  });
  return order.map(function(device) {
    var list = byDevice[device];
    var newest = Math.max.apply(null, list.map(function(r) { return new Date(r.received_at).getTime(); }));
    var age = Math.round((Date.now() - newest) / 60000);
    var ageText = isNaN(age) ? '' : age < 60 ? age + ' min geleden' : Math.round(age / 60) + ' uur geleden';
    return '<div class="esp-card"><div class="esp-head"><i class="fa-solid fa-microchip"></i><span>' + escHtml(device) + '</span><span class="esp-age">' + ageText + '</span></div>' +
      list.map(function(r) {
        var valStr = escHtml(r.value != null ? nlNum(r.value, 1) + (r.unit ? ' ' + r.unit : '') : (r.value_text || '—'));
        var pen = editable ? '<button class="icon-btn icon-btn-sm" aria-label="Naam wijzigen" title="Naam wijzigen" onclick="esphomeRename(\'' + encodeURIComponent(r.device) + '\',\'' + encodeURIComponent(r.sensor_name) + '\',this)"><i class="fa-solid fa-pen"></i></button>' : '';
        return '<div class="esp-row"><span class="esp-name"><span>' + escHtml(r.display_name) + '</span>' + pen + '</span><span class="esp-val">' + valStr + '</span></div>';
      }).join('') + '</div>';
  }).join('');
}
function refreshEsphome() { fetch('/api/esphome/latest').then(function(r){return r.json();}).then(function(rows) { var grid = document.getElementById('esphome-grid'); if (grid) grid.innerHTML = esphomeCards(rows, true); }).catch(function(){}); }
// ── Layout system ──
var layoutConfig = {};
var layoutEditMode = false;
// Home heeft in de tabletweergave een eigen indeling
function layoutKey(screenIdx) { return screenIdx === 0 && KIOSK && layoutConfig.kiosk ? 'kiosk' : String(screenIdx); }

// Blokken die bij een module horen verdwijnen als die module uit staat
var BLOCK_MODULE = { outages:'storingen', rain:'regen', traffic:'files', p2000:'p2000', ziggo:'ziggo', internet:'internet', camera:'camera',weather:'weather', afval:'afval', led_default:'lights', led_keuken:'lights', led_gang:'lights', relay_gang:'lights', scenes:'lights', fridge:'fridge', temperature_grid:'temperature', chart_temp_mini:'temperature', esphome_grid:'esphome', wasmachine_quick:'wasmachine', gas_today:'gas' };
function blockEnabled(type) { return !BLOCK_MODULE[type] || moduleOn(BLOCK_MODULE[type]); }

var BLOCKS = {
  'weather':          {label:'Weer',              icon:'fa-cloud-sun',       dynamic:false},
  'power_live':       {label:'Live verbruik',      icon:'fa-bolt',            dynamic:false},
  'info_stats':       {label:'Statistieken',        icon:'fa-chart-pie',       dynamic:false},
  'led_default':      {label:'LED Strip',             icon:'fa-lightbulb',       dynamic:false},
  'led_keuken':       {label:'Ledstrip Keuken',       icon:'fa-lightbulb',       dynamic:false},
  'led_gang':         {label:'Ledstrip Gang',          icon:'fa-lightbulb',       dynamic:false},
  'relay_gang':       {label:'Lamp Gang',              icon:'fa-toggle-on',       dynamic:false},
  'phases':           {label:'Fases L1/L2/L3',     icon:'fa-plug-circle-bolt',dynamic:false},
  'recent_readings':  {label:'Recente metingen',   icon:'fa-table',           dynamic:false},
  'temperature_grid': {label:'Temperatuur',         icon:'fa-temperature-half',dynamic:true,
    render: function(el) { el.innerHTML = '<div class="section-title">Temperatuur</div><div class="temp-grid" id="dyn-temp-grid"></div>'; },
    refresh: function() { fetch('/api/temperature/latest').then(function(r){return r.json();}).then(function(rows){ var g=document.getElementById('dyn-temp-grid'); if(!g) return; if(!rows.length){g.innerHTML='<div class="temp-card"><div class="temp-room">Nog geen data</div></div>';return;} g.innerHTML=rows.map(function(r){var age=Math.round((Date.now()-new Date(r.received_at).getTime())/60000);var ageText=age<60?age+' min geleden':Math.round(age/60)+' uur geleden';return '<div class="temp-card"><i class="fa-solid fa-temperature-half"></i><div class="temp-room">'+r.room+'</div><div class="temp-value">'+(r.temp_c!=null?nlNum(r.temp_c,1):'—')+' °C</div><div class="temp-age">'+ageText+'</div></div>';}).join('');}).catch(function(){}); }
  },
  'esphome_grid': {label:'ESPHome Sensoren', icon:'fa-microchip', dynamic:true,
    render: function(el) { el.innerHTML = '<div class="section-title">ESPHome Sensoren</div><div class="esp-grid" id="dyn-esphome-grid"></div>'; },
    refresh: function() { fetch('/api/esphome/latest').then(function(r){return r.json();}).then(function(rows){ var g=document.getElementById('dyn-esphome-grid'); if(g) g.innerHTML=esphomeCards(rows, false); }).catch(function(){}); }
  },
  'sun_times': {label:'Zon',icon:'fa-sun',dynamic:true,
    render:function(el){el.innerHTML='<div id="blk-sun" class="info-strip cols-2"></div>';},
    refresh:function(){fetch('/api/sun').then(function(r){return r.json();}).then(function(s){var el=document.getElementById('blk-sun');if(!el||!s)return;function fmt(t){if(!t)return'—';var d=new Date(t);return d.getHours()+':'+(d.getMinutes()<10?'0':'')+d.getMinutes();}var ms=(s.sunset||0)-(s.sunrise||0);var h=Math.floor(ms/3600000);var m=Math.floor((ms%3600000)/60000);el.innerHTML='<div class="info-card"><div class="info-label">Zonsopgang</div><div class="info-value c-yellow">'+fmt(s.sunrise)+'</div></div><div class="info-card"><div class="info-label">Zonsondergang</div><div class="info-value c-orange">'+fmt(s.sunset)+'</div><div class="info-sub">Daglicht '+h+'u'+m+'m</div></div>';}).catch(function(){});}
  },
  'power_price': {label:'Stroomprijs',icon:'fa-tag',dynamic:true,
    render:function(el){el.innerHTML='<div id="blk-price" class="power-hero"></div>';},
    refresh:function(){fetch('/api/prices').then(function(r){return r.json();}).then(function(p){var el=document.getElementById('blk-price');if(!el)return;var price=p.electricity_eur_kwh;var gas=p.gas_eur_m3;if(price==null){el.innerHTML='<div class="power-label">Stroomprijs</div><div class="empty-note">Niet beschikbaar</div>';return;}var color=price<0.15?'var(--green-l)':price<0.25?'var(--yellow)':'var(--red)';el.innerHTML='<div class="power-label">Stroomprijs</div><div class="power-value sm" style="color:'+color+'">€'+nlNum(price,2)+'<span class="unit">/kWh</span></div>'+(gas!=null?'<div class="power-sub">Gas: €'+nlNum(gas,2)+'/m³</div>':'');}).catch(function(){});}
  },
  'wasmachine_quick': {label:'Wasmachine',icon:'fa-shirt',dynamic:true,
    render:function(el){el.innerHTML='<div id="blk-wash-quick" class="power-hero"></div>';},
    refresh:function(){Promise.all([fetch('/api/wasmachine/status').then(function(r){return r.json();}),fetch('/api/wasmachine/stats').then(function(r){return r.json();})]).then(function(res){var s=res[0];var st=res[1];var el=document.getElementById('blk-wash-quick');if(!el)return;var state=s.state||'idle';var color=state==='running'?'var(--yellow)':state==='done'?'var(--green-l)':'var(--dim)';var icon=state==='running'?'fa-rotate':state==='done'?'fa-circle-check':'fa-moon';var label=state==='running'?'In gebruik':state==='done'?'Klaar!':'Inactief';el.innerHTML='<div class="power-label">Wasmachine</div><div class="power-value sm" style="color:'+color+'"><i class="fa-solid '+icon+'"></i> '+label+'</div><div class="power-sub">Vandaag: '+(st.today||0)+' · Week: '+(st.week||0)+'</div>';}).catch(function(){});}
  },
  'day_summary': {label:'Dag samenvatting',icon:'fa-chart-pie',dynamic:true,
    render:function(el){el.innerHTML='<div id="blk-daysummary" class="info-strip cols-2"></div>';},
    refresh:function(){Promise.all([fetch('/api/day-comparison').then(function(r){return r.json();}),fetch('/api/costs').then(function(r){return r.json();}).catch(function(){return {};})]).then(function(res){var d=res[0];var el=document.getElementById('blk-daysummary');if(!el)return;var t=d.today?d.today.elec_kwh:null;var ySofar=d.yesterday?d.yesterday.elec_kwh_sofar:null;var yFull=d.yesterday?d.yesterday.elec_kwh:null;var cost=res[1].day?res[1].day.elec_cost:null;var diff=(t!=null&&ySofar!=null)?t-ySofar:null;var col=diff==null?'var(--muted)':diff>0?'var(--red)':'var(--green-l)';el.innerHTML='<div class="info-card"><div class="info-label">Vandaag</div><div class="info-value c-yellow">'+(t!=null?nlNum(t,1):'—')+'<span class="card-unit">kWh</span></div><div class="info-sub">'+(cost!=null?'€'+nlNum(cost,2):'')+'</div></div><div class="info-card"><div class="info-label">t.o.v. gisteren, zelfde tijd</div><div class="info-value" style="color:'+col+'">'+(diff!=null?(diff>0?'+':'−')+nlNum(Math.abs(diff),1):'—')+'<span class="card-unit">kWh</span></div><div class="info-sub">'+(yFull!=null?'Gisteren totaal: '+nlNum(yFull,1)+' kWh':'')+'</div></div>';}).catch(function(){});}
  },
  'cheap_hours': {label:'Goedkope uren',icon:'fa-clock',dynamic:true,
    render:function(el){el.innerHTML='<div id="blk-cheap" class="power-hero"></div>';},
    refresh:function(){fetch('/api/prices').then(function(r){return r.json();}).then(function(p){var el=document.getElementById('blk-cheap');if(!el)return;var price=p.electricity_eur_kwh;if(price==null){el.innerHTML='<div class="power-label">Stroomprijs</div><div class="empty-note">Niet beschikbaar</div>';return;}var color=price<0.15?'var(--green-l)':price<0.25?'var(--yellow)':'var(--red)';var tip=price<0.15?'Goedkoop uur, goed moment!':price<0.25?'Gemiddeld tarief':'Duur uur, wacht indien mogelijk';el.innerHTML='<div class="power-label">Huidig tarief</div><div class="power-value sm" style="color:'+color+'">€'+nlNum(price,2)+'<span class="unit">/kWh</span></div><div class="power-sub">'+tip+'</div>';}).catch(function(){});}
  },
  'solar_return': {label:'Teruglevering',icon:'fa-solar-panel',dynamic:true,
    render:function(el){el.innerHTML='<div id="blk-solar" class="power-hero"></div>';},
    refresh:function(){fetch('/api/latest').then(function(r){return r.json();}).then(function(d){var el=document.getElementById('blk-solar');if(!el)return;var latest=d.latest;var ret=latest?latest.power_returned_total_kw:null;var color=ret>0?'var(--green-l)':'var(--dim)';el.innerHTML='<div class="power-label">Teruglevering</div><div class="power-value sm" style="color:'+color+'">'+powerHtml(ret,'unit')+'</div><div class="power-sub">'+(ret>0?'Zonnepanelen actief':'Geen teruglevering')+'</div>';}).catch(function(){});}
  },
  'gas_today': {label:'Gas vandaag',icon:'fa-fire',dynamic:true,
    render:function(el){el.innerHTML='<div id="blk-gastoday" class="power-hero"></div>';},
    refresh:function(){Promise.all([fetch('/api/day-comparison').then(function(r){return r.json();}),fetch('/api/costs').then(function(r){return r.json();}).catch(function(){return {};})]).then(function(res){var el=document.getElementById('blk-gastoday');if(!el)return;var m3=res[0].today?res[0].today.gas_used:null;var cost=res[1].day?res[1].day.gas_cost:null;if(m3==null){el.innerHTML='<div class="power-label">Gas vandaag</div><div class="empty-note">Geen data</div>';return;}el.innerHTML='<div class="power-label">Gas vandaag</div><div class="power-value sm gas-c">'+nlNum(m3,2)+'<span class="unit">m³</span></div>'+(cost!=null?'<div class="power-sub">€'+nlNum(cost,2)+'</div>':'');}).catch(function(){});}
  },
  'scenes': {label:'Scènes',icon:'fa-wand-magic-sparkles',dynamic:true,
    render:function(el){el.innerHTML='<div class="card scene-card"><div class="chart-title">Scènes</div><div class="scene-row"></div></div>';},
    refresh:function(){loadScenes();}
  },
  'month_forecast': {label:'Maandprognose',icon:'fa-calendar-days',dynamic:true,
    render:function(el){el.innerHTML='<div class="power-hero"><div class="power-label">Verwacht deze maand</div><div class="power-value skel c-yellow" id="blk-forecast-value">—</div><div class="power-sub" id="blk-forecast-sub">&nbsp;</div></div>';},
    refresh:function(){loadForecast();}
  },
  'standby': {label:'Sluipverbruik',icon:'fa-plug',dynamic:true,
    render:function(el){el.innerHTML='<div class="power-hero"><div class="power-label">Sluipverbruik</div><div class="power-value skel c-blue" id="blk-standby-value">—</div><div class="power-sub" id="blk-standby-sub">&nbsp;</div></div>';},
    refresh:function(){loadStandby();}
  },
  'today_vs_normal': {label:'Vandaag t.o.v. normaal',icon:'fa-scale-balanced',dynamic:true,
    render:function(el){el.innerHTML='<div class="card insight-card"><div class="chart-title">Vandaag t.o.v. normaal</div><div class="tvn-value skel" id="blk-tvn-value">—</div><div class="tvn-track"><div class="tvn-fill" id="blk-tvn-fill"></div><div class="tvn-mark" id="blk-tvn-mark"></div></div><div class="power-sub" id="blk-tvn-sub">&nbsp;</div></div>';},
    refresh:function(){loadTodayVsNormal();}
  },
  'phase_load': {label:'Fase-belasting',icon:'fa-gauge-high',dynamic:true,
    render:function(el){var rows='';for(var i=1;i<=3;i++)rows+='<div class="pl-row"><span class="pl-name">L'+i+'</span><div class="pl-track"><div class="pl-fill" id="blk-pl-fill-'+i+'"></div></div><span class="pl-val" id="blk-pl-val-'+i+'">—</span></div>';el.innerHTML='<div class="card insight-card"><div class="chart-header"><span class="chart-title">Fase-belasting</span><span class="power-sub">van '+FUSE_AMPS+' A per fase</span></div>'+rows+'</div>';},
    refresh:function(){fetch('/api/latest').then(function(r){return r.json();}).then(function(d){if(d.latest)updatePhaseLoad(d.latest);}).catch(function(){});}
  },
  'fridge': {label:'Koelkast',icon:'fa-snowflake',dynamic:true,
    render:function(el){el.innerHTML='<div class="card fridge-card fridge-slot">'+fridgeSkeleton()+'</div>';},
    refresh:function(){loadFridge();}
  },
  'meldingen': {label:'Meldingen',icon:'fa-bell',dynamic:true,
    render:function(el){el.innerHTML='<div class="card outage-card" id="blk-meldingen"><div class="outage-line"><span class="skel-line grow"></span></div></div>';},
    refresh:function(){loadMeldingen();}
  },
  'outages': {label:'Stroomstoringen',icon:'fa-plug-circle-bolt',dynamic:true,
    render:function(el){el.innerHTML='<div class="card outage-card" id="blk-outages"><div class="outage-line"><span class="skel-line grow"></span></div></div>';},
    refresh:function(){loadOutages();}
  },
  'rain': {label:'Regen komende 2 uur',icon:'fa-cloud-rain',dynamic:true,
    render:function(el){el.innerHTML='<div class="card outage-card" id="blk-rain"><div class="outage-line"><span class="skel-line grow"></span></div></div>';},
    refresh:function(){loadRain();}
  },
  'traffic': {label:'Files',icon:'fa-car-side',dynamic:true,
    render:function(el){el.innerHTML='<div class="card outage-card" id="blk-traffic"><div class="outage-line"><span class="skel-line grow"></span></div></div>';},
    refresh:function(){loadTraffic();}
  },
  'p2000': {label:'112-meldingen',icon:'fa-truck-medical',dynamic:true,
    render:function(el){el.innerHTML='<div class="card outage-card" id="blk-p2000"><div class="outage-line"><span class="skel-line grow"></span></div></div>';},
    refresh:function(){loadP2000();}
  },
  'ziggo': {label:'Internetstoringen',icon:'fa-wifi',dynamic:true,
    render:function(el){el.innerHTML='<div class="card outage-card" id="blk-ziggo"><div class="outage-line"><span class="skel-line grow"></span></div></div>';},
    refresh:function(){loadZiggo();}
  },
  'status': {label:'Status omgeving',icon:'fa-list-check',dynamic:true,
    render:function(el){el.innerHTML='<div class="card insight-card" id="blk-status"><div class="status-chips"><span class="skel-line grow"></span></div><div class="fold"><div class="status-detail"></div></div></div>';},
    refresh:function(){loadStatus();}
  },
  'internet': {label:'Internetsnelheid',icon:'fa-wifi',dynamic:true,
    render:function(el){el.innerHTML='<div class="card insight-card"><div class="chart-header"><span class="chart-title">Internetsnelheid</span><button class="tab" id="blk-inet-run" onclick="runInternetTest()">Nu meten</button></div><div class="inet-values" id="blk-inet-values"></div><div class="chart-wrap h-60"><canvas id="blk-chart-inet"></canvas></div><div class="power-sub" id="blk-inet-sub">&nbsp;</div></div>';},
    refresh:function(){loadInternet();}
  },
  'camera': {label:'Deurbelcamera',icon:'fa-video',dynamic:true,
    render:function(el){el.innerHTML='<div class="card insight-card cam-card"><div class="chart-header"><span class="chart-title"><i class="fa-solid fa-bell"></i>Deurbel</span><span class="cam-pill" id="blk-cam-pill"><i></i><span>Verbinden</span></span></div><div class="cam-frame" id="blk-cam-frame" role="button" tabindex="0" aria-label="Beeld van de deurbel vergroten" onclick="toggleCamFull()"><img id="blk-cam-img" alt="Beeld van de deurbel" hidden><div class="cam-msg" id="blk-cam-msg"><i class="fa-solid fa-circle-notch fa-spin"></i><span>Laden…</span></div><div class="cam-bar"><span id="blk-cam-time"></span><i class="fa-solid fa-expand"></i></div></div><div class="cam-visits" id="blk-cam-visits"></div></div>';},
    refresh:function(){loadCamera();loadRings();}
  },
  'afval': {label:'Afvalkalender',icon:'fa-trash-can',dynamic:true,
    render:function(el){var rows='';for(var i=0;i<4;i++)rows+='<div class="afval-row"><span class="skel-line grow"></span></div>';el.innerHTML='<div class="card afval-card"><div class="chart-title">Afvalkalender</div><div id="blk-afval">'+rows+'</div></div>';},
    refresh:function(){loadAfval();}
  },
  'chart_power': {label:'Elektra verloop',icon:'fa-chart-area',dynamic:true,
    render:function(el){el.innerHTML='<div class="chart-card compact"><div class="chart-header"><span class="chart-title">Elektra verloop</span><div class="tab-bar"><button class="tab active" data-homerange="day" onclick="loadHomeChart(this)">Dag</button><button class="tab" data-homerange="week" onclick="loadHomeChart(this)">Week</button><button class="tab" data-homerange="month" onclick="loadHomeChart(this)">Maand</button></div></div><div class="chart-wrap h-150"><canvas id="blk-chart-elektra"></canvas></div></div>';},
    refresh:function(){loadHomeChart(document.querySelector('[data-homerange].active'));}
  },
  'chart_power_mini': {label:'Stroomgrafiek',icon:'fa-chart-line',dynamic:true,
    render:function(el){el.innerHTML='<div class="chart-card compact"><div class="chart-header"><span class="chart-title">Stroomverbruik vandaag</span></div><div class="chart-wrap h-120"><canvas id="blk-chart-power"></canvas></div></div>';},
    refresh:function(){fetch('/api/history?range=day').then(function(r){return r.json();}).then(function(rows){var ctx=document.getElementById('blk-chart-power');if(!ctx)return;if(window._blkChartPower)window._blkChartPower.destroy();window._blkChartPower=new Chart(ctx,{type:'line',data:{labels:rows.map(function(r){return r.period.slice(11,16);}),datasets:[{data:rows.map(function(r){return r.del!=null?r.del:null;}),borderColor:'#8DB255',backgroundColor:accentGradient,borderWidth:1.5,pointRadius:0,tension:0.3,fill:true}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{display:false},y:{display:false}}}});}).catch(function(){});}
  },
  'chart_temp_mini': {label:'Temperatuurgrafiek',icon:'fa-temperature-half',dynamic:true,
    render:function(el){el.innerHTML='<div class="chart-card compact"><div class="chart-header"><span class="chart-title">Temperatuur vandaag</span></div><div class="chart-wrap h-120"><canvas id="blk-chart-temp"></canvas></div></div>';},
    refresh:function(){fetch('/api/temperature/history?range=day').then(function(r){return r.json();}).then(function(rows){var ctx=document.getElementById('blk-chart-temp');if(!ctx)return;if(window._blkChartTemp)window._blkChartTemp.destroy();var rooms={};rows.forEach(function(r){if(!rooms[r.room])rooms[r.room]=[];rooms[r.room].push({x:r.period.slice(11,16),y:r.avg_temp});});var colors=['#38BDF8','#4ADE80','#FBBF24','#F87171','#8DB255'];var datasets=Object.keys(rooms).slice(0,5).map(function(room,i){return{label:room,data:rooms[room].map(function(p){return p.y;}),borderColor:colors[i],borderWidth:1.5,pointRadius:0,tension:0.3,fill:false};});var allLabels=rows.filter(function(r,i,a){return a.findIndex(function(x){return x.period===r.period;})==i;}).map(function(r){return r.period.slice(11,16);});window._blkChartTemp=new Chart(ctx,{type:'line',data:{labels:allLabels,datasets:datasets},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{display:false},y:{display:false}}}});}).catch(function(){});}
  }
};

// ── Inzichten en scènes ──
var FUSE_AMPS = 25; // hoofdzekering per fase
function nlNum(v, d) { return Number(v).toLocaleString('nl-NL', {minimumFractionDigits: d, maximumFractionDigits: d}); }
function updatePhaseLoad(l) {
  for (var i = 1; i <= 3; i++) {
    var fill = document.getElementById('blk-pl-fill-' + i);
    var valEl = document.getElementById('blk-pl-val-' + i);
    if (!fill || !valEl) return;
    var a = l['current_l' + i];
    if (a == null) { valEl.textContent = '—'; continue; }
    var pct = Math.min(100, a / FUSE_AMPS * 100);
    fill.style.width = pct + '%';
    fill.className = 'pl-fill' + (pct >= 80 ? ' high' : pct >= 60 ? ' mid' : '');
    valEl.textContent = nlNum(a, 0) + ' A';
  }
}
function loadForecast() {
  fetch('/api/insights/forecast').then(function(r){return r.json();}).then(function(f) {
    var sub = 'Tot nu toe €' + nlNum(f.cost || 0, 2) + ' · ' + nlNum(f.elec_kwh || 0, 0) + ' kWh · ' + nlNum(f.gas_m3 || 0, 0) + ' m³';
    if (f.forecast_cost == null) { setEl('blk-forecast-value', '—'); setEl('blk-forecast-sub', f.days_measured ? sub : 'Nog geen volledige dag gemeten deze maand'); return; }
    setEl('blk-forecast-value', '€' + nlNum(f.forecast_cost, 0));
    setEl('blk-forecast-sub', sub);
  }).catch(function() { setEl('blk-forecast-value', '—'); });
}
function loadStandby() {
  Promise.all([
    fetch('/api/night-usage').then(function(r){return r.json();}),
    fetch('/api/prices').then(function(r){return r.json();}).catch(function(){return {};})
  ]).then(function(res) {
    var kw = res[0].night_avg, price = res[1].electricity_eur_kwh;
    if (kw == null) { setEl('blk-standby-value', '—'); setEl('blk-standby-sub', 'Nog geen nachtmetingen'); return; }
    var yearKwh = kw * 8760;
    setEl('blk-standby-value', nlNum(kw * 1000, 0) + '<span class="unit">W</span>');
    setEl('blk-standby-sub', "'s Nachts gemiddeld · ≈ " + nlNum(yearKwh, 0) + ' kWh' + (price != null ? ' of €' + nlNum(yearKwh * price, 0) : '') + ' per jaar');
  }).catch(function() { setEl('blk-standby-value', '—'); });
}
function loadTodayVsNormal() {
  fetch('/api/insights/today-vs-normal').then(function(r){return r.json();}).then(function(d) {
    var fill = document.getElementById('blk-tvn-fill'), mark = document.getElementById('blk-tvn-mark');
    if (!fill) return;
    if (d.today_kwh == null) { setEl('blk-tvn-value', '—'); setEl('blk-tvn-sub', 'Nog geen metingen vandaag'); return; }
    if (d.normal_kwh == null) { setEl('blk-tvn-value', nlNum(d.today_kwh, 2) + '<span class="card-unit">kWh</span>'); setEl('blk-tvn-sub', 'Nog geen eerdere dagen om mee te vergelijken'); return; }
    var diff = (d.today_kwh - d.normal_kwh) / d.normal_kwh * 100;
    var color = diff > 10 ? 'var(--red)' : diff < -5 ? 'var(--green)' : 'var(--yellow)';
    var max = Math.max(d.today_kwh, d.normal_kwh) * 1.25;
    fill.style.width = (d.today_kwh / max * 100) + '%';
    fill.style.background = color;
    mark.style.left = (d.normal_kwh / max * 100) + '%';
    mark.style.display = 'block';
    setEl('blk-tvn-value', nlNum(d.today_kwh, 2) + '<span class="card-unit">kWh</span><span class="tvn-diff" style="color:' + color + '">' + (diff >= 0 ? '+' : '−') + nlNum(Math.abs(diff), 0) + '%</span>');
    var dayNames = ['zondagen','maandagen','dinsdagen','woensdagen','donderdagen','vrijdagen','zaterdagen'];
    setEl('blk-tvn-sub', 'Normaal ' + nlNum(d.normal_kwh, 2) + ' kWh op dit tijdstip · gemiddelde van ' + d.samples + ' ' + (d.basis === 'weekday' ? dayNames[new Date().getDay()] : 'dagen'));
  }).catch(function() { setEl('blk-tvn-value', '—'); });
}
// ── Internetsnelheid ──
var inetPoll = null;
function loadInternet() {
  Promise.all([
    fetch('/api/internet').then(function(r){return r.json();}),
    fetch('/api/internet/history?days=7').then(function(r){return r.json();}).catch(function(){return [];})
  ]).then(function(res) {
    var s = res[0], rows = res[1], l = s.latest;
    var btn = document.getElementById('blk-inet-run');
    if (!btn) return;
    btn.disabled = s.running;
    btn.textContent = s.running ? 'Bezig…' : 'Nu meten';
    // een test duurt een halve minuut; tot die klaar is blijven kijken
    clearTimeout(inetPoll);
    if (s.running) inetPoll = setTimeout(loadInternet, 5000);
    function val(label, v, d, unit, color) {
      return '<div><div class="info-label">' + label + '</div><div class="info-value" style="color:' + color + '">' + (v != null ? nlNum(v, d) : '—') + '<span class="card-unit">' + unit + '</span></div></div>';
    }
    setEl('blk-inet-values', val('Download', l && l.download_mbps, 0, 'Mbit/s', 'var(--accent-l)') + val('Upload', l && l.upload_mbps, 0, 'Mbit/s', 'var(--blue)') + val('Ping', l && l.ping_ms, 0, 'ms', 'var(--text)'));
    var sub = l ? 'Gemeten ' + shortWhen(l.measured_at) + (l.isp ? ' · ' + escHtml(l.isp) : '') : 'Nog geen meting';
    setEl('blk-inet-sub', s.error ? '<span class="c-red">' + escHtml(s.error) + '</span>' + (l ? ' · laatste meting ' + shortWhen(l.measured_at) : '') : sub);
    var ctx = document.getElementById('blk-chart-inet');
    if (!ctx) return;
    if (window._blkChartInet) window._blkChartInet.destroy();
    window._blkChartInet = new Chart(ctx, {type:'line', data:{labels:rows.map(function(r){return shortWhen(r.measured_at);}), datasets:[
      {label:'Download (Mbit/s)', data:rows.map(function(r){return r.download_mbps;}), borderColor:'#8DB255', backgroundColor:accentGradient, borderWidth:1.5, pointRadius:0, tension:0.3, fill:true},
      {label:'Upload (Mbit/s)', data:rows.map(function(r){return r.upload_mbps;}), borderColor:'#38BDF8', borderWidth:1.5, pointRadius:0, tension:0.3, fill:false}
    ]}, options:{responsive:true, maintainAspectRatio:false, interaction:{mode:'index', intersect:false}, plugins:{legend:{display:false}}, scales:{x:{display:false}, y:{display:false, beginAtZero:true}}}});
  }).catch(function(){});
}
function runInternetTest() {
  var btn = document.getElementById('blk-inet-run');
  if (btn) { btn.disabled = true; btn.textContent = 'Bezig…'; }
  fetch('/api/internet/run', {method:'POST'}).then(loadInternet).catch(function() { toast('Meting starten lukte niet', 'error'); loadInternet(); });
}
// ── Deurbelcamera ──
// Het beeld is een momentopname die om de paar seconden ververst, alleen zolang Home open staat.
var CAM_INTERVAL = 3000, CAM_RETRY = 15000;
var camTimer = null, camBusy = false;
function camNext(ms) { clearTimeout(camTimer); camTimer = setTimeout(loadCamera, ms); }
function camMessage(text) {
  var img = document.getElementById('blk-cam-img'), msg = document.getElementById('blk-cam-msg');
  if (!img || !msg) return;
  img.hidden = true; msg.hidden = false;
  msg.innerHTML = '<i class="fa-solid fa-video-slash"></i><span>' + escHtml(text) + '</span>';
  setEl('blk-cam-time', '');
  camState('off', 'Geen beeld');
}
function camState(cls, label) {
  var pill = document.getElementById('blk-cam-pill');
  if (pill) { pill.className = 'cam-pill ' + cls; pill.lastChild.textContent = label; }
}
// Tik op het beeld voor een schermvullende weergave; bij aanbellen opent die vanzelf, op elk scherm.
// Een eigen laag in plaats van de Fullscreen-API, want die bestaat op de iPhone niet voor gewone elementen.
// De laag haalt zelf zijn beeld op, zodat hij ook werkt als het blok niet op Home staat.
var CAM_OVERLAY_INTERVAL = 1500, CAM_RING_OPEN = 60000;
var camOvTimer = null, camOvClose = null, camOvUrl = null;
// Het grote beeld groeit vanuit het blok en krimpt daar bij het sluiten weer naartoe: dit zet het op de plek van het blok
function camShrink(big) {
  var frame = document.getElementById('blk-cam-frame');
  var r = frame && currentScreen === 0 ? frame.getBoundingClientRect() : null;
  if (!r || !r.width) { big.style.transform = 'scale(0.9)'; return; }
  var w = window.innerWidth, h = window.innerHeight;
  big.style.transform = 'translate(' + (r.left + r.width / 2 - w / 2) + 'px,' + (r.top + r.height / 2 - h / 2) + 'px) scale(' + Math.max(r.width / w, r.height / h) + ')';
}
function camOverlayTick() {
  var ov = document.getElementById('cam-overlay');
  if (!ov || !ov.classList.contains('open')) return;
  function next() { clearTimeout(camOvTimer); camOvTimer = setTimeout(camOverlayTick, CAM_OVERLAY_INTERVAL); }
  fetch('/api/camera/snapshot?t=' + Date.now()).then(function(r) {
    if (!r.ok) throw new Error('Geen beeld');
    return r.blob();
  }).then(function(blob) {
    var old = camOvUrl;
    camOvUrl = URL.createObjectURL(blob);
    ov.firstChild.src = camOvUrl;
    ov.firstChild.hidden = false;
    if (old) URL.revokeObjectURL(old);
    next();
  }).catch(next);
}
// ring: geopend doordat er wordt aangebeld; dan staat dat erbij en sluit de laag na een minuut vanzelf
function openCamOverlay(ring) {
  var ov = document.getElementById('cam-overlay'), img = document.getElementById('blk-cam-img');
  // stond er een foto van een eerder bezoek open, dan maakt die plaats voor het beeld van nu
  if (ov && ov.dataset.still) { ov.remove(); ov = null; }
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'cam-overlay';
    ov.className = 'cam-overlay';
    ov.onclick = closeCamOverlay;
    ov.innerHTML = '<img alt="Beeld van de deurbel" hidden><span class="cam-close"><i class="fa-solid fa-xmark"></i></span>';
    // het beeld van het blok als begin, tot de eerste eigen opname binnen is
    if (img && !img.hidden) { ov.firstChild.src = img.src; ov.firstChild.hidden = false; }
    camShrink(ov.firstChild);
    document.body.appendChild(ov);
    ov.offsetWidth; // beginstand vastleggen, anders slaat de browser de overgang over
    ov.classList.add('open');
    ov.firstChild.style.transform = '';
    camOverlayTick();
  }
  if (!ring) return;
  nightWake(CAM_RING_OPEN);
  if (!ov.querySelector('.cam-ring')) ov.insertAdjacentHTML('beforeend', '<div class="cam-ring"><i class="fa-solid fa-bell"></i>Er wordt aangebeld</div>');
  clearTimeout(camOvClose);
  camOvClose = setTimeout(closeCamOverlay, CAM_RING_OPEN);
}
function closeCamOverlay() {
  var ov = document.getElementById('cam-overlay');
  if (!ov || !ov.classList.contains('open')) return;
  clearTimeout(camOvTimer);
  clearTimeout(camOvClose);
  ov.classList.remove('open');
  camShrink(ov.firstChild);
  setTimeout(function() {
    ov.remove();
    if (camOvUrl) { URL.revokeObjectURL(camOvUrl); camOvUrl = null; }
  }, 280);
}
// ── Bezoekers ──
// Bij elke keer aanbellen bewaart de server een foto; de laatste staan onder het beeld en zijn groot te bekijken
var CAM_VISITS = 4;
function loadRings() {
  var el = document.getElementById('blk-cam-visits');
  if (!el) return;
  fetch('/api/camera/rings').then(function(r){return r.json();}).then(function(list) {
    el.innerHTML = list.slice(0, CAM_VISITS).map(function(at) {
      return '<button class="cam-visit" onclick="openCamStill(' + at + ')" aria-label="Foto van ' + shortWhen(at) + '"><img loading="lazy" alt="" src="/api/camera/rings/' + at + '.jpg"><span>' + shortWhen(at) + '</span></button>';
    }).join('');
  }).catch(function(){});
}
function openCamStill(at) {
  if (layoutEditMode || document.getElementById('cam-overlay')) return;
  var ov = document.createElement('div');
  ov.id = 'cam-overlay';
  ov.className = 'cam-overlay';
  ov.dataset.still = '1';
  ov.onclick = closeCamOverlay;
  ov.innerHTML = '<img alt="Foto van de deurbel" src="/api/camera/rings/' + at + '.jpg"><span class="cam-close"><i class="fa-solid fa-xmark"></i></span>' +
    '<div class="cam-ring still"><i class="fa-solid fa-bell"></i>Aangebeld ' + shortWhen(at) + '</div>';
  camShrink(ov.firstChild);
  document.body.appendChild(ov);
  ov.offsetWidth;
  ov.classList.add('open');
  ov.firstChild.style.transform = '';
}
function toggleCamFull() {
  var img = document.getElementById('blk-cam-img');
  if (img && !img.hidden && !layoutEditMode) openCamOverlay(false);
}
document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeCamOverlay(); });
// ── Aanbellen ──
// De server houdt bij wanneer er is aangebeld; hier wordt dat om de paar seconden nagevraagd. Een bel van
// minder dan drie kwart minuut geleden opent het beeld, ook als de app net pas is geopend.
var BELL_POLL = 2000, BELL_FRESH = 45000;
var bellSeen = null;
function checkBell() {
  if (document.hidden || !moduleOn('camera')) return;
  fetch('/api/camera/bell').then(function(r){return r.json();}).then(function(d) {
    if (!d.ring_at || d.ring_at === bellSeen) return;
    bellSeen = d.ring_at;
    if (d.age_ms > BELL_FRESH) return;
    openCamOverlay(true);
    loadMeldingen();
    // de foto wordt direct na het aanbellen gemaakt en is er een paar tellen later
    setTimeout(loadRings, 4000);
  }).catch(function(){});
}
setInterval(checkBell, BELL_POLL);
function loadCamera() {
  var img = document.getElementById('blk-cam-img');
  if (!img || !blockEnabled('camera') || img.closest('.layout-block').style.display === 'none') { clearTimeout(camTimer); return; }
  if (camBusy) return;
  if (document.hidden || currentScreen !== 0 || layoutEditMode) return camNext(CAM_INTERVAL);
  camBusy = true;
  // eerst ophalen en dan pas tonen, zodat het beeld niet knippert
  fetch('/api/camera/snapshot?t=' + Date.now()).then(function(r) {
    if (r.ok) return r.blob();
    return r.json().then(function(d) { throw new Error(d.error || 'Geen beeld'); });
  }).then(function(blob) {
    var old = img.src, msg = document.getElementById('blk-cam-msg');
    img.src = URL.createObjectURL(blob);
    if (old && old.indexOf('blob:') === 0) URL.revokeObjectURL(old);
    img.hidden = false;
    if (msg) msg.hidden = true;
    camState('live', 'Live');
    setEl('blk-cam-time', new Date().toLocaleTimeString('nl-NL', {hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false}));
    camBusy = false;
    camNext(CAM_INTERVAL);
  }).catch(function(e) {
    camBusy = false;
    camMessage(e && e.message && !/fetch|network/i.test(e.message) ? e.message : 'Geen verbinding');
    camNext(CAM_RETRY);
  });
}
// ── Verbinding ──
// Twee mislukte verzoeken achter elkaar (ruim 6 s) tonen een balkje; het eerste dat weer lukt haalt het weg.
var connFails = 0, lastConnOk = null;
function connOk() {
  connFails = 0;
  lastConnOk = new Date();
  var b = document.getElementById('conn-banner');
  if (b) b.hidden = true;
}
function connFail() {
  connFails++;
  var b = document.getElementById('conn-banner');
  if (!b || connFails < 2) return;
  document.getElementById('conn-text').textContent = 'Geen verbinding met VloedHub' +
    (lastConnOk ? ' · laatste update ' + lastConnOk.toLocaleTimeString('nl-NL', {hour:'2-digit', minute:'2-digit', hour12:false}) : '');
  b.hidden = false;
}

// ── Wandtablet-weergave ──
function kioskTick() {
  nightTick();
  var now = new Date();
  var c = document.getElementById('kiosk-clock'), d = document.getElementById('kiosk-date');
  if (c) c.textContent = now.toLocaleTimeString('nl-NL', {hour:'2-digit', minute:'2-digit', hour12:false});
  if (d) d.textContent = now.toLocaleDateString('nl-NL', {weekday:'long', day:'numeric', month:'long'});
}
// ── Nachtstand ──
// Binnen de ingestelde uren toont de wandtablet alleen een gedimde klok op zwart. Een tik of de deurbel maakt
// hem een minuut wakker. De instelling hoort bij het apparaat (de tablet), niet bij het huis.
var NIGHT_KEY = 'vh-night', NIGHT_AWAKE = 60000;
var nightAwakeUntil = 0;
function nightSettings() {
  try { var v = JSON.parse(localStorage.getItem(NIGHT_KEY)); if (v && v.from && v.to) return v; } catch (e) {}
  return { on: false, from: '23:00', to: '07:00' };
}
function nightMinutes(hhmm) { var p = String(hhmm).split(':'); return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0); }
function nightActive(now) {
  var v = nightSettings();
  if (!v.on) return false;
  var m = now.getHours() * 60 + now.getMinutes(), from = nightMinutes(v.from), to = nightMinutes(v.to);
  // loopt de periode over middernacht heen, dan is het nacht ná het begin óf vóór het eind
  return from <= to ? m >= from && m < to : m >= from || m < to;
}
function nightTick() {
  var ov = document.getElementById('night-overlay');
  if (!ov || !KIOSK) return;
  var now = new Date();
  var show = nightActive(now) && Date.now() > nightAwakeUntil;
  ov.classList.toggle('show', show);
  if (!show) return;
  setEl('night-time', now.toLocaleTimeString('nl-NL', {hour:'2-digit', minute:'2-digit', hour12:false}));
  setEl('night-date', now.toLocaleDateString('nl-NL', {weekday:'long', day:'numeric', month:'long'}));
  // elke minuut een andere plek, zodat de klok niet inbrandt
  var step = now.getMinutes();
  document.getElementById('night-clock').style.transform = 'translate(' + ((step * 7) % 21 - 10) + 'vw,' + ((step * 5) % 17 - 8) + 'vh)';
}
function nightWake(ms) { nightAwakeUntil = Date.now() + (ms || NIGHT_AWAKE); nightTick(); }
// zolang je de tablet gebruikt blijft hij wakker
document.addEventListener('pointerdown', function() { if (KIOSK && nightActive(new Date())) nightWake(); }, true);

// Instellingen > Algemeen > Weergave
function loadDisplaySettings() {
  var v = nightSettings(), sw = document.getElementById('night-on');
  if (!sw) return;
  sw.classList.toggle('on', !!v.on);
  sw.setAttribute('aria-checked', !!v.on);
  document.getElementById('night-from').value = v.from;
  document.getElementById('night-to').value = v.to;
  document.getElementById('night-times').hidden = !v.on;
  var pref = window.vhTheme ? vhTheme.get() : 'dark';
  document.querySelectorAll('[data-theme-pref]').forEach(function(b) {
    var on = b.dataset.themePref === pref;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on);
  });
  moveTabIndicators();
}
function saveNight(toggle) {
  var v = nightSettings();
  if (toggle) v.on = !v.on;
  v.from = document.getElementById('night-from').value || v.from;
  v.to = document.getElementById('night-to').value || v.to;
  try { localStorage.setItem(NIGHT_KEY, JSON.stringify(v)); } catch (e) { toast('Opslaan lukt niet op dit apparaat', 'error'); }
  loadDisplaySettings();
  nightTick();
}
function setTheme(pref) { if (window.vhTheme) vhTheme.set(pref); loadDisplaySettings(); }
loadDisplaySettings();
// de nachtklok staat verderop in de pagina dan dit script: de eerste controle wacht tot hij er is
document.addEventListener('DOMContentLoaded', nightTick);

function exitKiosk() {
  try { localStorage.removeItem('vh-kiosk'); } catch (e) {}
  location.href = '/';
}
if (KIOSK) {
  kioskTick();
  setInterval(kioskTick, 10000);
  // scherm aan houden waar de browser dat toestaat (alleen via https)
  var keepAwake = function() { if (navigator.wakeLock && document.visibilityState === 'visible') navigator.wakeLock.request('screen').catch(function(){}); };
  keepAwake();
  document.addEventListener('visibilitychange', keepAwake);
  // twee keer per dag vers laden, zodat een tablet die altijd aan staat updates meekrijgt
  setTimeout(function() { location.reload(); }, 12 * 3600 * 1000);
}

// ── Scènes ──
var SCENE_DATA = { scenes: [], icons: [], led: [], relay: [] };
var SCENE_DEVICE_NAMES = { 'led::default': 'LED Strip', 'led::keuken': 'Ledstrip Keuken', 'led::gang': 'Ledstrip Gang', 'relay::gang': 'Lamp Gang' };
function escHtml(v) { return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function sceneDeviceName(key) { return (typeof deviceNamesCache !== 'undefined' && deviceNamesCache[key]) || SCENE_DEVICE_NAMES[key] || key; }
function renderScenes() {
  var buttons = SCENE_DATA.scenes.map(function(s) {
    return '<button class="btn btn-ghost' + (s.id === 'disco' ? ' btn-disco' : '') + '" data-scene="' + s.id + '" onclick="runScene(this)"><i class="fa-solid fa-' + s.icon + '"></i> ' + escHtml(s.label) + '</button>';
  }).join('');
  Array.prototype.forEach.call(document.querySelectorAll('.scene-row'), function(el) {
    el.innerHTML = buttons || '<div class="empty-note">Nog geen scènes. Maak er een bij Instellingen.</div>';
  });
  var list = document.getElementById('settings-scenes');
  if (!list) return;
  list.innerHTML = '<div class="setting-card">' +
    SCENE_DATA.scenes.map(function(s) {
      return '<div class="setting-row"><i class="fa-solid fa-' + s.icon + ' setting-icon"></i>' +
        '<div class="setting-text"><div class="setting-title">' + escHtml(s.label) + '</div></div>' +
        '<button class="btn btn-ghost btn-sm" data-id="' + s.id + '" onclick="openSceneEditor(this.dataset.id)"><i class="fa-solid fa-pen"></i> Bewerken</button></div>';
    }).join('') +
    '<div class="setting-row"><button class="btn btn-primary" onclick="openSceneEditor(null)"><i class="fa-solid fa-plus"></i> Nieuwe scène</button></div>' +
    '</div>';
}
function loadScenes() {
  fetch('/api/scenes').then(function(r){return r.json();}).then(function(d) {
    if (!d || !d.scenes) return;
    SCENE_DATA = d;
    renderScenes();
  }).catch(function(){});
}
function runScene(btn) {
  btn.disabled = true;
  fetch('/api/scenes/run', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({scene: btn.dataset.scene})})
    .then(function(r){return r.json();}).then(function(d) {
      btn.disabled = false;
      if (!d.ok) { toast(d.error || 'Scène starten lukte niet', 'error'); return; }
      btn.classList.add('done');
      setTimeout(function() { btn.classList.remove('done'); }, 900);
      lampsRefresh();
    }).catch(function() { btn.disabled = false; toast('Scène starten lukte niet', 'error'); });
}

// Scène maken of bewerken
var sceneEditId = null, sceneEditIcon = 'lightbulb';
function sceneModeSelect(id, value) {
  return '<select class="field scene-mode" id="' + id + '" onchange="sceneEditorSync()">' +
    [['keep','Niet wijzigen'],['off','Uit'],['on','Aan']].map(function(o) { return '<option value="' + o[0] + '"' + (o[0] === value ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>';
}
function openSceneEditor(id) {
  var s = SCENE_DATA.scenes.filter(function(x) { return x.id === id; })[0] || { id: null, label: '', icon: 'lightbulb', led: {}, relay: {} };
  sceneEditId = s.id;
  sceneEditIcon = s.icon;
  var html = '<div class="scene-field"><label for="scene-name">Naam</label><input class="field" id="scene-name" maxlength="24" placeholder="bijv. Film kijken" value="' + escHtml(s.label) + '"></div>' +
    '<div class="scene-field"><label>Icoon</label><div class="scene-icons">' + SCENE_DATA.icons.map(function(ic) {
      return '<button type="button" class="scene-icon' + (ic === s.icon ? ' on' : '') + '" data-icon="' + ic + '" onclick="scenePickIcon(this)" aria-label="' + ic + '"><i class="fa-solid fa-' + ic + '"></i></button>';
    }).join('') + '</div></div>';
  SCENE_DATA.led.forEach(function(dev) {
    var cfg = (s.led || {})[dev];
    var mode = !cfg ? 'keep' : cfg.on ? 'on' : 'off';
    var effect = cfg && cfg.effect != null ? cfg.effect : 0;
    var bright = cfg && cfg.brightness != null ? cfg.brightness : 180;
    var col = cfg && cfg.color ? '#' + [cfg.color.r, cfg.color.g, cfg.color.b].map(function(v) { return ('0' + v.toString(16)).slice(-2); }).join('') : '#ffffff';
    html += '<div class="scene-device" data-led="' + dev + '"><div class="scene-device-head"><span>' + escHtml(sceneDeviceName('led::' + dev)) + '</span>' + sceneModeSelect('scene-led-' + dev, mode) + '</div>' +
      '<div class="scene-device-opts">' +
      '<select class="field scene-effect" onchange="sceneEditorSync()">' + LED_EFFECTS.map(function(name, i) { return '<option value="' + i + '"' + (i === effect ? ' selected' : '') + '>' + name + '</option>'; }).join('') + '</select>' +
      '<label class="scene-bright">Helderheid<input type="range" min="10" max="255" value="' + bright + '" class="scene-brightness"></label>' +
      '<label class="scene-color">Kleur<input type="color" value="' + col + '" class="scene-colorpick"></label>' +
      '</div></div>';
  });
  SCENE_DATA.relay.forEach(function(dev) {
    var cfg = (s.relay || {})[dev];
    html += '<div class="scene-device" data-relay="' + dev + '"><div class="scene-device-head"><span>' + escHtml(sceneDeviceName('relay::' + dev)) + '</span>' + sceneModeSelect('scene-relay-' + dev, !cfg ? 'keep' : cfg.on ? 'on' : 'off') + '</div></div>';
  });
  html += '<div class="form-error" id="scene-error" role="alert"></div>' +
    '<div class="modal-actions">' +
    (s.id ? '<button class="btn btn-danger" id="scene-delete" onclick="deleteScene(this)">Verwijderen</button>' : '') +
    '<span class="spacer"></span><button class="btn btn-quiet" onclick="closeSceneEditor()">Annuleren</button><button class="btn btn-primary" onclick="saveScene()">Opslaan</button></div>';
  document.getElementById('scene-modal-title').textContent = s.id ? 'Scène bewerken' : 'Nieuwe scène';
  document.getElementById('scene-modal-body').innerHTML = html;
  sceneEditorSync();
  openModal('scene-modal-overlay', closeSceneEditor);
}
function closeSceneEditor() { closeModal('scene-modal-overlay'); }
function scenePickIcon(btn) {
  sceneEditIcon = btn.dataset.icon;
  Array.prototype.forEach.call(document.querySelectorAll('.scene-icon'), function(b) { b.classList.toggle('on', b === btn); });
}
// extra instellingen alleen tonen bij "Aan"; de kleurkiezer alleen bij het effect "Eigen kleur"
function sceneEditorSync() {
  Array.prototype.forEach.call(document.querySelectorAll('.scene-device[data-led]'), function(row) {
    var on = row.querySelector('.scene-mode').value === 'on';
    row.querySelector('.scene-device-opts').style.display = on ? '' : 'none';
    row.querySelector('.scene-color').style.display = parseInt(row.querySelector('.scene-effect').value, 10) === LED_EFFECTS.length - 1 ? '' : 'none';
  });
}
function saveScene() {
  var scene = { id: sceneEditId, label: document.getElementById('scene-name').value, icon: sceneEditIcon, led: {}, relay: {} };
  Array.prototype.forEach.call(document.querySelectorAll('.scene-device[data-led]'), function(row) {
    var mode = row.querySelector('.scene-mode').value;
    if (mode === 'keep') return;
    var cfg = { on: mode === 'on' };
    if (cfg.on) {
      cfg.effect = parseInt(row.querySelector('.scene-effect').value, 10);
      cfg.brightness = parseInt(row.querySelector('.scene-brightness').value, 10);
      if (cfg.effect === LED_EFFECTS.length - 1) {
        var hex = row.querySelector('.scene-colorpick').value;
        cfg.color = { r: parseInt(hex.substr(1, 2), 16), g: parseInt(hex.substr(3, 2), 16), b: parseInt(hex.substr(5, 2), 16) };
      }
    }
    scene.led[row.dataset.led] = cfg;
  });
  Array.prototype.forEach.call(document.querySelectorAll('.scene-device[data-relay]'), function(row) {
    var mode = row.querySelector('.scene-mode').value;
    if (mode !== 'keep') scene.relay[row.dataset.relay] = { on: mode === 'on' };
  });
  fetch('/api/scenes', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(scene)})
    .then(function(r){return r.json();}).then(function(d) {
      if (!d.ok) { document.getElementById('scene-error').textContent = d.error || 'Opslaan mislukt'; return; }
      closeSceneEditor();
      loadScenes();
      toast('Scène opgeslagen', 'ok');
    }).catch(function() { document.getElementById('scene-error').textContent = 'Verbindingsfout'; });
}
function deleteScene(btn) {
  // eerste tik vraagt om bevestiging, de tweede verwijdert
  if (!btn.dataset.sure) { btn.dataset.sure = '1'; btn.textContent = 'Zeker weten?'; return; }
  fetch('/api/scenes/delete', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({id: sceneEditId})})
    .then(function(r){return r.json();}).then(function() { closeSceneEditor(); loadScenes(); toast('Scène verwijderd', 'ok'); })
    .catch(function() { document.getElementById('scene-error').textContent = 'Verbindingsfout'; });
}
loadScenes();


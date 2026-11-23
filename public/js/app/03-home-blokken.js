// Thuis-pagina: wasmachine, ESPHome-kaarten en het layout-/blokkensysteem. Opgesplitst in
// 03 / 03b / 03c voor overzicht; alle delen komen in dezelfde app.js-bundle (zie routes/pages.js).
// ── Wasmachine ──
var chartWashWeekday = null;function loadWashWeekdayChart() { if (!document.getElementById('chart-wash-weekday')) return; fetch('/api/wasmachine/weekday').then(function(r){return r.json();}).then(function(rows) { var dayNames = ['Zo','Ma','Di','Wo','Do','Vr','Za']; var byDow = {}; rows.forEach(function(r){ byDow[parseInt(r.dow,10)] = r; }); var labels = [], data = []; for (var d = 0; d < 7; d++) { labels.push(dayNames[d]); var r = byDow[d]; data.push(r ? r.n : 0); } if (chartWashWeekday) chartWashWeekday.destroy(); chartWashWeekday = new Chart(document.getElementById('chart-wash-weekday'), { type: 'bar', data: { labels: labels, datasets: [{ label: 'Aantal wasbeurten', data: data, backgroundColor: 'rgba(141,178,85,0.55)', borderColor: '#8DB255', borderWidth: 1, borderRadius: 4 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: CHART_TEXT, font: { size: 11, weight: '600' } }, grid: { color: CHART_GRID } }, y: { ticks: { color: CHART_TICK, font: { size: 11 }, precision: 0 }, grid: { color: CHART_GRID }, beginAtZero: true } } } }); }).catch(function(){}); }

// Wasmachine als minimale uniforme kaart: statusbadge + aantal wasbeurten + uitklapbare vermogensgrafiek.
function refreshWasmachine() {
  var grid = document.getElementById('wash-grid');
  Promise.all([
    fetch('/api/wasmachine/status').then(function(r){return r.json();}).catch(function(){return {};}),
    fetch('/api/wasmachine/stats').then(function(r){return r.json();}).catch(function(){return {};})
  ]).then(function(res) {
    var s = res[0] || {}, st = res[1] || {};
    var hwt = document.getElementById('home-wash-total'); if (hwt) hwt.textContent = st.total != null ? st.total : '—';
    if (!grid) return;
    var state = s.state || 'idle';
    var badge = state === 'running' ? { cls: 'busy', icon: 'fa-rotate', text: 'In gebruik' }
      : state === 'done' ? { cls: 'busy', icon: 'fa-circle-check', text: 'Klaar' }
      : { cls: 'idle', icon: 'fa-moon', text: 'Inactief' };
    // Huidig verbruik (W) wordt in-place bijgewerkt door refreshTapoCard via id 'wash-power' — daarom
    // buiten de sig gehouden, zodat de kaart niet elke 3s herbouwt (en een open grafiek blijft staan).
    var values = ['<span id="wash-power">—</span>', (st.total != null ? st.total : 0) + ' wasbeurten'];
    if (st.today != null) values.push(st.today + ' vandaag');
    var sub = s.since && state === 'running' ? 'sinds ' + shortWhen(s.since)
      : st.last_finished_at ? 'Laatste: ' + shortWhen(st.last_finished_at) : '';
    var cfg = {
      id: 'wash', icon: 'fa-shirt', name: 'Wasmachine', badge: badge, values: values, sub: sub,
      sig: values.join(',') + '|' + badge.text,
      ranges: [['day', 'Dag'], ['week', 'Week'], ['month', 'Maand']],
      chart: { url: '/api/tapo/power-history', key: null, series: [{ field: 'watts', unit: 'W', color: '#8DB255', decimals: 1, label: 'Vermogen', axis: 'y' }] }
    };
    paintSensorGrid(grid, [cfg]);
  }).catch(function(){});
}
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
// Thuis-pagina: één uniforme kaart per ESPHome-device. Alle sensoren van dat device staan als rijen in
// de kaart, met een uitklapbare grafiek die elke numerieke sensor als lijn toont (max 2 assen per eenheid).
function esphomeDeviceCardCfg(device, list) {
  var newest = Math.max.apply(null, list.map(function(r) { return new Date(r.received_at).getTime(); }));
  var rows = list.map(function(r) {
    var valStr = r.value != null ? nlNum(r.value, 1) + (r.unit ? ' ' + r.unit : '') : escHtml(r.value_text || '—');
    var pen = '<button class="icon-btn icon-btn-sm" aria-label="Naam wijzigen" title="Naam wijzigen" onclick="esphomeRename(\'' + encodeURIComponent(r.device) + '\',\'' + encodeURIComponent(r.sensor_name) + '\',this)"><i class="fa-solid fa-pen"></i></button>';
    return '<div class="esp-row"><span class="esp-name"><span>' + escHtml(r.display_name || r.sensor_name) + '</span>' + pen + '</span><span class="esp-val">' + valStr + '</span></div>';
  }).join('');
  var cfg = {
    id: 'esp-' + sensorSlug(device), icon: 'fa-microchip', name: device,
    meta: sensorAge(newest), values: [], controls: rows,
    sig: list.map(function(r) { return r.sensor_name + '=' + (r.value != null ? r.value : r.value_text); }).join('|')
  };
  var numeric = list.filter(function(r) { return r.value != null; });
  if (numeric.length) {
    var units = []; numeric.forEach(function(s) { var u = s.unit || ''; if (units.indexOf(u) === -1) units.push(u); });
    cfg.chart = {
      url: '/api/esphome/history', groupBy: 'sensor_name', valueField: 'avg_value',
      names: numeric.map(function(s) { return s.sensor_name; }),
      labelByName: numeric.reduce(function(m, s) { m[s.sensor_name] = s.display_name || s.sensor_name; return m; }, {}),
      unitByName: numeric.reduce(function(m, s) { m[s.sensor_name] = s.unit || ''; return m; }, {}),
      units: units
    };
  }
  return cfg;
}
function refreshEsphome() { fetch('/api/esphome/latest').then(function(r){return r.json();}).then(function(rows) {
  var grid = document.getElementById('esphome-grid'); if (!grid) return;
  var byDevice = {}, order = [];
  (rows || []).forEach(function(r) { var d = r.device || '?'; if (!byDevice[d]) { byDevice[d] = []; order.push(d); } byDevice[d].push(r); });
  paintSensorGrid(grid, order.map(function(d) { return esphomeDeviceCardCfg(d, byDevice[d]); }));
}).catch(function(){}); }
// ── Layout system ──
var layoutConfig = {};
var layoutEditMode = false;
// Home heeft in de tabletweergave een eigen indeling
function layoutKey(screenIdx) { return screenIdx === 0 && KIOSK && layoutConfig.kiosk ? 'kiosk' : String(screenIdx); }

// Blokken die bij een module horen verdwijnen als die module uit staat
var BLOCK_MODULE = { outages:'storingen', rain:'regen', traffic:'files', p2000:'p2000', ziggo:'ziggo', internet:'internet', camera:'camera',weather:'weather', afval:'afval', led_default:'lights', led_keuken:'lights', led_gang:'lights', led_tv_meubel:'lights', relay_gang:'lights', scenes:'lights', fridge:'fridge', temperature_grid:'temperature', chart_temp_mini:'temperature', esphome_grid:'esphome', wasmachine_quick:'wasmachine', gas_today:'gas', tado_heating:'tado' };
function blockEnabled(type) { return !BLOCK_MODULE[type] || moduleOn(BLOCK_MODULE[type]); }

var BLOCKS = {
  'weather':          {label:'Weer',              icon:'fa-cloud-sun',       dynamic:false},
  'power_live':       {label:'Live verbruik',      icon:'fa-bolt',            dynamic:false},
  'info_stats':       {label:'Statistieken',        icon:'fa-chart-pie',       dynamic:false},
  'led_default':      {label:'LED Strip',             icon:'fa-lightbulb',       dynamic:false},
  'led_keuken':       {label:'Ledstrip Keuken',       icon:'fa-lightbulb',       dynamic:false},
  'led_gang':         {label:'Ledstrip Gang',          icon:'fa-lightbulb',       dynamic:false},
  'led_tv_meubel':    {label:'LED TV Meubel',           icon:'fa-lightbulb',       dynamic:false},
  'relay_gang':       {label:'Lamp Gang',              icon:'fa-toggle-on',       dynamic:false},
  'phases':           {label:'Fases L1/L2/L3',     icon:'fa-plug-circle-bolt',dynamic:false},
  'recent_readings':  {label:'Recente metingen',   icon:'fa-table',           dynamic:false},
  'temperature_grid': {label:'Temperatuur',         icon:'fa-temperature-half',dynamic:true,
    render: function(el) { el.innerHTML = '<div class="section-title">Temperatuur</div><div class="temp-grid" id="dyn-temp-grid"></div>'; },
    refresh: function() { fetch('/api/temperature/latest').then(function(r){return r.json();}).then(function(rows){ var g=document.getElementById('dyn-temp-grid'); if(!g) return; if(!rows.length){g.innerHTML='<div class="temp-card"><div class="temp-room">Nog geen data</div></div>';return;} g.innerHTML=rows.map(function(r){var age=Math.round((Date.now()-new Date(r.received_at).getTime())/60000);var ageText=age<60?age+' min geleden':Math.round(age/60)+' uur geleden';var hum=r.humidity!=null?'<div class="temp-age">'+r.humidity+' % vocht</div>':'';return '<div class="temp-card"><i class="fa-solid fa-temperature-half"></i><div class="temp-room">'+escHtml(r.room)+'</div><div class="temp-value">'+(r.temp_c!=null?nlNum(r.temp_c,1):'—')+' °C</div>'+hum+'<div class="temp-age">'+ageText+'</div></div>';}).join('');}).catch(function(){}); }
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
  },
  // tado° X: huidige kamertemperaturen op Home. Leest de server-cache (/api/tado), dus geen extra tado-API-verzoeken.
  'tado_heating': {label:'Verwarming (tado)',icon:'fa-temperature-arrow-up',dynamic:true,
    render:function(el){el.innerHTML='<div class="section-title">Verwarming</div><div class="temp-grid" id="dyn-tado-grid"></div>';},
    refresh:function(){fetch('/api/tado').then(function(r){return r.json();}).then(function(d){var g=document.getElementById('dyn-tado-grid');if(!g)return;var rooms=(d.zones||[]).filter(function(z){return z.view!=='thuis'&&z.view!=='hidden';});if(!d.linked||!rooms.length){g.innerHTML='<div class="temp-card"><div class="temp-room">'+(d.linked?'Geen kamers hier':'Niet gekoppeld')+'</div></div>';return;}g.innerHTML=rooms.map(function(z){var sub=z.power==='OFF'?'uit':(z.setpoint!=null?'→ '+nlNum(z.setpoint,z.setpoint%1?1:0)+'°':'');if(z.online&&z.heatingPower>0)sub+=(sub?' · ':'')+'🔥 '+Math.round(z.heatingPower)+'%';var icon=!z.online?'fa-plug-circle-xmark':z.heatingPower>0?'fa-fire':'fa-temperature-half';return '<div class="temp-card"><i class="fa-solid '+icon+'"></i><div class="temp-room">'+escHtml(z.name)+'</div><div class="temp-value">'+(z.temperature!=null?nlNum(z.temperature,1):'—')+' °C</div><div class="temp-age">'+sub+'</div></div>';}).join('');}).catch(function(){});}
  }
};


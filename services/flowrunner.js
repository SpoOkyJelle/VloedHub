var state   = require('../utils/state');
var dbModule = require('../db/setup');
var discord = require('./discord');
var weather = require('./weather');
var sun     = require('./sun');
var prices  = require('./prices');
var fridge  = require('./fridge');
var afval   = require('./afval');
var monitor = require('./monitor');
var modules = require('./modules');
var scenes  = require('../routes/scenes');
var costs   = require('../routes/costs');
var auth    = require('./auth');
var homeconnect = require('./homeconnect');
var http    = require('http');
var https   = require('https');

// ── Node categories ────────────────────────────────────────────────────────
var TRIGGERS = {
  timer: 1, power_above: 1, power_below: 1, temp_above: 1, temp_below: 1,
  wash_done: 1, wash_started: 1, gas_above: 1, voltage_dip: 1,
  phase_imbalance: 1, solar_above: 1, solar_below: 1, weather_rain: 1,
  sunrise: 1, sunset: 1, webhook_trigger: 1, mqtt_trigger: 1,
  afval_pickup: 1, price_below: 1, price_above: 1, fridge_temp_above: 1, device_offline: 1,
  dish_started: 1, dish_done: 1, dish_alert: 1
};

var LOGIC = { delay: 1, time_window: 1, condition: 1 };

// ── Helpers ────────────────────────────────────────────────────────────────
function hexToRgb(hex) {
  hex = (hex || '#ffffff').replace('#', '');
  if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  return {
    r: parseInt(hex.slice(0,2), 16) || 255,
    g: parseInt(hex.slice(2,4), 16) || 255,
    b: parseInt(hex.slice(4,6), 16) || 255
  };
}

// Tanner Helland algorithm: Kelvin (1000–40000) → {r,g,b} (0–255)
function kelvinToRgb(kelvin) {
  var temp = Math.max(1000, Math.min(40000, kelvin)) / 100;
  var r, g, b;

  // Red
  if (temp <= 66) {
    r = 255;
  } else {
    r = temp - 60;
    r = 329.698727446 * Math.pow(r, -0.1332047592);
    r = Math.max(0, Math.min(255, r));
  }

  // Green
  if (temp <= 66) {
    g = temp;
    g = 99.4708025861 * Math.log(g) - 161.1195681661;
  } else {
    g = temp - 60;
    g = 288.1221695283 * Math.pow(g, -0.0755148492);
  }
  g = Math.max(0, Math.min(255, g));

  // Blue
  if (temp >= 66) {
    b = 255;
  } else if (temp <= 19) {
    b = 0;
  } else {
    b = temp - 10;
    b = 138.5177312231 * Math.log(b) - 305.0447927307;
    b = Math.max(0, Math.min(255, b));
  }

  return { r: Math.round(r), g: Math.round(g), b: Math.round(b) };
}

function amsHour() {
  var t = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Amsterdam' });
  var hm = t.slice(11, 16);
  var parts = hm.split(':');
  return parseInt(parts[0]) + parseInt(parts[1]) / 60;
}

function amsTime() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Amsterdam' }).slice(11, 16);
}

// Last known sun times — refreshed every checkAll cycle
var cachedSunTimes = null;

function resolveTime(type, value) {
  if (type === 'sunrise' || type === 'sunset') {
    if (!cachedSunTimes) return null;
    var base = type === 'sunrise' ? cachedSunTimes.sunrise : cachedSunTimes.sunset;
    return addMinutes(base, parseInt(value) || 0);
  }
  return value || '00:00';
}

function timeInWindow(startType, startVal, endType, endVal) {
  var start = resolveTime(startType, startVal);
  var end   = resolveTime(endType,   endVal);
  if (!start || !end) return false;
  var now = amsTime();
  return start <= end
    ? (now >= start && now <= end)
    : (now >= start || now <= end); // overnight e.g. 22:00–06:00
}

// Vult {naam} in een bericht in met waarden uit de trigger, bijv. {afval} of {apparaat}
function fillMessage(msg, ctx) {
  var vars = (ctx && ctx.vars) || {};
  return msg.replace(/\{(\w+)\}/g, function(m, key) { return vars[key] != null ? vars[key] : m; });
}

// ── Execute action node ────────────────────────────────────────────────────
function executeNode(node, ctx) {
  var device = node.data.device || 'default';
  var ls;

  if (node.name === 'led_on') {
    ls = state.getLedState(device);
    ls.on = true;
    if (node.data.brightness != null) ls.brightness = Math.max(0, Math.min(255, parseInt(node.data.brightness) || 180));
    if (node.data.color) ls.color = hexToRgb(node.data.color);
    console.log('[Flow] LED aan:', device, ls);
    return { action: 'led_on', device: device };
  }

  if (node.name === 'led_off') {
    state.getLedState(device).on = false;
    console.log('[Flow] LED uit:', device);
    return { action: 'led_off', device: device };
  }

  if (node.name === 'led_effect') {
    ls = state.getLedState(device);
    ls.effect = parseInt(node.data.effect) || 0;
    if (node.data.brightness != null) ls.brightness = Math.max(0, Math.min(255, parseInt(node.data.brightness) || ls.brightness));
    if (node.data.color) ls.color = hexToRgb(node.data.color);
    ls.on = true;
    console.log('[Flow] LED effect:', device, 'effect=' + ls.effect);
    return { action: 'led_effect', device: device, effect: ls.effect };
  }

  if (node.name === 'relay_on') {
    state.getRelayState(device).on = true;
    console.log('[Flow] Relais aan:', device);
    return { action: 'relay_on', device: device };
  }

  if (node.name === 'relay_off') {
    state.getRelayState(device).on = false;
    console.log('[Flow] Relais uit:', device);
    return { action: 'relay_off', device: device };
  }

  if (node.name === 'notify') {
    var msg = fillMessage((node.data.message || 'VloedHub flow getriggerd').trim(), ctx);
    discord.notify('flow', '\uD83D\uDD14 ' + msg, (node.data.webhook || '').trim());
    console.log('[Flow] Melding:', msg);
    return { action: 'notify', message: msg };
  }

  if (node.name === 'webhook') {
    var webhookUrl = (node.data.url || '').trim();
    var webhookBody = (node.data.body || '').trim();
    if (webhookUrl) {
      var mod = webhookUrl.startsWith('https') ? https : http;
      try {
        var parsed = require('url').parse(webhookUrl);
        var reqOpts = {
          hostname: parsed.hostname,
          port: parsed.port,
          path: parsed.path || '/',
          method: 'POST',
          headers: { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(webhookBody) }
        };
        var outReq = mod.request(reqOpts, function(r) {
          r.resume(); // discard response
        });
        outReq.on('error', function(e) { console.error('[Flow] webhook error:', e.message); });
        outReq.write(webhookBody);
        outReq.end();
      } catch(e) { console.error('[Flow] webhook error:', e.message); }
    }
    console.log('[Flow] Webhook POST:', webhookUrl);
    return { action: 'webhook', url: webhookUrl };
  }

  if (node.name === 'dim_to') {
    var dimDevice = node.data.device || 'default';
    var dimTarget = Math.max(0, Math.min(255, parseInt(node.data.brightness) || 180));
    var dimSecs   = Math.max(1, Math.min(300, parseInt(node.data.seconds) || 5));
    var dimLs     = state.getLedState(dimDevice);
    var dimStart  = dimLs.brightness || 0;
    var dimSteps  = dimSecs * 30; // ~30fps
    var dimStep   = 0;
    dimLs.on = true;
    var dimInterval = setInterval(function() {
      dimStep++;
      dimLs.brightness = Math.round(dimStart + (dimTarget - dimStart) * (dimStep / dimSteps));
      if (dimStep >= dimSteps) {
        dimLs.brightness = dimTarget;
        clearInterval(dimInterval);
      }
    }, Math.round(1000 / 30));
    console.log('[Flow] dim_to:', dimDevice, dimStart, '->', dimTarget, 'in', dimSecs, 's');
    return { action: 'dim_to', device: dimDevice, target: dimTarget };
  }

  if (node.name === 'dim_relative') {
    var relDevice = node.data.device || 'default';
    var relDelta  = Math.max(-100, Math.min(100, parseFloat(node.data.delta) || 20));
    var relLs     = state.getLedState(relDevice);
    var relNew    = Math.max(0, Math.min(255, Math.round(relLs.brightness + relDelta / 100 * 255)));
    relLs.brightness = relNew;
    console.log('[Flow] dim_relative:', relDevice, 'delta=' + relDelta + '% new=' + relNew);
    return { action: 'dim_relative', device: relDevice, brightness: relNew };
  }

  if (node.name === 'color_temp') {
    var ctDevice = node.data.device || 'default';
    var ctKelvin = Math.max(2000, Math.min(6500, parseInt(node.data.kelvin) || 3000));
    var ctLs     = state.getLedState(ctDevice);
    ctLs.color   = kelvinToRgb(ctKelvin);
    ctLs.on      = true;
    console.log('[Flow] color_temp:', ctDevice, ctKelvin + 'K', ctLs.color);
    return { action: 'color_temp', device: ctDevice, kelvin: ctKelvin };
  }

  if (node.name === 'adaptive_light') {
    var alDevice = node.data.device || 'default';
    var alLs     = state.getLedState(alDevice);
    var alHour   = amsHour();
    var alBrightness, alKelvin;
    if (alHour >= 10 && alHour < 17) {
      alBrightness = 230; alKelvin = 6500; // Daytime: bright + cool
    } else if (alHour >= 17 && alHour < 22) {
      alBrightness = 160; alKelvin = 3000; // Evening: medium + warm
    } else if (alHour >= 22 || alHour < 2) {
      alBrightness = 60;  alKelvin = 2200; // Night: dim + warm
    } else {
      alBrightness = 20;  alKelvin = 2000; // Very dim warm
    }
    alLs.brightness = alBrightness;
    alLs.color      = kelvinToRgb(alKelvin);
    alLs.on         = true;
    console.log('[Flow] adaptive_light:', alDevice, alBrightness, alKelvin + 'K');
    return { action: 'adaptive_light', device: alDevice, brightness: alBrightness, kelvin: alKelvin };
  }

  if (node.name === 'wake_light') {
    var wlDevice  = node.data.device || 'default';
    var wlTarget  = Math.max(0, Math.min(255, parseInt(node.data.brightness) || 200));
    var wlMins    = Math.max(1, Math.min(60, parseInt(node.data.minutes) || 30));
    var wlLs      = state.getLedState(wlDevice);
    var wlSteps   = wlMins * 60 * 30; // 30fps equivalent steps
    var wlStep    = 0;
    wlLs.brightness = 0;
    wlLs.on = true;
    var wlInterval = setInterval(function() {
      wlStep++;
      wlLs.brightness = Math.round(wlTarget * wlStep / wlSteps);
      if (wlStep >= wlSteps) {
        wlLs.brightness = wlTarget;
        clearInterval(wlInterval);
      }
    }, Math.round(1000 / 30));
    console.log('[Flow] wake_light:', wlDevice, '0 ->', wlTarget, 'in', wlMins, 'min');
    return { action: 'wake_light', device: wlDevice, target: wlTarget };
  }

  if (node.name === 'flash') {
    var flDevice   = node.data.device || 'default';
    var flTimes    = Math.max(1, Math.min(20, parseInt(node.data.times) || 3));
    var flInterval = Math.max(100, Math.min(5000, parseInt(node.data.interval_ms) || 500));
    var flLs       = state.getLedState(flDevice);
    var flOrigOn   = flLs.on;
    var flCount    = 0;
    function flashTick() {
      if (flCount >= flTimes * 2) {
        flLs.on = flOrigOn; // restore original state
        return;
      }
      flLs.on = (flCount % 2 === 0); // even = on, odd = off
      flCount++;
      setTimeout(flashTick, flInterval);
    }
    flashTick();
    console.log('[Flow] flash:', flDevice, flTimes, 'x', flInterval + 'ms');
    return { action: 'flash', device: flDevice, times: flTimes };
  }

  if (node.name === 'telegram') {
    var tgToken  = (node.data.token   || '').trim();
    var tgChatId = (node.data.chat_id || '').trim();
    var tgMsg    = fillMessage((node.data.message || 'VloedHub flow getriggerd').trim(), ctx);
    if (tgToken && tgChatId) {
      var tgBody = JSON.stringify({ chat_id: tgChatId, text: tgMsg });
      var tgPath = '/bot' + tgToken + '/sendMessage';
      var tgReq  = https.request({
        hostname: 'api.telegram.org',
        path: tgPath,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(tgBody) }
      }, function(r) { r.resume(); });
      tgReq.on('error', function(e) { console.error('[Flow] telegram error:', e.message); });
      tgReq.write(tgBody);
      tgReq.end();
    }
    console.log('[Flow] Telegram:', tgChatId, tgMsg);
    return { action: 'telegram', chat_id: tgChatId, message: tgMsg };
  }

  if (node.name === 'scene') {
    var sceneId = node.data.scene || 'all_off';
    scenes.run(sceneId);
    console.log('[Flow] Scène:', sceneId);
    return { action: 'scene', scene: sceneId };
  }

  if (node.name === 'mqtt_publish') {
    var mqttSvc = require('./mqtt');
    mqttSvc.publish(
      node.data.broker   || 'mqtt://localhost:1883',
      node.data.topic    || '',
      node.data.message  || '',
      node.data.username || '',
      node.data.password || ''
    );
    console.log('[Flow] MQTT publish:', node.data.topic);
    return { action: 'mqtt_publish', topic: node.data.topic };
  }

  return null;
}

// ── Evaluate condition node ────────────────────────────────────────────────
function evaluateCondition(node, ctx) {
  var check = node.data.check || 'power_above';
  var value = parseFloat(node.data.value) || 0;
  var room  = (node.data.room || '').toLowerCase().trim();

  switch (check) {
    case 'power_above':  return (ctx.watts      || 0) > value;
    case 'power_below':  return (ctx.watts      || 0) < value;
    case 'solar_above':  return (ctx.solarWatts || 0) > value;
    case 'solar_below':  return (ctx.solarWatts || 0) < value;
    case 'temp_above':   return ((ctx.temps || {})[room] || 0) > value;
    case 'temp_below':   return ((ctx.temps || {})[room] || 999) < value;
    case 'rain_above':   return (ctx.rainProb   || 0) > value;
    case 'price_below':  return ctx.price != null && ctx.price < value;
    case 'price_above':  return ctx.price != null && ctx.price > value;
    case 'fridge_above': return (ctx.fridge || {}).refrigerator != null && ctx.fridge.refrigerator > value;
    case 'afval_tomorrow': return (ctx.afvalTomorrow || []).length > 0;
    case 'time_between': return timeInWindow(node.data.timestart || '00:00', node.data.timeend || '23:59');
    default: return false;
  }
}

// ── Graph traversal ────────────────────────────────────────────────────────
function traverseFrom(allNodes, nodeId, ctx, visited, results) {
  var node = allNodes[nodeId];
  if (!node || visited[node.id]) return;
  visited[node.id] = true;

  function followAll() {
    Object.values(node.outputs || {}).forEach(function(out) {
      (out.connections || []).forEach(function(conn) {
        traverseFrom(allNodes, conn.node, ctx, visited, results);
      });
    });
  }

  // Trigger nodes just pass through (they don't execute)
  if (TRIGGERS[node.name]) { followAll(); return; }

  if (node.name === 'delay') {
    var ms = Math.min((parseInt(node.data.seconds) || 1) * 1000, 3600000);
    var capturedNode  = node;
    var capturedNodes = allNodes;
    var capturedCtx   = ctx;
    setTimeout(function() {
      Object.values(capturedNode.outputs || {}).forEach(function(out) {
        (out.connections || []).forEach(function(conn) {
          traverseFrom(capturedNodes, conn.node, capturedCtx, {}, []);
        });
      });
    }, ms);
    return; // stop sync chain here
  }

  if (node.name === 'time_window') {
    var twStartType = node.data['start-type'] || 'time';
    var twEndType   = node.data['end-type']   || 'time';
    var twStart     = node.data.start  || '00:00';
    var twEnd       = node.data.end    || '23:59';
    if (timeInWindow(twStartType, twStart, twEndType, twEnd)) followAll();
    return;
  }

  if (node.name === 'condition') {
    var passed = evaluateCondition(node, ctx);
    var outKey = passed ? 'output_1' : 'output_2';
    var out = (node.outputs || {})[outKey];
    if (out) {
      (out.connections || []).forEach(function(conn) {
        traverseFrom(allNodes, conn.node, ctx, visited, results);
      });
    }
    return;
  }

  // Normal action node
  var r = executeNode(node, ctx);
  if (r) results.push(r);
  followAll();
}

function traverseOutputs(startNode, allNodes, ctx, flowId) {
  var results = [];
  var visited = {};
  Object.values(startNode.outputs || {}).forEach(function(out) {
    (out.connections || []).forEach(function(conn) {
      traverseFrom(allNodes, conn.node, ctx || {}, visited, results);
    });
  });

  // Record run in flow_runs and update last_run on flows
  if (flowId != null) {
    var nowTs = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Amsterdam' }).replace(' ', 'T');
    var actionsJson = JSON.stringify(results);
    dbModule.run(
      'INSERT INTO flow_runs (flow_id, triggered_at, actions) VALUES (?,?,?)',
      [flowId, nowTs, actionsJson],
      function() {}
    );
    dbModule.run(
      'UPDATE flows SET last_run = ? WHERE id = ?',
      [nowTs, flowId],
      function() {}
    );
    // Keep only last 100 runs per flow
    dbModule.run(
      'DELETE FROM flow_runs WHERE flow_id = ? AND id NOT IN (SELECT id FROM flow_runs WHERE flow_id = ? ORDER BY id DESC LIMIT 100)',
      [flowId, flowId],
      function() {}
    );
  }

  return results;
}

// ── Context gathering (current sensor values from DB) ─────────────────────
function gatherContext(db, callback) {
  db.get('SELECT * FROM readings ORDER BY id DESC LIMIT 1', function(err, row) {
    var ctx = { watts: 0, solarWatts: 0, temps: {}, voltages: [], powers: [], gasRate: 0, rainProb: 0, washState: null, cycleCount: 0 };

    if (row) {
      ctx.watts      = Math.round((row.power_delivered_total_kw || 0) * 1000);
      ctx.solarWatts = Math.round((row.power_returned_total_kw  || 0) * 1000);
      ctx.voltages   = [row.voltage_l1, row.voltage_l2, row.voltage_l3].filter(function(v) { return v != null; });
      ctx.powers     = [row.power_delivered_l1_kw, row.power_delivered_l2_kw, row.power_delivered_l3_kw]
                         .filter(function(v) { return v != null; })
                         .map(function(v) { return v * 1000; });

      // Phase imbalance: max deviation from average as %
      if (ctx.powers.length > 1) {
        var avg = ctx.powers.reduce(function(a,b) { return a+b; }, 0) / ctx.powers.length;
        var maxDev = Math.max.apply(null, ctx.powers.map(function(p) { return Math.abs(p - avg); }));
        ctx.phaseImbalancePct = avg > 10 ? Math.round(maxDev / avg * 100) : 0;
      }
    }

    // Gas rate from last 2 readings with gas data
    db.all('SELECT gas_m3, received_at FROM readings WHERE gas_m3 IS NOT NULL ORDER BY id DESC LIMIT 2', function(err2, gasRows) {
      if (gasRows && gasRows.length === 2) {
        var delta_m3 = gasRows[0].gas_m3 - gasRows[1].gas_m3;
        var t0 = new Date(gasRows[0].received_at);
        var t1 = new Date(gasRows[1].received_at);
        var delta_h = Math.abs(t0 - t1) / 3600000;
        ctx.gasRate = delta_h > 0 && delta_h < 1 ? delta_m3 / delta_h : 0; // ignore if gap > 1h
      }

      // Latest temp per room (last 15 min)
      var cutoff = new Date(Date.now() - 15 * 60 * 1000)
        .toLocaleString('sv-SE', { timeZone: 'Europe/Amsterdam' }).replace(' ', 'T');

      db.all('SELECT room, temp_c FROM temperature_readings WHERE received_at >= ? ORDER BY received_at DESC', [cutoff], function(err3, tempRows) {
        (tempRows || []).forEach(function(r) {
          var key = r.room.toLowerCase();
          if (ctx.temps[key] === undefined) ctx.temps[key] = r.temp_c;
        });

        db.get('SELECT state FROM wasmachine_status WHERE id = 1', function(err4, washRow) {
          ctx.washState = washRow ? washRow.state : null;

          db.get('SELECT COUNT(*) AS cnt FROM wasmachine_cycles', function(err5, cycleRow) {
            ctx.cycleCount = cycleRow ? cycleRow.cnt : 0;

            // Weather (from cache — non-blocking)
            weather.fetchWeather(function(wErr, wData) {
              if (!wErr && wData) ctx.rainProb = wData.precipitation_probability || 0;
              gatherExtras(ctx, callback);
            });
          });
        });
      });
    });
  });
}

// Stroomprijs, koelkast, afval en offline apparaten. Elke bron heeft zijn eigen cache;
// een bron die niet is ingesteld of uit staat wordt overgeslagen.
var lastCtx = {};

function gatherExtras(ctx, callback) {
  ctx.vars = {};
  prices.fetchPrices(function(pErr, p) {
    if (!pErr && p && p.electricity_eur_kwh != null) {
      ctx.price = p.electricity_eur_kwh;
      ctx.vars.prijs = '\u20AC' + p.electricity_eur_kwh.toFixed(2).replace('.', ',');
    }
    var useFridge = modules.isOn('fridge') && fridge.getConfig();
    (useFridge ? fridge.fetchStatus : function(cb) { cb(null, null); })(function(fErr, f) {
      ctx.fridge = {};
      if (f && f.ok) {
        f.compartments.forEach(function(c) { if (c.temp != null) ctx.fridge[c.key] = c.temp; });
        if (ctx.fridge.refrigerator != null) ctx.vars.koelkast = ctx.fridge.refrigerator + '\u00B0';
        if (ctx.fridge.freezer != null) ctx.vars.vriezer = ctx.fridge.freezer + '\u00B0';
      }
      (modules.isOn('afval') ? afval.fetchCalendar : function(cb) { cb(null, null); })(function(aErr, a) {
        ctx.afvalTomorrow = (a && a.configured && a.pickups) ? a.pickups.filter(function(x) { return x.days === 1; }).map(function(x) { return x.label; }) : [];
        monitor.getStatus(function(list) {
          // null zolang de bewaking na een herstart nog niets kan zeggen
          ctx.offline = monitor.isReady() ? list.filter(function(d) { return !d.online; }) : null;
          if (modules.isOn('vaatwasser')) {
            var hc = homeconnect.getStatus();
            ctx.dish = { operation: hc.state.operation, alerts: hc.alerts };
            ctx.vars.vaatwasser_programma = homeconnect.programName(hc.state.program) || '\u2014';
            ctx.vars.vaatwasser_melding = hc.alerts.join(', ') || '\u2014';
          }
          costs.overview(function(o) {
            addCostVars(ctx.vars, o);
            lastCtx = ctx;
            callback(ctx);
          });
        });
      });
    });
  });
}

// Kostenvariabelen voor meldingen: {kosten_maand}, {kosten_verwacht}, {kosten_dag}, {kosten_jaar}, {sluipkosten},
// en van de afgelopen maand {vorige_maand}, {kosten_vorige_maand}, {stroom_vorige_maand}, {gas_vorige_maand}.
// Wat (nog) niet te berekenen is wordt een streepje, zodat er geen losse {accolades} in een bericht blijven staan.
function addCostVars(vars, o) {
  function eur(v, digits) { return v != null ? '\u20AC' + Number(v).toFixed(digits != null ? digits : 2).replace('.', ',') : '\u2014'; }
  function total(m) { return m && (m.elec_cost != null || m.gas_cost != null) ? (m.elec_cost || 0) + (m.gas_cost || 0) : null; }
  o = o || {};
  var thisMonth = (o.today || '').slice(0, 7);
  var prev = (o.months || []).filter(function(m) { return m.month < thisMonth; }).pop();
  vars.kosten_maand = eur(o.month && o.month.total);
  vars.kosten_verwacht = eur(o.forecast_month);
  vars.kosten_dag = eur(o.avg_day && o.avg_day.total);
  vars.kosten_jaar = eur(o.forecast_year, 0);
  vars.sluipkosten = eur(o.recent && o.recent.standby && o.recent.standby.cost_year, 0);
  vars.vorige_maand = prev ? new Date(prev.month + '-15T12:00:00Z').toLocaleDateString('nl-NL', { month: 'long', timeZone: 'UTC' }) : '\u2014';
  vars.kosten_vorige_maand = eur(total(prev));
  vars.stroom_vorige_maand = eur(prev && prev.elec_cost);
  vars.gas_vorige_maand = eur(prev && prev.gas_cost);
}

// ── Standaardflows ─────────────────────────────────────────────────────────
// Worden één keer aangemaakt; welke er al zijn geweest staat in de configuratie, zodat een flow die je
// weggooit niet bij de volgende herstart terugkomt.
var DEFAULT_FLOWS = [{
  key: 'kostenoverzicht',
  name: 'Kostenoverzicht (elke maand)',
  // timer (08:00 op de eerste van de maand) → melding
  data: { drawflow: { Home: { data: {
    '1': { id: 1, name: 'timer', data: { time: '08:00', days: 'month_first' }, class: 'timer', html: '', typenode: false,
           inputs: {}, outputs: { output_1: { connections: [{ node: '2', output: 'input_1' }] } }, pos_x: 80, pos_y: 120 },
    '2': { id: 2, name: 'notify', data: { webhook: '', message:
             '**Kostenoverzicht {vorige_maand}**\n' +
             'Totaal: {kosten_vorige_maand} (stroom {stroom_vorige_maand}, gas {gas_vorige_maand})\n' +
             'Gemiddeld per dag nu: {kosten_dag}\n' +
             'Sluipverbruik: {sluipkosten} per jaar\n' +
             'Op jaarbasis: {kosten_jaar}' },
           class: 'notify', html: '', typenode: false,
           inputs: { input_1: { connections: [{ node: '1', input: 'output_1' }] } }, outputs: {}, pos_x: 380, pos_y: 120 }
  } } } }
}];

function ensureDefaultFlows(db) {
  var cfg = auth.readConfig();
  var done = cfg.defaultFlows || [];
  var todo = DEFAULT_FLOWS.filter(function(f) { return done.indexOf(f.key) === -1; });
  if (!todo.length) return;
  var now = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Amsterdam' }).replace(' ', 'T');
  todo.forEach(function(f) {
    db.run('INSERT INTO flows (name, enabled, data, created_at) VALUES (?,1,?,?)', [f.name, JSON.stringify(f.data), now], function(err) {
      if (err) return console.error('[Flow] standaardflow', f.key, err.message);
      var c = auth.readConfig();
      c.defaultFlows = (c.defaultFlows || []).concat(f.key);
      auth.writeConfig(c);
      console.log('[Flow] standaardflow aangemaakt:', f.name);
    });
  });
}

// ── Manual run (async, uses real context) ─────────────────────────────────
function runFlow(flow, db, callback) {
  function doRun(ctx) {
    var allResults = [];
    try {
      var data  = JSON.parse(flow.data || '{}');
      if (!data.drawflow) { if (callback) callback(allResults); return; }
      var nodes = (data.drawflow.Home || {}).data || {};
      Object.values(nodes).forEach(function(node) {
        if (TRIGGERS[node.name]) {
          allResults = allResults.concat(traverseOutputs(node, nodes, ctx, flow.id));
        }
      });
    } catch(e) {
      console.error('[Flow] runFlow error — flow', flow.id, e.message);
    }
    if (callback) callback(allResults);
    return allResults;
  }

  if (db) {
    gatherContext(db, doRun);
  } else {
    return doRun({});
  }
}

// ── Sensor state: crossing detection ──────────────────────────────────────
// "flowId:nodeId" → bool (was condition true last check)
var sensorState   = {};
var offlineSeen   = {};  // "flowId:nodeId" → apparaten die bij de vorige controle al offline waren
var lastWashCount = null;
var prevWashState = null;

function checkSensorTriggers(rows, ctx) {
  rows.forEach(function(flow) {
    try {
      var data  = JSON.parse(flow.data || '{}');
      if (!data.drawflow) return;
      var nodes = (data.drawflow.Home || {}).data || {};

      Object.values(nodes).forEach(function(node) {
        var key    = flow.id + ':' + node.id;
        var wasOn  = !!sensorState[key];
        var isOn   = false;

        switch (node.name) {
          case 'power_above':
            isOn = ctx.watts > (parseInt(node.data.watts) || 1000);
            break;
          case 'power_below':
            isOn = ctx.watts < (parseInt(node.data.watts) || 200);
            break;
          case 'solar_above':
            isOn = ctx.solarWatts > (parseInt(node.data.watts) || 500);
            break;
          case 'solar_below':
            isOn = ctx.solarWatts < (parseInt(node.data.watts) || 100);
            break;
          case 'gas_above':
            isOn = ctx.gasRate > (parseFloat(node.data.rate) || 0.5);
            break;
          case 'voltage_dip':
            isOn = ctx.voltages.length > 0 &&
                   Math.min.apply(null, ctx.voltages) < (parseFloat(node.data.volts) || 210);
            break;
          case 'phase_imbalance':
            isOn = (ctx.phaseImbalancePct || 0) > (parseInt(node.data.percent) || 30);
            break;
          case 'weather_rain':
            isOn = (ctx.rainProb || 0) > (parseInt(node.data.probability) || 70);
            break;
          case 'temp_above': {
            var room = (node.data.room || '').toLowerCase().trim();
            var t = (ctx.temps || {})[room];
            isOn = t !== undefined && t > (parseFloat(node.data.temp) || 25);
            break;
          }
          case 'temp_below': {
            var room2 = (node.data.room || '').toLowerCase().trim();
            var t2 = (ctx.temps || {})[room2];
            isOn = t2 !== undefined && t2 < (parseFloat(node.data.temp) || 18);
            break;
          }
          case 'price_below': {
            var pb = parseFloat(node.data.price);
            isOn = ctx.price != null && ctx.price < (isNaN(pb) ? 0.20 : pb);
            break;
          }
          case 'price_above': {
            var pa = parseFloat(node.data.price);
            isOn = ctx.price != null && ctx.price > (isNaN(pa) ? 0.35 : pa);
            break;
          }
          case 'fridge_temp_above': {
            var ft = (ctx.fridge || {})[node.data.compartment || 'refrigerator'];
            var limit = parseFloat(node.data.temp);
            isOn = ft != null && ft > (isNaN(limit) ? 8 : limit);
            break;
          }
          case 'device_offline': {
            // vuurt voor elk apparaat dat nieuw offline is; {apparaat} bevat de naam
            if (!ctx.offline) return;
            var seenBefore = offlineSeen[key] || {};
            var nowOffline = {};
            ctx.offline.forEach(function(d) { nowOffline[d.key] = true; });
            var fresh = ctx.offline.filter(function(d) { return !seenBefore[d.key]; });
            offlineSeen[key] = nowOffline;
            if (fresh.length) {
              var offCtx = Object.assign({}, ctx, { vars: Object.assign({}, ctx.vars, { apparaat: fresh.map(function(d) { return d.name; }).join(', ') }) });
              console.log('[Flow] Trigger "device_offline" — flow ' + flow.id + ' "' + flow.name + '"');
              traverseOutputs(node, nodes, offCtx, flow.id);
            }
            return;
          }
          case 'wash_started':
            isOn = ctx.washState === 'bezig' && prevWashState !== 'bezig';
            break;
          case 'wash_done':
            isOn = lastWashCount !== null && ctx.cycleCount > lastWashCount;
            break;
          case 'dish_started':
            isOn = (ctx.dish || {}).operation === 'Run';
            break;
          case 'dish_done':
            isOn = (ctx.dish || {}).operation === 'Finished';
            break;
          case 'dish_alert':
            isOn = ((ctx.dish || {}).alerts || []).length > 0;
            break;
          default:
            return; // not a sensor trigger
        }

        // De vaatwasser kan uren op "klaar" blijven staan: de eerste keer na een herstart alleen onthouden, niet vuren
        if (node.name.indexOf('dish_') === 0 && !(key in sensorState)) { sensorState[key] = isOn; return; }

        sensorState[key] = isOn;

        // Fire on rising edge only (false → true transition)
        if (isOn && !wasOn && node.name !== 'wash_started' && node.name !== 'wash_done') {
          console.log('[Flow] Trigger "' + node.name + '" — flow ' + flow.id + ' "' + flow.name + '"');
          traverseOutputs(node, nodes, ctx, flow.id);
        } else if (isOn && (node.name === 'wash_started' || node.name === 'wash_done')) {
          console.log('[Flow] Trigger "' + node.name + '" — flow ' + flow.id + ' "' + flow.name + '"');
          traverseOutputs(node, nodes, ctx, flow.id);
        }
      });
    } catch(e) {}
  });

  // Update one-shot state
  prevWashState = ctx.washState;
  lastWashCount = ctx.cycleCount;
}

// ── Sun trigger helpers ────────────────────────────────────────────────────
function addMinutes(timeStr, minutes) {
  var parts = timeStr.split(':');
  var total = parseInt(parts[0]) * 60 + parseInt(parts[1]) + minutes;
  total = ((total % 1440) + 1440) % 1440;
  return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
}

function checkSunTriggers(rows, dateStr, timeStr, sunTimes) {
  rows.forEach(function(flow) {
    try {
      var data  = JSON.parse(flow.data || '{}');
      if (!data.drawflow) return;
      var nodes = (data.drawflow.Home || {}).data || {};

      Object.values(nodes).forEach(function(node) {
        if (node.name !== 'sunrise' && node.name !== 'sunset') return;

        var base   = node.name === 'sunrise' ? sunTimes.sunrise : sunTimes.sunset;
        var offset = parseInt(node.data.offset) || 0;
        var target = addMinutes(base, offset);

        if (target !== timeStr) return;

        var key = flow.id + ':' + node.id + ':' + dateStr;
        if (lastFired[key]) return;
        lastFired[key] = true;

        console.log('[Flow] ' + node.name + ' (offset ' + offset + 'min, ' + target + ') — flow ' + flow.id + ' "' + flow.name + '"');
        traverseOutputs(node, nodes, lastCtx, flow.id);
      });
    } catch(e) {}
  });
}

// ── Timer checking ─────────────────────────────────────────────────────────
var lastFired = {};

function checkTimerTriggers(rows, dateStr, timeStr, isWeekday) {
  rows.forEach(function(flow) {
    try {
      var data  = JSON.parse(flow.data || '{}');
      if (!data.drawflow) return;
      var nodes = (data.drawflow.Home || {}).data || {};

      Object.values(nodes).forEach(function(node) {
        if (node.name !== 'timer') return;
        if (node.data.time !== timeStr) return;

        var days = node.data.days || 'all';
        if (days === 'weekdays' && !isWeekday) return;
        if (days === 'weekend'  &&  isWeekday) return;
        if (days === 'month_first' && dateStr.slice(8, 10) !== '01') return;

        var key = flow.id + ':' + dateStr + 'T' + timeStr;
        if (lastFired[key]) return;
        lastFired[key] = true;

        console.log('[Flow] Timer — flow ' + flow.id + ' "' + flow.name + '" om ' + timeStr);
        traverseOutputs(node, nodes, lastCtx, flow.id);
      });
    } catch(e) {}
  });

  // Purge yesterday's keys
  Object.keys(lastFired).forEach(function(k) {
    if (k.indexOf(dateStr) === -1) delete lastFired[k];
  });
}

// ── Afval-trigger ──────────────────────────────────────────────────────────
// Vuurt op het ingestelde tijdstip als er de volgende dag (of die dag zelf) iets wordt opgehaald.
function checkAfvalTriggers(rows, dateStr, timeStr) {
  if (!modules.isOn('afval')) return;
  var due = [];
  rows.forEach(function(flow) {
    try {
      var data  = JSON.parse(flow.data || '{}');
      if (!data.drawflow) return;
      var nodes = (data.drawflow.Home || {}).data || {};
      Object.values(nodes).forEach(function(node) {
        if (node.name !== 'afval_pickup' || (node.data.time || '21:00') !== timeStr) return;
        var key = flow.id + ':' + node.id + ':afval:' + dateStr;
        if (lastFired[key]) return;
        lastFired[key] = true;
        due.push({ flow: flow, node: node, nodes: nodes });
      });
    } catch(e) {}
  });
  if (!due.length) return;

  afval.fetchCalendar(function(err, cal) {
    if (err || !cal || !cal.configured) return;
    due.forEach(function(d) {
      var days = d.node.data.when === 'same' ? 0 : 1;
      var kind = d.node.data.kind || 'all';
      var labels = cal.pickups.filter(function(p) { return p.days === days && (kind === 'all' || p.label === kind); })
                              .map(function(p) { return p.label; });
      if (!labels.length) return;
      var ctx = Object.assign({}, lastCtx, { vars: Object.assign({}, lastCtx.vars, { afval: labels.join(' en ') }) });
      console.log('[Flow] afval_pickup (' + labels.join(', ') + ') — flow ' + d.flow.id + ' "' + d.flow.name + '"');
      traverseOutputs(d.node, d.nodes, ctx, d.flow.id);
    });
  });
}

// ── Main check (every 30 s) ────────────────────────────────────────────────
function checkAll(db) {
  var amsNow    = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Amsterdam' });
  var dateStr   = amsNow.slice(0, 10);
  var timeStr   = amsNow.slice(11, 16);
  var dayAbbr   = new Date().toLocaleDateString('en-US', { timeZone: 'Europe/Amsterdam', weekday: 'short' }).toLowerCase();
  var isWeekday = !['sat', 'sun'].includes(dayAbbr);

  db.all('SELECT * FROM flows WHERE enabled = 1', function(err, rows) {
    if (err || !rows || !rows.length) return;

    checkTimerTriggers(rows, dateStr, timeStr, isWeekday);
    checkAfvalTriggers(rows, dateStr, timeStr);

    sun.getSunTimes(function(err, sunTimes) {
      if (!err && sunTimes) { cachedSunTimes = sunTimes; checkSunTriggers(rows, dateStr, timeStr, sunTimes); }
    });

    gatherContext(db, function(ctx) {
      checkSensorTriggers(rows, ctx);
    });
  });
}

// ── Webhook trigger ────────────────────────────────────────────────────────
function triggerWebhook(token, db) {
  db.all('SELECT * FROM flows WHERE enabled = 1', function(err, rows) {
    if (err || !rows) return;
    rows.forEach(function(flow) {
      try {
        var data  = JSON.parse(flow.data || '{}');
        if (!data.drawflow) return;
        var nodes = (data.drawflow.Home || {}).data || {};
        Object.values(nodes).forEach(function(node) {
          if (node.name === 'webhook_trigger' && (node.data.token || '') === token) {
            console.log('[Flow] webhook_trigger token="' + token + '" — flow ' + flow.id + ' "' + flow.name + '"');
            traverseOutputs(node, nodes, lastCtx, flow.id);
          }
        });
      } catch(e) {}
    });
  });
}

// ── MQTT trigger setup (called once at server start) ──────────────────────
function startMqttTriggers(db) {
  var mqttSvc = require('./mqtt');
  db.all('SELECT * FROM flows WHERE enabled = 1', function(err, rows) {
    if (err || !rows) return;
    rows.forEach(function(flow) {
      try {
        var data  = JSON.parse(flow.data || '{}');
        if (!data.drawflow) return;
        var nodes = (data.drawflow.Home || {}).data || {};
        Object.values(nodes).forEach(function(node) {
          if (node.name !== 'mqtt_trigger') return;
          var broker   = node.data.broker   || 'mqtt://localhost:1883';
          var topic    = node.data.topic    || '#';
          var username = node.data.username || '';
          var password = node.data.password || '';
          var capturedNode  = node;
          var capturedNodes = nodes;
          var capturedFlowId = flow.id;
          mqttSvc.subscribe(broker, topic, username, password, function(receivedTopic, message) {
            console.log('[Flow] mqtt_trigger topic="' + receivedTopic + '" — flow ' + capturedFlowId + ' "' + flow.name + '"');
            traverseOutputs(capturedNode, capturedNodes, { mqttTopic: receivedTopic, mqttMessage: message.toString() }, capturedFlowId);
          });
        });
      } catch(e) {}
    });
  });
}

module.exports = {
  runFlow: runFlow,
  triggerWebhook: triggerWebhook,
  start: function(db) {
    ensureDefaultFlows(db);
    startMqttTriggers(db);
    setInterval(function() { checkAll(db); }, 30000);
    checkAll(db);
  }
};

var state   = require('../utils/state');
var discord = require('./discord');
var weather = require('./weather');
var sun     = require('./sun');

// ── Node categories ────────────────────────────────────────────────────────
var TRIGGERS = {
  timer: 1, power_above: 1, power_below: 1, temp_above: 1, temp_below: 1,
  wash_done: 1, wash_started: 1, gas_above: 1, voltage_dip: 1,
  phase_imbalance: 1, solar_above: 1, solar_below: 1, weather_rain: 1,
  sunrise: 1, sunset: 1
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

function amsTime() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Amsterdam' }).slice(11, 16);
}

function timeInWindow(start, end) {
  var now = amsTime();
  return start <= end
    ? (now >= start && now <= end)
    : (now >= start || now <= end); // overnight: e.g. 22:00–06:00
}

// ── Execute action node ────────────────────────────────────────────────────
function executeNode(node) {
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
    var msg = (node.data.message || 'VloedHub flow getriggerd').trim();
    discord.sendDiscord('\uD83D\uDD14 ' + msg);
    console.log('[Flow] Melding:', msg);
    return { action: 'notify', message: msg };
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
    if (timeInWindow(node.data.start || '00:00', node.data.end || '23:59')) followAll();
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
  var r = executeNode(node);
  if (r) results.push(r);
  followAll();
}

function traverseOutputs(startNode, allNodes, ctx) {
  var results = [];
  var visited = {};
  Object.values(startNode.outputs || {}).forEach(function(out) {
    (out.connections || []).forEach(function(conn) {
      traverseFrom(allNodes, conn.node, ctx || {}, visited, results);
    });
  });
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
              callback(ctx);
            });
          });
        });
      });
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
          allResults = allResults.concat(traverseOutputs(node, nodes, ctx));
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
          case 'wash_started':
            isOn = ctx.washState === 'bezig' && prevWashState !== 'bezig';
            break;
          case 'wash_done':
            isOn = lastWashCount !== null && ctx.cycleCount > lastWashCount;
            break;
          default:
            return; // not a sensor trigger
        }

        sensorState[key] = isOn;

        // Fire on rising edge only (false → true transition)
        if (isOn && !wasOn && node.name !== 'wash_started' && node.name !== 'wash_done') {
          console.log('[Flow] Trigger "' + node.name + '" — flow ' + flow.id + ' "' + flow.name + '"');
          traverseOutputs(node, nodes, ctx);
        } else if (isOn && (node.name === 'wash_started' || node.name === 'wash_done')) {
          console.log('[Flow] Trigger "' + node.name + '" — flow ' + flow.id + ' "' + flow.name + '"');
          traverseOutputs(node, nodes, ctx);
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
        traverseOutputs(node, nodes, {});
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

        var key = flow.id + ':' + dateStr + 'T' + timeStr;
        if (lastFired[key]) return;
        lastFired[key] = true;

        console.log('[Flow] Timer — flow ' + flow.id + ' "' + flow.name + '" om ' + timeStr);
        traverseOutputs(node, nodes, {});
      });
    } catch(e) {}
  });

  // Purge yesterday's keys
  Object.keys(lastFired).forEach(function(k) {
    if (k.indexOf(dateStr) === -1) delete lastFired[k];
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

    sun.getSunTimes(function(err, sunTimes) {
      if (!err && sunTimes) checkSunTriggers(rows, dateStr, timeStr, sunTimes);
    });

    gatherContext(db, function(ctx) {
      checkSensorTriggers(rows, ctx);
    });
  });
}

module.exports = {
  runFlow: runFlow,
  start: function(db) {
    setInterval(function() { checkAll(db); }, 30000);
    checkAll(db);
  }
};

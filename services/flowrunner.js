var state = require('../utils/state');

function hexToRgb(hex) {
  hex = (hex || '#ffffff').replace('#', '');
  if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  return {
    r: parseInt(hex.slice(0,2), 16) || 255,
    g: parseInt(hex.slice(2,4), 16) || 255,
    b: parseInt(hex.slice(4,6), 16) || 255
  };
}

function executeNode(node) {
  var device = node.data.device || 'default';
  var ls = state.getLedState(device);

  if (node.name === 'led_on') {
    ls.on = true;
    if (node.data.brightness != null) ls.brightness = Math.max(0, Math.min(255, parseInt(node.data.brightness) || 180));
    if (node.data.color) ls.color = hexToRgb(node.data.color);
    console.log('[Flow] LED aan:', device, ls);
    return { action: 'led_on', device: device };
  }

  if (node.name === 'led_off') {
    ls.on = false;
    console.log('[Flow] LED uit:', device);
    return { action: 'led_off', device: device };
  }

  return null;
}

function traverseOutputs(startNode, allNodes) {
  var results = [];
  var visited = {};

  function visit(node) {
    if (visited[node.id]) return;
    visited[node.id] = true;
    if (node.name !== 'timer') {
      var r = executeNode(node);
      if (r) results.push(r);
    }
    Object.values(node.outputs || {}).forEach(function(out) {
      (out.connections || []).forEach(function(conn) {
        var next = allNodes[conn.node];
        if (next) visit(next);
      });
    });
  }

  Object.values(startNode.outputs || {}).forEach(function(out) {
    (out.connections || []).forEach(function(conn) {
      var next = allNodes[conn.node];
      if (next) visit(next);
    });
  });

  return results;
}

function runFlow(flow) {
  var allResults = [];
  try {
    var data = JSON.parse(flow.data || '{}');
    if (!data.drawflow) return allResults;
    var nodes = (data.drawflow.Home || {}).data || {};
    Object.values(nodes).forEach(function(node) {
      if (node.name === 'timer') {
        allResults = allResults.concat(traverseOutputs(node, nodes));
      }
    });
  } catch(e) {
    console.error('[Flow] Error running flow', flow.id, e.message);
  }
  return allResults;
}

// Track fired timers: "flowId:YYYY-MM-DDTHH:MM" → true
var lastFired = {};

function checkAll(db) {
  var amsNow  = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Amsterdam' });
  var dateStr = amsNow.slice(0, 10);   // YYYY-MM-DD
  var timeStr = amsNow.slice(11, 16);  // HH:MM
  var dayAbbr = new Date().toLocaleDateString('en-US', { timeZone: 'Europe/Amsterdam', weekday: 'short' }).toLowerCase();
  var isWeekday = !['sat', 'sun'].includes(dayAbbr);

  db.all('SELECT * FROM flows WHERE enabled = 1', function(err, rows) {
    if (err || !rows) return;
    rows.forEach(function(flow) {
      try {
        var data = JSON.parse(flow.data || '{}');
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

          console.log('[Flow] Timer fired — flow ' + flow.id + ' "' + flow.name + '" at ' + timeStr);
          traverseOutputs(node, nodes);
        });
      } catch(e) {}
    });

    // Purge keys from previous days
    Object.keys(lastFired).forEach(function(k) {
      if (k.indexOf(dateStr) === -1) delete lastFired[k];
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

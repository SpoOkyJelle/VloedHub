var mqtt = require('mqtt');

// ── Client pool: one client per broker URL ─────────────────────────────────
var clients = {};

function getClient(broker, username, password) {
  // Key includes credentials so different creds get different clients
  var key = broker + '|' + (username || '') + '|' + (password || '');
  if (clients[key] && clients[key].connected) return clients[key];

  var opts = { reconnectPeriod: 5000 };
  if (username) opts.username = username;
  if (password) opts.password = password;

  var client = mqtt.connect(broker, opts);

  client.on('connect', function() {
    console.log('[MQTT] Connected to', broker);
  });

  client.on('error', function(err) {
    console.error('[MQTT] Error on', broker, ':', err.message);
  });

  clients[key] = client;
  return client;
}

// ── Publish ────────────────────────────────────────────────────────────────
function publish(broker, topic, message, username, password) {
  if (!broker || !topic) return;
  var client = getClient(broker, username, password);
  client.publish(topic, String(message || ''), function(err) {
    if (err) console.error('[MQTT] Publish error:', err.message);
    else console.log('[MQTT] Published to', topic);
  });
}

// ── Subscribe ──────────────────────────────────────────────────────────────
function subscribe(broker, topic, username, password, onMessage) {
  if (!broker || !topic) return;
  var client = getClient(broker, username, password);

  function doSubscribe() {
    client.subscribe(topic, function(err) {
      if (err) console.error('[MQTT] Subscribe error:', topic, err.message);
      else console.log('[MQTT] Subscribed to', topic, 'on', broker);
    });
  }

  if (client.connected) {
    doSubscribe();
  } else {
    client.once('connect', doSubscribe);
  }

  client.on('message', function(receivedTopic, message) {
    // Simple topic matching: exact match or wildcard '#'
    if (receivedTopic === topic || topic === '#' || topicMatches(topic, receivedTopic)) {
      onMessage(receivedTopic, message);
    }
  });
}

// ── MQTT topic wildcard matching ───────────────────────────────────────────
// Supports '+' (single level) and '#' (multi level)
function topicMatches(filter, topic) {
  var filterParts = filter.split('/');
  var topicParts  = topic.split('/');

  for (var i = 0; i < filterParts.length; i++) {
    if (filterParts[i] === '#') return true;
    if (filterParts[i] !== '+' && filterParts[i] !== topicParts[i]) return false;
  }

  return filterParts.length === topicParts.length;
}

module.exports = { publish: publish, subscribe: subscribe };

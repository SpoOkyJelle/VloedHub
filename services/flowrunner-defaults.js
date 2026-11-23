// Standaardflows die VloedHub één keer aanmaakt. Welke er al geweest zijn staat in de configuratie,
// zodat een flow die je weggooit niet bij de volgende herstart terugkomt. Losgetrokken van de
// flow-engine (flowrunner.js) omdat het statische seed-data is, geen draaiende logica.
var auth = require('./auth');
var time = require('../utils/time');

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
  var now = time.now();
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

module.exports = { DEFAULT_FLOWS: DEFAULT_FLOWS, ensureDefaultFlows: ensureDefaultFlows };

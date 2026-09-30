var db = require('../db/setup');

function nowAms() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Amsterdam' }).replace(' ', 'T');
}

// Flow 1: Ganglamp aan bij zonsondergang
// sunset → time_window (20:00-02:00) → relay_on (gang)
//                                     → notify
var flow1 = {
  drawflow: {
    Home: {
      data: {
        '1': {
          id: 1, name: 'sunset',
          data: { offset: '0' },
          class: 'sunset', html: '', typenode: false,
          inputs: {},
          outputs: { output_1: { connections: [{ node: '2', output: 'input_1' }] } },
          pos_x: 80, pos_y: 120
        },
        '2': {
          id: 2, name: 'time_window',
          data: { start: '20:00', end: '02:00' },
          class: 'time_window', html: '', typenode: false,
          inputs: { input_1: { connections: [{ node: '1', input: 'output_1' }] } },
          outputs: {
            output_1: {
              connections: [
                { node: '3', output: 'input_1' },
                { node: '4', output: 'input_1' }
              ]
            }
          },
          pos_x: 340, pos_y: 120
        },
        '3': {
          id: 3, name: 'relay_on',
          data: { device: 'gang' },
          class: 'relay_on', html: '', typenode: false,
          inputs: { input_1: { connections: [{ node: '2', input: 'output_1' }] } },
          outputs: {},
          pos_x: 620, pos_y: 60
        },
        '4': {
          id: 4, name: 'notify',
          data: { message: 'Ganglamp aan' },
          class: 'notify', html: '', typenode: false,
          inputs: { input_1: { connections: [{ node: '2', input: 'output_1' }] } },
          outputs: {},
          pos_x: 620, pos_y: 220
        }
      }
    }
  }
};

// Flow 2: Ganglamp uit om 02:00
// timer (02:00) → relay_off (gang)
//               → notify
var flow2 = {
  drawflow: {
    Home: {
      data: {
        '1': {
          id: 1, name: 'timer',
          data: { time: '02:00', days: 'all' },
          class: 'timer', html: '', typenode: false,
          inputs: {},
          outputs: {
            output_1: {
              connections: [
                { node: '2', output: 'input_1' },
                { node: '3', output: 'input_1' }
              ]
            }
          },
          pos_x: 80, pos_y: 120
        },
        '2': {
          id: 2, name: 'relay_off',
          data: { device: 'gang' },
          class: 'relay_off', html: '', typenode: false,
          inputs: { input_1: { connections: [{ node: '1', input: 'output_1' }] } },
          outputs: {},
          pos_x: 360, pos_y: 60
        },
        '3': {
          id: 3, name: 'notify',
          data: { message: 'Ganglamp uit' },
          class: 'notify', html: '', typenode: false,
          inputs: { input_1: { connections: [{ node: '1', input: 'output_1' }] } },
          outputs: {},
          pos_x: 360, pos_y: 220
        }
      }
    }
  }
};

var now = nowAms();

db.run(
  'INSERT INTO flows (name, enabled, data, created_at) VALUES (?,1,?,?)',
  ['Ganglamp aan (zonsondergang)', JSON.stringify(flow1), now],
  function(err) {
    if (err) { console.error('Flow 1 error:', err.message); return; }
    console.log('Flow 1 aangemaakt, id:', this.lastID);

    db.run(
      'INSERT INTO flows (name, enabled, data, created_at) VALUES (?,1,?,?)',
      ['Ganglamp uit (02:00)', JSON.stringify(flow2), now],
      function(err2) {
        if (err2) { console.error('Flow 2 error:', err2.message); return; }
        console.log('Flow 2 aangemaakt, id:', this.lastID);
        console.log('Klaar!');
      }
    );
  }
);

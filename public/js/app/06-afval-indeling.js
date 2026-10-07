// ── Afvalkalender ──
function afvalWhen(days) { return days === 0 ? 'Vandaag' : days === 1 ? 'Morgen' : 'Over ' + days + ' dagen'; }
function loadAfval() {
  fetch('/api/afval').then(function(r){return r.json();}).then(function(d) {
    var el = document.getElementById('blk-afval');
    if (!el) return;
    if (d.error) { el.innerHTML = '<div class="afval-empty">Afvalkalender niet bereikbaar</div>'; return; }
    if (!d.configured) { el.innerHTML = '<div class="afval-empty">Nog geen adres ingesteld<button class="btn btn-ghost" onclick="showScreen(5,null)">Adres instellen</button></div>'; return; }
    var rows = d.pickups.slice(0, 4);
    if (!rows.length) { el.innerHTML = '<div class="afval-empty">Geen ophaaldagen bekend</div>'; return; }
    el.innerHTML = rows.map(function(p) {
      var date = new Date(p.date + 'T12:00:00').toLocaleDateString('nl-NL', {weekday:'short', day:'numeric', month:'short'});
      return '<div class="afval-row' + (p.days <= 1 ? ' soon' : '') + '">' +
        '<span class="afval-icon" style="color:' + p.color + '"><i class="fa-solid fa-' + p.icon + '"></i></span>' +
        '<span class="afval-label">' + p.label + '</span>' +
        '<span class="afval-when">' + afvalWhen(p.days) + '</span>' +
        '<span class="afval-date">' + date + '</span></div>';
    }).join('');
  }).catch(function() {
    var el = document.getElementById('blk-afval');
    if (el) el.innerHTML = '<div class="afval-empty">Afvalkalender niet bereikbaar</div>';
  });
}
function loadAfvalAddress() {
  fetch('/api/afval/address').then(function(r){return r.json();}).then(function(a) {
    if (!a.postcode) return;
    document.getElementById('afval-postcode').value = a.postcode;
    document.getElementById('afval-huisnummer').value = a.huisnummer;
    document.getElementById('afval-toevoeging').value = a.toevoeging || '';
    document.getElementById('afval-address-status').textContent = a.straat;
  }).catch(function(){});
}
function saveAfvalAddress() {
  var status = document.getElementById('afval-address-status');
  status.style.color = 'var(--dim)';
  status.textContent = 'Adres opzoeken…';
  fetch('/api/afval/address', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({
    postcode: document.getElementById('afval-postcode').value,
    huisnummer: document.getElementById('afval-huisnummer').value,
    toevoeging: document.getElementById('afval-toevoeging').value
  })}).then(function(r){return r.json();}).then(function(d) {
    if (!d.ok) { status.style.color = 'var(--red)'; status.textContent = d.error || 'Opslaan mislukt'; return; }
    status.textContent = d.straat;
    loadAfval();
  }).catch(function() { status.style.color = 'var(--red)'; status.textContent = 'Verbindingsfout'; });
}
loadAfvalAddress();

function loadLayout() {
  // Indeling staat al in de pagina, zodat de blokken niet verspringen na het laden
  try {
    layoutConfig = JSON.parse(document.getElementById('layout-data').textContent);
    applyLayout(0);
    return;
  } catch(e) {}
  fetch('/api/layout').then(function(r){return r.json();}).then(function(cfg){
    layoutConfig = cfg;
    applyLayout(0);
  }).catch(function(){ applyLayout(0); });
}

function applyLayout(screenIdx) {
  if (screenIdx === 0) closeHomeLedPanels();
  var screen = document.getElementById('screen-' + screenIdx);
  if (!screen) return;
  var cfg = layoutConfig[String(screenIdx)];
  if (!cfg) return;

  // Hide all blocks first
  screen.querySelectorAll('.layout-block').forEach(function(b){ b.style.display='none'; });

  // Show/reorder/size blocks per config
  cfg.forEach(function(item) {
    if (!blockEnabled(item.type)) return;
    var block = screen.querySelector('[data-block="' + item.type + '"]');
    if (!block) {
      // Dynamic block — create it
      block = document.createElement('div');
      block.className = 'layout-block';
      block.dataset.block = item.type;
      var def = BLOCKS[item.type];
      if (def && def.render) def.render(block);
      screen.appendChild(block);
    }
    block.dataset.size = item.size || 'full';
    block.style.display = '';
    screen.appendChild(block); // move to correct order
  });

  // Refresh dynamic blocks
  cfg.forEach(function(item) {
    var def = BLOCKS[item.type];
    if (def && def.dynamic && def.refresh && blockEnabled(item.type)) def.refresh();
  });
}

setInterval(function() {
  if (layoutEditMode) return;
  (layoutConfig['0'] || []).forEach(function(item) {
    var def = BLOCKS[item.type];
    if (def && def.dynamic && def.refresh && blockEnabled(item.type)) def.refresh();
  });
}, 5 * 60 * 1000);

function saveLayout() {
  fetch('/api/layout', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(layoutConfig)}).then(function(){applyLayout(0);});
}

function toggleLayoutEdit() {
  layoutEditMode = !layoutEditMode;
  var btn = document.getElementById('layout-edit-btn');
  if (layoutEditMode) {
    btn.style.background = 'rgba(34,197,94,0.85)';
    renderEditBars(0);
  } else {
    btn.style.background = 'rgba(141,178,85,0.85)';
    removeEditBars(0);
    saveLayout();
  }
}

function renderEditBars(screenIdx) {
  var screen = document.getElementById('screen-' + screenIdx);
  screen.querySelectorAll('.layout-block').forEach(function(block) {
    if (block.style.display === 'none') return;
    var type = block.dataset.block;
    var def = BLOCKS[type] || {label: type, icon: 'fa-cube'};
    var size = block.dataset.size || 'full';
    var bar = document.createElement('div');
    bar.className = 'layout-block-edit-bar';
    bar.dataset.editBar = type;
    bar.innerHTML = '<i class="fa-solid ' + def.icon + '"></i><span class="lbl">' + def.label + '</span>' +
      '<button onclick="moveBlock(0,\'' + type + '\',-1)" title="Omhoog">↑</button>' +
      '<button onclick="moveBlock(0,\'' + type + '\',1)" title="Omlaag">↓</button>' +
      '<button class="block-size-btn" onclick="toggleBlockSize(' + screenIdx + ',\'' + type + '\',this)" title="Grootte">' + (size === 'half' ? '2' : size === 'full' ? '4' : size) + '</button>' +
      '<button onclick="removeBlock(0,\'' + type + '\')" title="Verwijderen" style="color:#F87171">✕</button>';
    block.insertBefore(bar, block.firstChild);
  });
  // Add "add block" button
  var existing = screen.querySelector('[data-edit-add]');
  if (existing) existing.parentNode.removeChild(existing);
  var addBtn = document.createElement('button');
  addBtn.dataset.editAdd = '1';
  addBtn.onclick = showBlockPicker;
  addBtn.style.cssText = 'width:100%;padding:0.65rem;border-radius:10px;border:1px dashed rgba(141,178,85,0.4);background:rgba(141,178,85,0.08);color:var(--accent-l);font-family:inherit;font-weight:600;cursor:pointer;font-size:0.85rem';
  addBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Blok toevoegen';
  screen.appendChild(addBtn);
}

function removeEditBars(screenIdx) {
  var screen = document.getElementById('screen-' + screenIdx);
  screen.querySelectorAll('.layout-block-edit-bar').forEach(function(b){ b.parentNode.removeChild(b); });
  var addBtn = screen.querySelector('[data-edit-add]');
  if (addBtn) addBtn.parentNode.removeChild(addBtn);
}

function moveBlock(screenIdx, type, dir) {
  var cfg = layoutConfig[String(screenIdx)];
  if (!cfg) return;
  var idx = cfg.findIndex(function(b){ return b.type === type; });
  if (idx < 0) return;
  var newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= cfg.length) return;
  var tmp = cfg[idx]; cfg[idx] = cfg[newIdx]; cfg[newIdx] = tmp;
  flipAnimate(homeBlocks(), function() {
    removeEditBars(screenIdx);
    applyLayout(screenIdx);
    renderEditBars(screenIdx);
  });
}

function toggleBlockSize(screenIdx, type, btn) {
  var cfg = layoutConfig[String(screenIdx)];
  if (!cfg) return;
  var item = cfg.find(function(b){ return b.type === type; });
  if (!item) return;
  var sizes = ['1','2','3','4'];
  var cur = sizes.indexOf(String(item.size));
  item.size = sizes[(cur + 1) % sizes.length];
  var block = document.getElementById('screen-' + screenIdx).querySelector('[data-block="' + type + '"]');
  if (block) flipAnimate(homeBlocks(), function() { block.dataset.size = item.size; });
  btn.textContent = item.size;
}

function removeBlock(screenIdx, type) {
  var cfg = layoutConfig[String(screenIdx)];
  if (!cfg) return;
  layoutConfig[String(screenIdx)] = cfg.filter(function(b){ return b.type !== type; });
  flipAnimate(homeBlocks(), function() {
    removeEditBars(screenIdx);
    applyLayout(screenIdx);
    renderEditBars(screenIdx);
  });
}

function showBlockPicker() {
  var screenIdx = 0;
  var cfg = layoutConfig[String(screenIdx)] || [];
  var used = cfg.map(function(b){ return b.type; });
  var available = Object.keys(BLOCKS).filter(function(k){ return used.indexOf(k) === -1 && blockEnabled(k); });
  var list = document.getElementById('block-picker-list');
  if (!available.length) {
    list.innerHTML = '<div style="color:var(--dim);font-size:0.8rem">Alle blokken zijn al zichtbaar.</div>';
  } else {
    list.innerHTML = available.map(function(type) {
      var def = BLOCKS[type];
      return '<button onclick="addBlock(0,\'' + type + '\')" style="display:flex;align-items:center;gap:0.75rem;background:rgba(255,255,255,0.05);border:1px solid var(--border);border-radius:10px;padding:0.75rem;cursor:pointer;color:inherit;font-family:inherit;font-size:0.85rem;width:100%"><i class="fa-solid ' + def.icon + '" style="color:var(--accent-l);width:1.2rem;text-align:center"></i><span style="font-weight:600">' + def.label + '</span></button>';
    }).join('');
  }
  var picker = document.getElementById('block-picker');
  picker.style.display = 'flex';
}

function closeBlockPicker() {
  document.getElementById('block-picker').style.display = 'none';
}

function addBlock(screenIdx, type) {
  var cfg = layoutConfig[String(screenIdx)];
  if (!cfg) cfg = layoutConfig[String(screenIdx)] = [];
  if (cfg.find(function(b){ return b.type === type; })) return;
  cfg.push({type: type, size: 'full'});
  closeBlockPicker();
  flipAnimate(homeBlocks(), function() {
    removeEditBars(screenIdx);
    applyLayout(screenIdx);
    renderEditBars(screenIdx);
  });
}

var deviceNamesCache = {};
function loadDeviceNames() { fetch('/api/device-names').then(function(r){return r.json();}).then(function(names){ deviceNamesCache = names; var map = { 'led::default':['sname-led-default','rename-led-default','homelabel-led-default'], 'led::keuken':['sname-led-keuken','rename-led-keuken','homelabel-led-keuken'], 'led::gang':['sname-led-gang','rename-led-gang','homelabel-led-gang'], 'relay::gang':['sname-relay-gang','rename-relay-gang','homelabel-relay-gang'] }; var defaults = { 'led::default':'LED Strip','led::keuken':'Ledstrip Keuken','led::gang':'Ledstrip Gang','relay::gang':'Lamp Gang' }; Object.keys(map).forEach(function(key){ var name = names[key] || defaults[key]; map[key].forEach(function(id){ var el = document.getElementById(id); if (el) el.textContent = name; }); }); }).catch(function(){}); }
function refreshSettingsNames() {
  var deviceDefaults = { 'led::default':'LED Strip','led::keuken':'Ledstrip Keuken','led::gang':'Ledstrip Gang','relay::gang':'Lamp Gang' };
  var deviceIcons = { 'led::default':'fa-lightbulb','led::keuken':'fa-lightbulb','led::gang':'fa-lightbulb','relay::gang':'fa-toggle-on' };
  var ledKeys = ['default','keuken','gang'];
  Promise.all([
    fetch('/api/device-names').then(function(r){return r.json();}),
    Promise.all(ledKeys.map(function(k){ return fetch('/api/led/state?device='+k).then(function(r){return r.json();}).then(function(s){return {key:'led::'+k,ip:s.ip||null};}); })),
    fetch('/api/relay/state?device=gang').then(function(r){return r.json();}).then(function(s){return s.ip||null;})
  ]).then(function(results){
    var names = results[0];
    var ipMap = {};
    results[1].forEach(function(x){ipMap[x.key]=x.ip;});
    ipMap['relay::gang'] = results[2];
    var el = document.getElementById('settings-device-names');
    if (!el) return;
    el.innerHTML = '<div class="power-hero"><div style="display:flex;flex-direction:column;gap:0">' +
      Object.keys(deviceDefaults).map(function(key, i) {
        var name = names[key] || deviceDefaults[key];
        var icon = deviceIcons[key];
        var kEnc = encodeURIComponent(key);
        var ip = ipMap[key];
        var border = i > 0 ? 'border-top:1px solid var(--border);padding-top:0.65rem;margin-top:0.65rem' : '';
        return '<div style="display:flex;justify-content:space-between;align-items:center;' + border + '">' +
          '<div style="display:flex;align-items:center;gap:0.6rem"><i class="fa-solid ' + icon + '" style="color:var(--accent-l);width:1rem;text-align:center"></i>' +
          '<div><span id="sn-' + kEnc + '" style="font-size:0.9rem;font-weight:600">' + name + '</span>' +
          (ip ? '<div style="font-size:0.65rem;color:var(--dim);font-family:monospace">' + ip + '</div>' : '') +
          '</div></div>' +
          '<i class="fa-solid fa-pen" style="font-size:0.7rem;opacity:0.5;cursor:pointer;padding:0.3rem" onclick="settingsDeviceRename(\'' + kEnc + '\',\'' + encodeURIComponent(deviceDefaults[key]) + '\')"></i></div>';
      }).join('') + '</div></div>';
  }).catch(function(){});
  fetch('/api/esphome/latest').then(function(r){return r.json();}).then(function(rows){
    var el2 = document.getElementById('settings-esphome-names');
    if (!el2) return;
    if (!rows.length) { el2.innerHTML = '<div class="power-hero" style="color:var(--dim);font-size:0.8rem">Geen ESPHome data ontvangen</div>'; return; }
    el2.innerHTML = '<div class="power-hero"><div style="display:flex;flex-direction:column;gap:0">' +
      rows.map(function(r, i) {
        var border = i > 0 ? 'border-top:1px solid var(--border);padding-top:0.65rem;margin-top:0.65rem' : '';
        var dEnc = encodeURIComponent(r.device); var sEnc = encodeURIComponent(r.sensor_name);
        return '<div style="display:flex;justify-content:space-between;align-items:center;' + border + '">' +
          '<div style="display:flex;align-items:center;gap:0.6rem"><i class="fa-solid fa-microchip" style="color:var(--blue);width:1rem;text-align:center"></i>' +
          '<div><span id="sne-' + dEnc + '-' + sEnc + '" style="font-size:0.9rem;font-weight:600">' + escHtml(r.display_name) + '</span>' +
          '<div style="font-size:0.65rem;color:var(--dim)">' + escHtml(r.sensor_name) + (r.host ? ' · <span style="font-family:monospace">' + escHtml(r.host) + '</span>' : '') + '</div></div></div>' +
          '<i class="fa-solid fa-pen" style="font-size:0.7rem;opacity:0.5;cursor:pointer;padding:0.3rem" onclick="esphomeRenameSettings(\'' + dEnc + '\',\'' + sEnc + '\')"></i></div>';
      }).join('') + '</div></div>';
  }).catch(function(){});
}
function settingsDeviceRename(keyEnc, defaultEnc) {
  var key = decodeURIComponent(keyEnc); var def = decodeURIComponent(defaultEnc);
  var spanEl = document.getElementById('sn-' + keyEnc);
  if (!spanEl) return;
  var current = deviceNamesCache[key] || def;
  var input = document.createElement('input');
  input.value = current;
  input.style.cssText = 'font-size:0.9rem;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:6px;color:inherit;padding:0.1rem 0.4rem;width:10rem;font-family:inherit;font-weight:600';
  spanEl.replaceWith(input); input.focus(); input.select();
  function commit() { fetch('/api/device-names',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:key,name:input.value.trim()})}).then(function(){loadDeviceNames();refreshSettingsNames();}); }
  input.addEventListener('keydown',function(e){if(e.key==='Enter')input.blur();if(e.key==='Escape')refreshSettingsNames();});
  input.addEventListener('blur',commit);
}
function esphomeRenameSettings(dEnc, sEnc) {
  var device = decodeURIComponent(dEnc); var sensor = decodeURIComponent(sEnc);
  var spanEl = document.getElementById('sne-' + dEnc + '-' + sEnc);
  if (!spanEl) return;
  var input = document.createElement('input');
  input.value = spanEl.textContent;
  input.style.cssText = 'font-size:0.9rem;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:6px;color:inherit;padding:0.1rem 0.4rem;width:10rem;font-family:inherit;font-weight:600';
  spanEl.replaceWith(input); input.focus(); input.select();
  function commit() { fetch('/api/esphome/rename',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({device:device,sensor_name:sensor,display_name:input.value.trim()})}).then(function(){refreshSettingsNames();refreshEsphome();}); }
  input.addEventListener('keydown',function(e){if(e.key==='Enter')input.blur();if(e.key==='Escape')refreshSettingsNames();});
  input.addEventListener('blur',commit);
}

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
  status.style.color = '';
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
  var cfg = layoutConfig[layoutKey(screenIdx)];
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
  (layoutConfig[layoutKey(0)] || []).forEach(function(item) {
    var def = BLOCKS[item.type];
    if (def && def.dynamic && def.refresh && blockEnabled(item.type)) def.refresh();
  });
}, 5 * 60 * 1000);

function saveLayout() {
  fetch('/api/layout', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(layoutConfig)}).then(function(r){ if (!r.ok) throw new Error('status ' + r.status); applyLayout(0); }).catch(actionFailed('Indeling opslaan lukte niet'));
}

function toggleLayoutEdit() {
  layoutEditMode = !layoutEditMode;
  var btn = document.getElementById('layout-edit-btn');
  btn.classList.toggle('on', layoutEditMode);
  btn.setAttribute('aria-pressed', layoutEditMode);
  btn.innerHTML = '<i class="fa-solid ' + (layoutEditMode ? 'fa-check' : 'fa-pen-to-square') + '"></i>';
  btn.title = layoutEditMode ? 'Indeling opslaan' : 'Indeling aanpassen';
  if (layoutEditMode) {
    closeHomeLedPanels();
    renderEditBars(0);
  } else {
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
    bar.innerHTML = '<button class="drag-handle" title="Sleep om te verplaatsen" aria-label="' + def.label + ' verplaatsen: sleep, of gebruik de pijltjestoetsen"><i class="fa-solid fa-grip-vertical"></i></button>' +
      '<i class="fa-solid ' + def.icon + '"></i><span class="lbl">' + def.label + '</span>' +
      '<button class="block-size-btn" onclick="toggleBlockSize(' + screenIdx + ',\'' + type + '\',this)" title="Breedte (1 tot 4 kolommen)" aria-label="Breedte van ' + def.label + '">' + (size === 'half' ? '2' : size === 'full' ? '4' : size) + '</button>' +
      '<button class="danger" onclick="removeBlock(0,\'' + type + '\')" title="Verwijderen" aria-label="' + def.label + ' verwijderen"><i class="fa-solid fa-xmark"></i></button>';
    bar.addEventListener('pointerdown', function(e) { startBlockDrag(e, block); });
    bar.firstChild.addEventListener('keydown', function(e) { blockDragKey(e, type); });
    block.insertBefore(bar, block.firstChild);
  });
  // Add "add block" button
  var existing = screen.querySelector('[data-edit-add]');
  if (existing) existing.parentNode.removeChild(existing);
  var addBtn = document.createElement('button');
  addBtn.dataset.editAdd = '1';
  addBtn.onclick = showBlockPicker;
  addBtn.className = 'block-add';
  addBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Blok toevoegen';
  screen.appendChild(addBtn);
}

// ── Blokken verslepen ──
// Pak een blok bij zijn balk en sleep het over een ander blok: het schuift daar direct tussen en de rest maakt
// plaats. Het blok blijft in de pagina staan (geen zwevende kopie), zodat je meteen ziet hoe de indeling wordt.
var blockDrag = null;
function startBlockDrag(e, block) {
  // de knoppen voor breedte en verwijderen blijven gewone knoppen
  if (blockDrag || e.button || (e.target.closest('button') && !e.target.closest('.drag-handle'))) return;
  e.preventDefault();
  blockDrag = { block: block, x: e.clientX, y: e.clientY, lock: 0, moved: false, scroll: setInterval(blockDragScroll, 16) };
  block.classList.add('dragging');
  document.body.classList.add('block-dragging');
  document.addEventListener('pointermove', blockDragMove);
  document.addEventListener('pointerup', endBlockDrag);
  document.addEventListener('pointercancel', endBlockDrag);
}
function blockDragMove(e) {
  if (!blockDrag) return;
  blockDrag.x = e.clientX; blockDrag.y = e.clientY;
  blockDragOver();
}
function blockDragOver() {
  var d = blockDrag;
  // even wachten tot het vorige verschuiven klaar is, anders springt het blok heen en weer
  if (!d || Date.now() < d.lock) return;
  var el = document.elementFromPoint(d.x, d.y);
  var target = el && el.closest('#screen-0 > .layout-block');
  if (!target || target === d.block) return;
  var screen = d.block.parentNode;
  var after = d.block.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING;
  flipAnimate(homeBlocks(), function() { screen.insertBefore(d.block, after ? target.nextSibling : target); });
  d.lock = Date.now() + 260;
  d.moved = true;
}
// bij de boven- of onderrand schuift de pagina mee
function blockDragScroll() {
  var d = blockDrag;
  if (!d) return;
  var screen = d.block.parentNode, r = screen.getBoundingClientRect(), edge = 70;
  var dy = d.y < r.top + edge ? -10 : d.y > r.bottom - edge ? 10 : 0;
  if (!dy) return;
  var before = screen.scrollTop;
  screen.scrollTop += dy;
  if (screen.scrollTop !== before) blockDragOver();
}
// de volgorde in de pagina wordt de volgorde van de indeling
function layoutOrderFromDom(screenIdx) {
  var cfg = layoutConfig[layoutKey(screenIdx)];
  if (!cfg) return;
  var byType = {};
  cfg.forEach(function(item) { byType[item.type] = item; });
  var order = [];
  document.querySelectorAll('#screen-' + screenIdx + ' > .layout-block').forEach(function(b) {
    if (b.style.display !== 'none' && byType[b.dataset.block]) { order.push(byType[b.dataset.block]); delete byType[b.dataset.block]; }
  });
  // blokken van een uitgezette module staan niet in beeld maar horen nog wel bij de indeling
  layoutConfig[layoutKey(screenIdx)] = order.concat(cfg.filter(function(item) { return byType[item.type]; }));
}
function endBlockDrag() {
  var d = blockDrag;
  if (!d) return;
  blockDrag = null;
  clearInterval(d.scroll);
  d.block.classList.remove('dragging');
  document.body.classList.remove('block-dragging');
  document.removeEventListener('pointermove', blockDragMove);
  document.removeEventListener('pointerup', endBlockDrag);
  document.removeEventListener('pointercancel', endBlockDrag);
  if (d.moved) layoutOrderFromDom(0);
}
// zonder muis of vinger: pijltjestoetsen op de greep
function blockDragKey(e, type) {
  var dir = e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : 0;
  if (!dir) return;
  e.preventDefault();
  moveBlock(0, type, dir);
  var handle = document.querySelector('[data-edit-bar="' + type + '"] .drag-handle');
  if (handle) handle.focus();
}

function removeEditBars(screenIdx) {
  var screen = document.getElementById('screen-' + screenIdx);
  screen.querySelectorAll('.layout-block-edit-bar').forEach(function(b){ b.parentNode.removeChild(b); });
  var addBtn = screen.querySelector('[data-edit-add]');
  if (addBtn) addBtn.parentNode.removeChild(addBtn);
}

function moveBlock(screenIdx, type, dir) {
  var cfg = layoutConfig[layoutKey(screenIdx)];
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
  var cfg = layoutConfig[layoutKey(screenIdx)];
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
  var cfg = layoutConfig[layoutKey(screenIdx)];
  if (!cfg) return;
  layoutConfig[layoutKey(screenIdx)] = cfg.filter(function(b){ return b.type !== type; });
  flipAnimate(homeBlocks(), function() {
    removeEditBars(screenIdx);
    applyLayout(screenIdx);
    renderEditBars(screenIdx);
  });
}

function showBlockPicker() {
  var screenIdx = 0;
  var cfg = layoutConfig[layoutKey(screenIdx)] || [];
  var used = cfg.map(function(b){ return b.type; });
  var available = Object.keys(BLOCKS).filter(function(k){ return used.indexOf(k) === -1 && blockEnabled(k); });
  var list = document.getElementById('block-picker-list');
  list.innerHTML = available.length ? available.map(function(type) {
    var def = BLOCKS[type];
    return '<button class="block-option" onclick="addBlock(0,\'' + type + '\')"><i class="fa-solid ' + def.icon + '"></i><span>' + def.label + '</span></button>';
  }).join('') : '<div class="empty-note">Alle blokken staan al op Home.</div>';
  openModal('block-picker');
}

function closeBlockPicker() { closeModal('block-picker'); }

function addBlock(screenIdx, type) {
  var cfg = layoutConfig[layoutKey(screenIdx)];
  if (!cfg) cfg = layoutConfig[layoutKey(screenIdx)] = [];
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
function loadDeviceNames() { fetch('/api/device-names').then(function(r){return r.json();}).then(function(names){ deviceNamesCache = names; var map = { 'led::default':['rename-led-default','homelabel-led-default','panelname-led-default'], 'led::keuken':['rename-led-keuken','homelabel-led-keuken','panelname-led-keuken'], 'led::gang':['rename-led-gang','homelabel-led-gang','panelname-led-gang'], 'led::tv-meubel':['rename-led-tv-meubel','homelabel-led-tv-meubel','panelname-led-tv-meubel'], 'relay::gang':['sname-relay-gang','rename-relay-gang','homelabel-relay-gang'] }; var defaults = { 'led::default':'LED Strip','led::keuken':'Ledstrip Keuken','led::gang':'Ledstrip Gang','led::tv-meubel':'LED TV Meubel','relay::gang':'Lamp Gang' }; Object.keys(map).forEach(function(key){ var name = names[key] || defaults[key]; map[key].forEach(function(id){ var el = document.getElementById(id); if (el) el.textContent = name; }); }); }).catch(function(){}); }
function refreshSettingsNames() {
  var deviceDefaults = { 'led::default':'LED Strip','led::keuken':'Ledstrip Keuken','led::gang':'Ledstrip Gang','led::tv-meubel':'LED TV Meubel','relay::gang':'Lamp Gang' };
  var deviceIcons = { 'led::default':'fa-lightbulb','led::keuken':'fa-lightbulb','led::gang':'fa-lightbulb','led::tv-meubel':'fa-lightbulb','relay::gang':'fa-toggle-on' };
  var ledKeys = ['default','keuken','gang','tv-meubel'];
  function row(icon, nameId, name, sub, onclick) {
    return '<div class="setting-row"><i class="fa-solid ' + icon + ' setting-icon"></i>' +
      '<div class="setting-text"><div class="setting-title"><span id="' + nameId + '">' + escHtml(name) + '</span></div>' + (sub ? '<div class="setting-desc">' + sub + '</div>' : '') + '</div>' +
      '<button class="icon-btn" aria-label="Naam van ' + escHtml(name) + ' wijzigen" title="Naam wijzigen" onclick="' + onclick + '"><i class="fa-solid fa-pen"></i></button></div>';
  }
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
    if (!el || el.querySelector('.rename-input')) return;
    el.innerHTML = '<div class="setting-card">' + Object.keys(deviceDefaults).map(function(key) {
      var kEnc = encodeURIComponent(key), ip = ipMap[key];
      return row(deviceIcons[key], 'sn-' + kEnc, names[key] || deviceDefaults[key], ip ? '<span class="mono">' + escHtml(ip) + '</span>' : '', 'settingsDeviceRename(\'' + kEnc + '\')');
    }).join('') + '</div>';
  }).catch(function(){});
  fetch('/api/esphome/latest').then(function(r){return r.json();}).then(function(rows){
    var el2 = document.getElementById('settings-esphome-names');
    if (!el2 || el2.querySelector('.rename-input')) return;
    if (!rows.length) { el2.innerHTML = '<div class="setting-card"><div class="empty-note">Geen ESPHome data ontvangen</div></div>'; return; }
    el2.innerHTML = '<div class="setting-card">' + rows.map(function(r) {
      var dEnc = encodeURIComponent(r.device), sEnc = encodeURIComponent(r.sensor_name);
      return row('fa-microchip', 'sne-' + dEnc + '-' + sEnc, r.display_name, escHtml(r.sensor_name) + (r.host ? ' · <span class="mono">' + escHtml(r.host) + '</span>' : ''), 'esphomeRenameSettings(\'' + dEnc + '\',\'' + sEnc + '\')');
    }).join('') + '</div>';
  }).catch(function(){});
}
function saveDeviceName(key, name) {
  return fetch('/api/device-names', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({key: key, name: name})})
    .then(function(r) { if (!r.ok) throw new Error('status ' + r.status); })
    .catch(actionFailed('Naam opslaan lukte niet')).then(loadDeviceNames);
}
function saveEsphomeName(device, sensor, name) {
  return fetch('/api/esphome/rename', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({device: device, sensor_name: sensor, display_name: name})})
    .then(function(r) { if (!r.ok) throw new Error('status ' + r.status); })
    .catch(actionFailed('Naam opslaan lukte niet')).then(refreshEsphome);
}
function settingsDeviceRename(keyEnc) {
  inlineRename(document.getElementById('sn-' + keyEnc), function(name) { saveDeviceName(decodeURIComponent(keyEnc), name).then(refreshSettingsNames); });
}
function esphomeRenameSettings(dEnc, sEnc) {
  inlineRename(document.getElementById('sne-' + dEnc + '-' + sEnc), function(name) { saveEsphomeName(decodeURIComponent(dEnc), decodeURIComponent(sEnc), name).then(refreshSettingsNames); });
}

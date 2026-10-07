var MODULES = {};
try { MODULES = JSON.parse(document.getElementById('modules-data').textContent); } catch (e) {}
function moduleOn(key) { return MODULES[key] !== false; }
Object.keys(MODULES).forEach(function(k) { if (!moduleOn(k)) document.body.classList.add('mod-off-' + k); });
// Wandtablet-weergave: aan met /?kiosk=1, uit met /?kiosk=0; de keuze blijft op dit apparaat bewaard
var KIOSK = (function() {
  try {
    var q = new URLSearchParams(location.search).get('kiosk');
    if (q === '1') localStorage.setItem('vh-kiosk', '1');
    if (q === '0') localStorage.removeItem('vh-kiosk');
    return localStorage.getItem('vh-kiosk') === '1';
  } catch (e) { return false; }
})();
if (KIOSK) document.body.classList.add('kiosk');
// de Thuis-pagina verdwijnt als alles wat erop staat uit is
if (!['lights','fridge','esphome','temperature','wasmachine','vaatwasser'].some(moduleOn)) document.body.classList.add('mod-off-thuis');

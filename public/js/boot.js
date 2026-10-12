var MODULES = {};
try { MODULES = JSON.parse(document.getElementById('modules-data').textContent); } catch (e) {}
function moduleOn(key) { return MODULES[key] !== false; }
Object.keys(MODULES).forEach(function(k) { if (!moduleOn(k)) document.body.classList.add('mod-off-' + k); });
// Wie er is ingelogd: { id, name, role }, of null zolang iedereen de gedeelde PIN gebruikt. Wat alleen de beheerder
// mag (data-admin) is voor een bewoner verborgen; de server weigert het ook.
var ME = null;
try { ME = JSON.parse(document.getElementById('user-data').textContent); } catch (e) {}
if (ME && ME.role !== 'admin') document.body.classList.add('not-admin');
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

// Thema: donker, licht of automatisch (volgt het apparaat). De keuze blijft op dit apparaat bewaard.
// Dit script staat in de kop van elke pagina, vóór de stylesheets, zodat de pagina niet eerst donker oplicht.
(function() {
  var KEY = 'vh-theme';
  var light = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
  function get() {
    try { var v = localStorage.getItem(KEY); return v === 'light' || v === 'auto' ? v : 'dark'; } catch (e) { return 'dark'; }
  }
  function apply() {
    var pref = get();
    var theme = pref === 'auto' ? (light && light.matches ? 'light' : 'dark') : pref;
    document.documentElement.dataset.theme = theme;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === 'light' ? '#F2F4F8' : '#0C0F1D';
    return theme;
  }
  function changed() { apply(); document.dispatchEvent(new Event('vh-theme')); }
  window.vhTheme = {
    get: get,
    set: function(pref) { try { localStorage.setItem(KEY, pref); } catch (e) {} changed(); }
  };
  apply();
  if (light && light.addEventListener) light.addEventListener('change', function() { if (get() === 'auto') changed(); });
  // de kleur van de browserbalk staat in een meta-tag die pas na dit script komt
  document.addEventListener('DOMContentLoaded', apply);
})();

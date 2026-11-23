// Kleur-helpers voor LED-acties in flows: hex-code → {r,g,b}, en kleurtemperatuur (Kelvin) → {r,g,b}.
// Puur rekenwerk zonder state, dus los herbruikbaar.

function hexToRgb(hex) {
  hex = (hex || '#ffffff').replace('#', '');
  if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  return {
    r: parseInt(hex.slice(0,2), 16) || 255,
    g: parseInt(hex.slice(2,4), 16) || 255,
    b: parseInt(hex.slice(4,6), 16) || 255
  };
}

// Tanner Helland algorithm: Kelvin (1000–40000) → {r,g,b} (0–255)
function kelvinToRgb(kelvin) {
  var temp = Math.max(1000, Math.min(40000, kelvin)) / 100;
  var r, g, b;

  // Red
  if (temp <= 66) {
    r = 255;
  } else {
    r = temp - 60;
    r = 329.698727446 * Math.pow(r, -0.1332047592);
    r = Math.max(0, Math.min(255, r));
  }

  // Green
  if (temp <= 66) {
    g = temp;
    g = 99.4708025861 * Math.log(g) - 161.1195681661;
  } else {
    g = temp - 60;
    g = 288.1221695283 * Math.pow(g, -0.0755148492);
  }
  g = Math.max(0, Math.min(255, g));

  // Blue
  if (temp >= 66) {
    b = 255;
  } else if (temp <= 19) {
    b = 0;
  } else {
    b = temp - 10;
    b = 138.5177312231 * Math.log(b) - 305.0447927307;
    b = Math.max(0, Math.min(255, b));
  }

  return { r: Math.round(r), g: Math.round(g), b: Math.round(b) };
}

module.exports = { hexToRgb: hexToRgb, kelvinToRgb: kelvinToRgb };

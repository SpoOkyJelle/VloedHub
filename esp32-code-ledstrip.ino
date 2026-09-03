/*
 * WS2812B LED strip controller voor ESP32 — met VloedHub integratie
 * Bibliotheek: FastLED (Arduino Library Manager)
 *
 * De ESP32 vraagt elke 500 ms de gewenste staat op van de hub:
 *   GET http://SERVER_HOST:5000/api/led/state
 *   → {"on":true,"effect":3,"brightness":180,"color":{"r":255,"g":255,"b":255}}
 *
 * Effect 10 ("Eigen kleur", gekozen via de kleurenkiezer in het dashboard)
 * gebruikt het "color"-veld; de andere effecten (0-9) negeren het.
 *
 * Pas NUM_LEDS aan naar jouw strip:
 *   30 LEDs/m × 1.8m =  54
 *   60 LEDs/m × 1.8m = 108  ← standaard
 *  144 LEDs/m × 1.8m = 259
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <FastLED.h>

// ── Configuratie ──────────────────────────────────────────────
// EDIT: uniek per ESP32 (bv. "ledstrip-huidige", "ledstrip-nieuw"), zodat je
// de bordjes in de Serial Monitor / op het netwerk uit elkaar kunt houden.
// Beide bordjes volgen dezelfde gedeelde staat uit /api/led/state, dus ze
// werken automatisch samen: verander je op één plek het effect, dan doen
// alle aangesloten strips hetzelfde.
const char* DEVICE_ID = "ledstrip-nieuw";

#define LED_PIN      19
#define NUM_LEDS     259
#define LED_TYPE     WS2812B
#define COLOR_ORDER  GRB

const char* WIFI_SSID     = "Ziggo4680326";
const char* WIFI_PASSWORD = "eyrfTfdp77gfdrxt";
const char* SERVER_HOST   = "192.168.178.10";
const int   SERVER_PORT   = 5000;

const unsigned long POLL_INTERVAL = 500;
const unsigned long RECONNECT_INTERVAL = 30000;

// ── State ─────────────────────────────────────────────────────
CRGB leds[NUM_LEDS];

bool    ledOn         = true;
int     ledEffect     = 0;
uint8_t ledBrightness = 180;

uint8_t  gHue      = 0;
int      breathVal = 255;
int      breathDir = -1;
CRGB     customColor = CRGB::White;

unsigned long lastPoll        = 0;
unsigned long lastWifiAttempt = 0;

// ── Setup ─────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  FastLED.addLeds<LED_TYPE, LED_PIN, COLOR_ORDER>(leds, NUM_LEDS)
         .setCorrection(TypicalLEDStrip);
  FastLED.setBrightness(ledBrightness);
  connectWiFi();
}

// ── Loop ──────────────────────────────────────────────────────
void loop() {
  maintainWiFi();
  pollServer();

  if (!ledOn) {
    fill_solid(leds, NUM_LEDS, CRGB::Black);
    FastLED.show();
    delay(50);
    return;
  }

  FastLED.setBrightness(ledBrightness);

  switch (ledEffect) {
    case 0: fxWarmWit();     break;
    case 1: fxIjsWit();      break;
    case 2: fxRainbow();     break;
    case 3: fxRainbowWave(); break;
    case 4: fxFade();        break;
    case 5: fxConfetti();    break;
    case 6: fxVuur();        break;
    case 7: fxMeteor();      break;
    case 8: fxTwinkle();     break;
    case 9: fxPolitie();     break;
    case 10: fxEigenKleur(); break;
  }
}

// ── WiFi ──────────────────────────────────────────────────────
String uniqueHostname() {
  uint8_t mac[6];
  WiFi.macAddress(mac);
  char suffix[6];
  snprintf(suffix, sizeof(suffix), "%02X%02X", mac[4], mac[5]);
  return String(DEVICE_ID) + "-" + suffix;
}

void connectWiFi() {
  WiFi.mode(WIFI_STA);
  String hostname = uniqueHostname();
  WiFi.setHostname(hostname.c_str());
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("WiFi verbinden als " + hostname);
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 10000) {
    delay(300);
    Serial.print(".");
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nVerbonden: " + WiFi.localIP().toString());
  } else {
    Serial.println("\nMislukt, later opnieuw");
  }
}

void maintainWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  if (millis() - lastWifiAttempt < RECONNECT_INTERVAL) return;
  lastWifiAttempt = millis();
  connectWiFi();
}

// ── Server polling ────────────────────────────────────────────
void pollServer() {
  if (millis() - lastPoll < POLL_INTERVAL) return;
  lastPoll = millis();
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  String url = "http://" + String(SERVER_HOST) + ":" + SERVER_PORT + "/api/led/state";
  http.begin(url);
  http.setTimeout(400);
  int code = http.GET();

  if (code == 200) {
    String body = http.getString();
    // Parse "on"
    ledOn = body.indexOf("\"on\":true") >= 0;
    // Parse "effect"
    int ei = body.indexOf("\"effect\":");
    if (ei >= 0) ledEffect = body.substring(ei + 9).toInt();
    // Parse "brightness"
    int bi = body.indexOf("\"brightness\":");
    if (bi >= 0) ledBrightness = (uint8_t)constrain(body.substring(bi + 13).toInt(), 10, 255);
    // Parse "color":{"r":..,"g":..,"b":..}
    int ci = body.indexOf("\"color\":");
    if (ci >= 0) {
      String colorPart = body.substring(ci);
      int ri = colorPart.indexOf("\"r\":");
      int gi = colorPart.indexOf("\"g\":");
      int biC = colorPart.indexOf("\"b\":");
      if (ri >= 0 && gi >= 0 && biC >= 0) {
        int r = constrain(colorPart.substring(ri + 4).toInt(), 0, 255);
        int g = constrain(colorPart.substring(gi + 4).toInt(), 0, 255);
        int b = constrain(colorPart.substring(biC + 4).toInt(), 0, 255);
        customColor = CRGB(r, g, b);
      }
    }
  }
  http.end();
}

// ── Effects (non-blocking, millis gebaseerd) ──────────────────

void fxWarmWit() {
  static unsigned long t = 0;
  if (millis() - t < 100) return; t = millis();
  fill_solid(leds, NUM_LEDS, CRGB(255, 160, 60));
  FastLED.show();
}

void fxIjsWit() {
  static unsigned long t = 0;
  if (millis() - t < 100) return; t = millis();
  fill_solid(leds, NUM_LEDS, CRGB(180, 210, 255));
  FastLED.show();
}

void fxRainbow() {
  static unsigned long t = 0;
  if (millis() - t < 20) return; t = millis();
  fill_solid(leds, NUM_LEDS, CHSV(gHue++, 255, 255));
  FastLED.show();
}

void fxRainbowWave() {
  static unsigned long t = 0;
  if (millis() - t < 15) return; t = millis();
  for (int i = 0; i < NUM_LEDS; i++)
    leds[i] = CHSV(gHue + (uint8_t)(i * 256 / NUM_LEDS), 255, 255);
  gHue++;
  FastLED.show();
}

void fxFade() {
  static unsigned long t = 0;
  if (millis() - t < 12) return; t = millis();
  fill_solid(leds, NUM_LEDS, CRGB(255, 160, 60));
  FastLED.setBrightness((uint8_t)breathVal);
  FastLED.show();
  breathVal += breathDir * 3;
  if (breathVal <= 8)   { breathVal = 8;   breathDir = 1; }
  if (breathVal >= 255) { breathVal = 255;  breathDir = -1; }
}

void fxConfetti() {
  static unsigned long t = 0;
  if (millis() - t < 18) return; t = millis();
  fadeToBlackBy(leds, NUM_LEDS, 10);
  leds[random16(NUM_LEDS)] += CHSV(gHue + random8(64), 220, 255);
  gHue++;
  FastLED.show();
}

void fxVuur() {
  static unsigned long t = 0;
  if (millis() - t < 25) return; t = millis();
  static byte heat[NUM_LEDS];
  for (int i = 0; i < NUM_LEDS; i++)
    heat[i] = qsub8(heat[i], random8(0, 25));
  for (int i = NUM_LEDS - 1; i >= 2; i--)
    heat[i] = (heat[i-1] + heat[i-2] + heat[i-2]) / 3;
  if (random8() < 130)
    heat[random8(6)] = qadd8(heat[random8(6)], random8(160, 255));
  for (int i = 0; i < NUM_LEDS; i++)
    leds[i] = HeatColor(heat[i]);
  FastLED.show();
}

void fxMeteor() {
  static unsigned long t = 0;
  static int pos = -10;
  if (millis() - t < 18) return; t = millis();
  const int TRAIL = 10;
  fadeToBlackBy(leds, NUM_LEDS, 80);
  for (int i = 0; i < TRAIL; i++) {
    int p = pos - i;
    if (p >= 0 && p < NUM_LEDS)
      leds[p] = CRGB(255 - i * 25, 255 - i * 25, 255 - i * 25);
  }
  if (++pos > NUM_LEDS + TRAIL) pos = -TRAIL;
  FastLED.show();
}

void fxTwinkle() {
  static unsigned long t = 0;
  if (millis() - t < 30) return; t = millis();
  fadeToBlackBy(leds, NUM_LEDS, 15);
  if (random8() < 70)
    leds[random16(NUM_LEDS)] = CRGB::White;
  FastLED.show();
}

void fxEigenKleur() {
  static unsigned long t = 0;
  if (millis() - t < 100) return; t = millis();
  fill_solid(leds, NUM_LEDS, customColor);
  FastLED.show();
}

void fxPolitie() {
  static unsigned long t = 0;
  static uint8_t step = 0;
  if (millis() - t < 80) return; t = millis();
  fill_solid(leds, NUM_LEDS, CRGB::Black);
  if      (step < 3) fill_solid(leds, NUM_LEDS / 2, CRGB::Red);
  else if (step < 6) {}
  else if (step < 9) fill_solid(leds + NUM_LEDS / 2, NUM_LEDS / 2, CRGB::Blue);
  step = (step + 1) % 12;
  FastLED.show();
}

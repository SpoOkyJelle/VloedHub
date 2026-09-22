/*
 * WS2812B LED strip controller voor ESP32 — Ledstrip Keuken (VloedHub)
 * Bibliotheek: FastLED (Arduino Library Manager)
 *
 * Bij opstarten: direct puur wit (werklicht), nog vóór WiFi.
 * Na verbinden wordt die staat naar de hub gestuurd, daarna volgt de
 * strip het dashboard:
 *   GET/POST http://SERVER_HOST:5000/api/led/state?device=keuken
 *
 * Effecten (zelfde volgorde als LED_EFFECTS in het dashboard):
 *   0 Warm Wit      1 Ijs Wit       2 Rainbow       3 Rainbow Wave
 *   4 Fade Aan/Uit  5 Confetti      6 Vuur          7 Meteor Regen
 *   8 Twinkle       9 Politielichten 10 Eigen kleur
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <FastLED.h>

// ── Configuratie ──────────────────────────────────────────────
const char* DEVICE_ID  = "ledstrip-keuken";  // hostname op het netwerk
const char* HUB_DEVICE = "keuken";           // ?device=... in VloedHub

#define LED_PIN      19
#define NUM_LEDS     259
#define LED_TYPE     WS2812B
#define COLOR_ORDER  GRB
#define NUM_EFFECTS  11

#define BOOT_EFFECT      10    // Eigen kleur
#define BOOT_BRIGHTNESS  191   // 75%
const CRGB BOOT_COLOR = CRGB(255, 255, 255);  // puur wit

const char* WIFI_SSID     = "Ziggo4680326";
const char* WIFI_PASSWORD = "eyrfTfdp77gfdrxt";
const char* SERVER_HOST   = "192.168.178.10";
const int   SERVER_PORT   = 5000;

const unsigned long POLL_INTERVAL      = 500;
const unsigned long RECONNECT_INTERVAL = 30000;

String stateUrl() {
  return "http://" + String(SERVER_HOST) + ":" + SERVER_PORT +
         "/api/led/state?device=" + HUB_DEVICE;
}

// ── State ─────────────────────────────────────────────────────
CRGB leds[NUM_LEDS];

bool    ledOn         = true;
int     ledEffect     = BOOT_EFFECT;
uint8_t ledBrightness = BOOT_BRIGHTNESS;
CRGB    customColor   = BOOT_COLOR;

bool bootStatePushed = false;   // is de opstartstaat al naar de hub gestuurd?

uint8_t gHue      = 0;
int     breathVal = 255;
int     breathDir = -1;

unsigned long lastPoll        = 0;
unsigned long lastWifiAttempt = 0;

// ── Setup ─────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);

  // Direct werklicht aan, nog vóór WiFi
  FastLED.addLeds<LED_TYPE, LED_PIN, COLOR_ORDER>(leds, NUM_LEDS)
         .setCorrection(TypicalLEDStrip);
  FastLED.setBrightness(ledBrightness);
  fill_solid(leds, NUM_LEDS, customColor);
  FastLED.show();

  delay(200);
  Serial.printf("\n[BOOT] %s (hub device: %s) - werklicht aan\n", DEVICE_ID, HUB_DEVICE);

  connectWiFi();
}

// ── Loop ──────────────────────────────────────────────────────
void loop() {
  maintainWiFi();
  pushBootState();
  pollServer();

  if (!ledOn) {
    fill_solid(leds, NUM_LEDS, CRGB::Black);
    FastLED.show();
    delay(50);
    return;
  }

  if (ledEffect != 4) FastLED.setBrightness(ledBrightness);  // Fade regelt zelf de helderheid

  switch (ledEffect) {
    case 0:  fxWarmWit();     break;
    case 1:  fxIjsWit();      break;
    case 2:  fxRainbow();     break;
    case 3:  fxRainbowWave(); break;
    case 4:  fxFade();        break;
    case 5:  fxConfetti();    break;
    case 6:  fxVuur();        break;
    case 7:  fxMeteor();      break;
    case 8:  fxTwinkle();     break;
    case 9:  fxPolitie();     break;
    case 10: fxEigenKleur();  break;
  }
}

// ── WiFi ──────────────────────────────────────────────────────
void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.setHostname(DEVICE_ID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("[WIFI] Verbinden");

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 10000) {
    delay(300);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WIFI] Verbonden: " + WiFi.localIP().toString());
    Serial.println("[HUB] Pollt " + stateUrl());
  } else {
    Serial.println("\n[WIFI] Mislukt, later opnieuw");
  }
}

void maintainWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  if (millis() - lastWifiAttempt < RECONNECT_INTERVAL) return;
  lastWifiAttempt = millis();
  connectWiFi();
}

// ── Opstartstaat naar de hub sturen (eenmalig) ────────────────
void pushBootState() {
  if (bootStatePushed) return;
  if (WiFi.status() != WL_CONNECTED) return;

  static unsigned long lastTry = 0;
  if (lastTry != 0 && millis() - lastTry < 2000) return;  // niet spammen bij fouten
  lastTry = millis();

  char json[128];
  snprintf(json, sizeof(json),
           "{\"on\":true,\"effect\":%d,\"brightness\":%d,\"color\":{\"r\":%d,\"g\":%d,\"b\":%d}}",
           BOOT_EFFECT, BOOT_BRIGHTNESS, BOOT_COLOR.r, BOOT_COLOR.g, BOOT_COLOR.b);

  HTTPClient http;
  http.begin(stateUrl());
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(1500);
  int code = http.POST(json);
  http.end();

  if (code == 200) {
    bootStatePushed = true;
    Serial.println("[HUB] Opstartstaat verstuurd: " + String(json));
  } else {
    Serial.printf("[HUB] Opstartstaat versturen mislukt: %d, opnieuw proberen\n", code);
  }
}

// ── Server polling ────────────────────────────────────────────
void pollServer() {
  if (!bootStatePushed) return;   // eerst de hub op "aan" zetten, anders zet de eerste poll hem uit
  if (millis() - lastPoll < POLL_INTERVAL) return;
  lastPoll = millis();
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  http.begin(stateUrl());
  http.setTimeout(1500);
  int code = http.GET();

  if (code == 200) {
    String body = http.getString();

    bool    newOn         = body.indexOf("\"on\":true") >= 0;
    int     newEffect     = ledEffect;
    uint8_t newBrightness = ledBrightness;
    CRGB    newColor      = customColor;

    int ei = body.indexOf("\"effect\":");
    if (ei >= 0) newEffect = constrain(body.substring(ei + 9).toInt(), 0, NUM_EFFECTS - 1);

    int bi = body.indexOf("\"brightness\":");
    if (bi >= 0) newBrightness = (uint8_t)constrain(body.substring(bi + 13).toInt(), 10, 255);

    int ci = body.indexOf("\"color\":");
    if (ci >= 0) {
      String c = body.substring(ci);
      int ri = c.indexOf("\"r\":");
      int gi = c.indexOf("\"g\":");
      int bi2 = c.indexOf("\"b\":");
      if (ri >= 0 && gi >= 0 && bi2 >= 0) {
        newColor = CRGB(constrain(c.substring(ri + 4).toInt(), 0, 255),
                        constrain(c.substring(gi + 4).toInt(), 0, 255),
                        constrain(c.substring(bi2 + 4).toInt(), 0, 255));
      }
    }

    if (newOn != ledOn || newEffect != ledEffect ||
        newBrightness != ledBrightness || newColor != customColor) {
      Serial.println("[HUB] " + body);
      Serial.printf("[HUB] on=%d effect=%d brightness=%d color=%d,%d,%d\n",
                    newOn, newEffect, newBrightness, newColor.r, newColor.g, newColor.b);
    }

    ledOn         = newOn;
    ledEffect     = newEffect;
    ledBrightness = newBrightness;
    customColor   = newColor;
  } else {
    Serial.printf("[HUB] HTTP fout: %d\n", code);
  }
  http.end();
}

// ── Effecten (non-blocking, millis gebaseerd) ─────────────────

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
  FastLED.setBrightness((uint8_t)map(breathVal, 0, 255, 0, ledBrightness));
  FastLED.show();
  breathVal += breathDir * 3;
  if (breathVal <= 8)   { breathVal = 8;   breathDir = 1; }
  if (breathVal >= 255) { breathVal = 255; breathDir = -1; }
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
  static byte heat[NUM_LEDS];
  if (millis() - t < 25) return; t = millis();
  for (int i = 0; i < NUM_LEDS; i++)
    heat[i] = qsub8(heat[i], random8(0, 25));
  for (int i = NUM_LEDS - 1; i >= 2; i--)
    heat[i] = (heat[i - 1] + heat[i - 2] + heat[i - 2]) / 3;
  if (random8() < 130) {
    int y = random8(6);
    heat[y] = qadd8(heat[y], random8(160, 255));
  }
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

void fxPolitie() {
  static unsigned long t = 0;
  static uint8_t step = 0;
  if (millis() - t < 80) return; t = millis();
  fill_solid(leds, NUM_LEDS, CRGB::Black);
  if      (step < 3) fill_solid(leds, NUM_LEDS / 2, CRGB::Red);
  else if (step < 6) {}
  else if (step < 9) fill_solid(leds + NUM_LEDS / 2, NUM_LEDS - NUM_LEDS / 2, CRGB::Blue);
  step = (step + 1) % 12;
  FastLED.show();
}

void fxEigenKleur() {
  static unsigned long t = 0;
  if (millis() - t < 100) return; t = millis();
  fill_solid(leds, NUM_LEDS, customColor);
  FastLED.show();
}
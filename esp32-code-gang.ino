/*
 * Gang ESP32 — LED-strip + relais voor VloedHub
 *
 * Dit bordje bestuurt twee dingen tegelijk:
 *   1. Een WS2812B LED-strip (gang sfeerverlichting)
 *   2. Een relais dat een gewone lamp schakelt
 *
 * LED-strip staat wordt opgehaald via:
 *   GET http://SERVER_HOST:5000/api/led/state?device=gang
 *   → {"on":true,"effect":0,"brightness":180,"color":{"r":255,"g":255,"b":255}}
 *
 * Relais staat wordt opgehaald via:
 *   GET http://SERVER_HOST:5000/api/relay/state?device=gang
 *   → {"on":false}
 *
 * Beide worden elke 500 ms gepolled. Flows en het dashboard kunnen
 * de LED-strip én het relais onafhankelijk van elkaar aansturen.
 *
 * Bibliotheek: FastLED (installeren via Arduino Library Manager)
 *
 * Aansluitingen:
 *   LED_PIN   → Data-in van de LED-strip (via 330Ω weerstand aanbevolen)
 *   RELAY_PIN → IN-pin van het relaismodule
 *
 * Relaismodules zijn meestal actief-laag (LOW = relais aan).
 * Zet RELAY_ACTIVE_LOW op false als jouw module actief-hoog is.
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <FastLED.h>

// ── Configuratie ──────────────────────────────────────────────
const char* DEVICE_ID  = "ledstrip-gang";
const char* LED_GROUP  = "gang";   // LED-staat van de server
const char* RELAY_GROUP = "gang";  // Relais-staat van de server

#define LED_PIN          19     // Data-pin LED-strip
#define NUM_LEDS         54     // Pas aan naar jouw strip (30 LEDs/m × 1.8m)
#define LED_TYPE         WS2812B
#define COLOR_ORDER      GRB

#define RELAY_PIN        18     // GPIO voor het relaismodule
#define RELAY_ACTIVE_LOW true   // true = LOW zet relais aan (meest gangbaar)

const char* WIFI_SSID     = "Ziggo4680326";
const char* WIFI_PASSWORD = "eyrfTfdp77gfdrxt";
const char* SERVER_HOST   = "192.168.178.10";
const int   SERVER_PORT   = 5000;

const unsigned long POLL_INTERVAL     = 500;
const unsigned long RECONNECT_INTERVAL = 30000;

// ── State ─────────────────────────────────────────────────────
CRGB leds[NUM_LEDS];

// LED-strip
bool    ledOn         = true;
int     ledEffect     = 0;
uint8_t ledBrightness = 180;
CRGB    customColor   = CRGB::White;

// Relais
bool relayOn = false;

// Animatie helpers
uint8_t gHue      = 0;
int     breathVal = 255;
int     breathDir = -1;

unsigned long lastPoll        = 0;
unsigned long lastRelayPoll   = 0;
unsigned long lastWifiAttempt = 0;

// ── Setup ─────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);

  // Relais initialiseren (standaard uit)
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, RELAY_ACTIVE_LOW ? HIGH : LOW);

  // LED-strip initialiseren
  FastLED.addLeds<LED_TYPE, LED_PIN, COLOR_ORDER>(leds, NUM_LEDS)
         .setCorrection(TypicalLEDStrip);
  FastLED.setBrightness(ledBrightness);

  connectWiFi();
}

// ── Loop ──────────────────────────────────────────────────────
void loop() {
  maintainWiFi();
  pollLed();
  pollRelay();

  // LED-strip renderen
  if (!ledOn) {
    fill_solid(leds, NUM_LEDS, CRGB::Black);
    FastLED.show();
    delay(50);
    return;
  }

  FastLED.setBrightness(ledBrightness);

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
    default: fxWarmWit();     break;
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

// ── LED-strip pollen ──────────────────────────────────────────
void pollLed() {
  if (millis() - lastPoll < POLL_INTERVAL) return;
  lastPoll = millis();
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  String url = "http://" + String(SERVER_HOST) + ":" + SERVER_PORT +
               "/api/led/state?device=" + String(LED_GROUP);
  http.begin(url);
  http.setTimeout(400);
  int code = http.GET();

  if (code == 200) {
    String body = http.getString();

    ledOn = body.indexOf("\"on\":true") >= 0;

    int ei = body.indexOf("\"effect\":");
    if (ei >= 0) ledEffect = body.substring(ei + 9).toInt();

    int bi = body.indexOf("\"brightness\":");
    if (bi >= 0) ledBrightness = (uint8_t)constrain(body.substring(bi + 13).toInt(), 10, 255);

    int ci = body.indexOf("\"color\":");
    if (ci >= 0) {
      String cp = body.substring(ci);
      int ri  = cp.indexOf("\"r\":");
      int gi  = cp.indexOf("\"g\":");
      int bci = cp.indexOf("\"b\":");
      if (ri >= 0 && gi >= 0 && bci >= 0) {
        customColor = CRGB(
          constrain(cp.substring(ri + 4).toInt(), 0, 255),
          constrain(cp.substring(gi + 4).toInt(), 0, 255),
          constrain(cp.substring(bci + 4).toInt(), 0, 255)
        );
      }
    }
  }
  http.end();
}

// ── Relais pollen ─────────────────────────────────────────────
void pollRelay() {
  if (millis() - lastRelayPoll < POLL_INTERVAL) return;
  lastRelayPoll = millis();
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  String url = "http://" + String(SERVER_HOST) + ":" + SERVER_PORT +
               "/api/relay/state?device=" + String(RELAY_GROUP);
  http.begin(url);
  http.setTimeout(400);
  int code = http.GET();

  if (code == 200) {
    String body = http.getString();
    bool newState = body.indexOf("\"on\":true") >= 0;

    if (newState != relayOn) {
      relayOn = newState;
      digitalWrite(RELAY_PIN, RELAY_ACTIVE_LOW ? !relayOn : relayOn);
      Serial.println(relayOn ? "Relais AAN" : "Relais UIT");
    }
  }
  http.end();
}

// ── LED effecten ──────────────────────────────────────────────

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
  if (breathVal <= 8)   { breathVal = 8;   breathDir =  1; }
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

void fxEigenKleur() {
  static unsigned long t = 0;
  if (millis() - t < 100) return; t = millis();
  fill_solid(leds, NUM_LEDS, customColor);
  FastLED.show();
}

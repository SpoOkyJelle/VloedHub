/*
 * TV-Meubel ESP32 — WS2812B LED-strip voor VloedHub
 *
 * Ondersteunde effecten (stel in via dashboard of flows):
 *
 *   Standaard:
 *   0  — Warm Wit       Vast warm wit (2700 K)
 *   1  — Ijs Wit        Vast koel wit (6500 K)
 *   2  — Rainbow        Alle LEDs één kleur, langzaam doordraaien
 *   3  — Rainbow Wave   Kleurverloop over de strip
 *   4  — Fade           Warm wit, rustig aan/uit ademen
 *   5  — Confetti       Willekeurige kleurspetters
 *   6  — Vuur           Vuurvlam simulatie
 *   7  — Meteor         Schietster met staart
 *   8  — Twinkle        Sterretjes die knipperen
 *   9  — Politie        Rood/blauw flitsen
 *   10 — Eigen Kleur    Vaste kleur via RGB-kleurenkiezer
 *
 *   TV-specifiek:
 *   11 — Film Modus     Heel dim warm amber, zachte ademhaling — ideaal bij films
 *   12 — Gaming         Snelle, felle rainbow wave
 *   13 — Sfeer Fade     Langzame overgang door warm kleurenpalet (zonsondergang)
 *   14 — Nacht          Minimaal dim blauwwit, bijna uit
 *   15 — Kaars          Warme flikker zoals een echte kaars
 *
 * LED-strip staat wordt opgehaald via:
 *   GET http://SERVER_HOST:5000/api/led/state?device=tv-meubel
 *   → {"on":true,"effect":0,"brightness":180,"color":{"r":255,"g":255,"b":255}}
 *
 * Bibliotheek: FastLED (installeren via Arduino Library Manager)
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <FastLED.h>

// ═══════════════════════════════════════════════════════════════
//  CONFIGURATIE — pas hier alles aan voor jouw opstelling
// ═══════════════════════════════════════════════════════════════

// --- WiFi ---
const char* WIFI_SSID     = "Ziggo4680326";
const char* WIFI_PASSWORD = "eyrfTfdp77gfdrxt";

// --- VloedHub server ---
const char* SERVER_HOST   = "192.168.178.10";
const int   SERVER_PORT   = 5000;

// --- Device-identiteit (moet uniek zijn in VloedHub) ---
const char* DEVICE_ID  = "ledstrip-tv-meubel";  // naam voor WiFi hostname
const char* LED_GROUP  = "tv-meubel";            // groep-naam in de LED-API

// --- LED-strip hardware ---
#define LED_PIN      19        // GPIO data-pin (via 330Ω weerstand aanbevolen)
#define NUM_LEDS     120       // Aantal LEDs op jouw strip — aanpassen!
#define LED_TYPE     WS2812B
#define COLOR_ORDER  GRB

// --- Polling & reconnect ---
const unsigned long POLL_INTERVAL      = 100;    // ms tussen server-polls
const unsigned long RECONNECT_INTERVAL = 30000;  // ms voor WiFi-herverbinding

// --- Film Modus (effect 11) ---
//   Kleur en ademhaling zijn instelbaar; brightness via dashboard = plafond.
#define FILM_BREATH_STEP  1                       // stapgrootte (1=heel traag, 5=snel)
#define FILM_MIN_BRIGHT   6                       // laagste helderheid tijdens ademen
#define FILM_COLOR        CRGB(255, 110, 20)      // diep amber (warm bioscooplicht)

// --- Gaming (effect 12) ---
#define GAMING_SPEED_MS   8    // ms per frame (lager = sneller)

// --- Sfeer Fade (effect 13) ---
#define SFEER_STEP_MS     40   // ms per kleurstap (hoger = langzamer)

// --- Nacht (effect 14) ---
//   Overschrijft server-brightness zodat dit effect altijd heel dim blijft.
#define NACHT_BRIGHTNESS  12   // 0–255

// --- Kaars (effect 15) ---
#define KAARS_FLICKER_MS    35  // ms per frame
#define KAARS_FLICKER_RANGE 60  // grootte van de flikker (0–255)

// ═══════════════════════════════════════════════════════════════

CRGB leds[NUM_LEDS];

bool    ledOn         = true;
int     ledEffect     = 0;
uint8_t ledBrightness = 180;
CRGB    customColor   = CRGB::White;

uint8_t gHue = 0;

int breathVal = 255;
int breathDir = -1;

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
  pollLed();

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
    case 11: fxFilm();        break;
    case 12: fxGaming();      break;
    case 13: fxSfeerFade();   break;
    case 14: fxNacht();       break;
    case 15: fxKaars();       break;
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
  if (WiFi.status() == WL_CONNECTED)
    Serial.println("\nVerbonden: " + WiFi.localIP().toString());
  else
    Serial.println("\nMislukt, later opnieuw");
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

// ═══════════════════════════════════════════════════════════════
//  STANDAARD EFFECTEN (0–10)
// ═══════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════
//  TV-SPECIFIEKE EFFECTEN (11–15)
// ═══════════════════════════════════════════════════════════════

// Effect 11 — Film Modus
// Diep warm amber dat heel langzaam in- en uitademt.
// Ideaal als bias-verlichting achter de TV bij het kijken van films.
// Server-brightness werkt als bovengrens voor de ademhaling.
void fxFilm() {
  static unsigned long t           = 0;
  static int           filmBreath  = FILM_MIN_BRIGHT;
  static int           filmDir     = 1;
  if (millis() - t < 15) return; t = millis();

  fill_solid(leds, NUM_LEDS, FILM_COLOR);
  FastLED.setBrightness((uint8_t)filmBreath);
  FastLED.show();

  filmBreath += filmDir * FILM_BREATH_STEP;
  if (filmBreath <= FILM_MIN_BRIGHT) { filmBreath = FILM_MIN_BRIGHT; filmDir =  1; }
  if (filmBreath >= ledBrightness)   { filmBreath = ledBrightness;   filmDir = -1; }
}

// Effect 12 — Gaming
// Snelle, felle rainbow wave over de hele strip.
void fxGaming() {
  static unsigned long t = 0;
  if (millis() - t < GAMING_SPEED_MS) return; t = millis();
  for (int i = 0; i < NUM_LEDS; i++)
    leds[i] = CHSV(gHue + (uint8_t)(i * 256 / NUM_LEDS), 255, 255);
  gHue += 3;
  FastLED.show();
}

// Effect 13 — Sfeer Fade
// Langzame overgang door zonsondergangkleuren: geel → oranje → rood → terug.
void fxSfeerFade() {
  static unsigned long t   = 0;
  static uint8_t       hue = 0;
  static int8_t        dir = 1;
  if (millis() - t < SFEER_STEP_MS) return; t = millis();
  fill_solid(leds, NUM_LEDS, CHSV(hue, 200, 255));
  FastLED.show();
  hue += dir;
  if (hue >= 64) { hue = 64; dir = -1; }
  if (hue == 0)  { hue = 0;  dir =  1; }
}

// Effect 14 — Nacht
// Minimaal dim blauwwit. Negeert server-brightness en blijft altijd op
// NACHT_BRIGHTNESS zodat je 's nachts niet verblind wordt.
void fxNacht() {
  static unsigned long t = 0;
  if (millis() - t < 200) return; t = millis();
  FastLED.setBrightness(NACHT_BRIGHTNESS);
  fill_solid(leds, NUM_LEDS, CRGB(80, 100, 160));
  FastLED.show();
}

// Effect 15 — Kaars
// Warm oranjegeel licht met willekeurige flikker per LED.
void fxKaars() {
  static unsigned long t = 0;
  if (millis() - t < KAARS_FLICKER_MS) return; t = millis();
  for (int i = 0; i < NUM_LEDS; i++) {
    uint8_t flicker = random8(KAARS_FLICKER_RANGE);
    leds[i] = CRGB(
      constrain(240 - flicker,     0, 255),
      constrain(80  - flicker / 2, 0, 255),
      constrain(10  - flicker / 8, 0, 255)
    );
  }
  FastLED.show();
}

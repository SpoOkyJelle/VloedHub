#include <FastLED.h>

#define NUM_LEDS 128
#define LED_PIN 19

// Warm white ~2700K approximation
#define WARM_WHITE CRGB(255, 167, 63)

CRGB leds[NUM_LEDS];

void setup() {
  Serial.begin(9600);
  FastLED.addLeds<NEOPIXEL, LED_PIN>(leds, NUM_LEDS);
  FastLED.setBrightness(255);
  fill_solid(leds, NUM_LEDS, CRGB::White);
  FastLED.show();
}

void loop() {
}

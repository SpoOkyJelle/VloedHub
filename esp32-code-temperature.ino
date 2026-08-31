#include <WiFi.h>
#include <HTTPClient.h>

// ============================================================
//  UNIEKE CONFIGURATIE PER ESP32 — PAS DIT AAN VOOR ELK BORDJE
// ============================================================
// Flash je meerdere ESP32's (één per kamer/locatie, elk met één of
// meer LM35DZ sensoren), verander dan voor elk bordje in elk geval
// DEVICE_ID en de SENSOR_ROOMS hieronder. De WiFi-hostname krijgt
// automatisch een uniek suffix (op basis van het MAC-adres) zodat
// bordjes elkaar nooit in de weg zitten, ook al vergeet je DEVICE_ID
// aan te passen — maar DEVICE_ID is wat je in de app terugziet, dus
// maak dat wel herkenbaar.

const char* DEVICE_ID = "temp-node-1"; // EDIT: uniek per ESP32, bv. temp-node-1, temp-node-2, ...

#define SENSOR_COUNT 1 // hoeveel LM35DZ sensoren zitten er op DIT bordje?

const int   SENSOR_PINS[SENSOR_COUNT]  = { 34 };          // analoge pin(nen) op dit bordje
const char* SENSOR_ROOMS[SENSOR_COUNT] = { "Slaapkamer_Jelle" }; // EDIT: kamer/locatie per sensor, moet uniek zijn over al je bordjes

// ---------- WiFi settings ----------
const char* WIFI_SSID     = "Ziggo4680326";
const char* WIFI_PASSWORD = "eyrfTfdp77gfdrxt";

// ---------- Server settings ----------
const char* SERVER_HOST = "192.168.178.10";
const int   SERVER_PORT = 5000;
const char* SERVER_PATH = "/api/temperature";

// ---------- LM35DZ ----------
// 10mV per graad Celsius, lineair vanaf 0V = 0°C
// ESP32 ADC: 12-bit (0-4095), voedingsreferentie 3.3V
const float ADC_MAX_VALUE = 4095.0;
const float ADC_REF_VOLTAGE = 3.3;
const float ADC_VOLTAGE_CORRECTION = 2.0; // board heeft voltage divider op ADC pins (meting is altijd /2)
const int   SAMPLES_PER_READING = 16; // middelen tegen ADC-ruis

const unsigned long UPLOAD_INTERVAL_MS  = 60000; // elke 60 sec een meting versturen
const unsigned long DEBUG_LOG_INTERVAL  = 2000;  // DEBUG: elke 2 sec loggen

unsigned long lastDebugLog = 0;
const unsigned long RECONNECT_INTERVAL  = 30000; // ms tussen WiFi-reconnect pogingen

unsigned long lastUpload = 0;
unsigned long lastWifiAttempt = 0;

void setup() {
  Serial.begin(115200);
  analogSetAttenuation(ADC_11db); // 0-3.3V bereik
  for (int i = 0; i < SENSOR_COUNT; i++) {
    pinMode(SENSOR_PINS[i], INPUT);
  }

  connectWiFi();

  Serial.print("Device ID: ");
  Serial.println(DEVICE_ID);
  Serial.println("Setup completed");
}

void loop() {
  unsigned long now = millis();

  maintainWiFi(now);

  // DEBUG: elke 2 sec raw + temp loggen
  if (now - lastDebugLog >= DEBUG_LOG_INTERVAL) {
    lastDebugLog = now;
    for (int i = 0; i < SENSOR_COUNT; i++) {
      int raw = analogRead(SENSOR_PINS[i]);
      float voltage = raw / ADC_MAX_VALUE * ADC_REF_VOLTAGE * ADC_VOLTAGE_CORRECTION;
      float temp = voltage * 100.0;
      Serial.printf("[DEBUG] pin%d  raw=%d  voltage=%.3fV  temp=%.2fC\n", SENSOR_PINS[i], raw, voltage, temp);
    }
  }

  if (now - lastUpload < UPLOAD_INTERVAL_MS && lastUpload != 0) return;
  lastUpload = now;

  float tempC[SENSOR_COUNT];
  for (int i = 0; i < SENSOR_COUNT; i++) {
    tempC[i] = readTemperature(SENSOR_PINS[i]);
    Serial.printf("[%s] %s: %.1f C (pin %d)\n", DEVICE_ID, SENSOR_ROOMS[i], tempC[i], SENSOR_PINS[i]);
  }

  sendReadings(tempC);
}

// LM35DZ: 10mV/°C, lineair vanaf 0V = 0°C
float readTemperature(int pin) {
  long sum = 0;
  for (int i = 0; i < SAMPLES_PER_READING; i++) {
    sum += analogRead(pin);
    delay(2);
  }
  float raw = (float)sum / SAMPLES_PER_READING;
  float voltage = raw / ADC_MAX_VALUE * ADC_REF_VOLTAGE * ADC_VOLTAGE_CORRECTION;
  return voltage * 100.0; // 10mV/°C -> V * 100 = graden Celsius
}

// Voegt een suffix op basis van het MAC-adres toe aan DEVICE_ID, zodat de
// WiFi-hostname altijd uniek is op het netwerk, ook bij een dubbele DEVICE_ID.
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

  Serial.print("Connecting to WiFi as ");
  Serial.print(hostname);
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
    delay(500);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println();
    Serial.print("WiFi connected, IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println();
    Serial.println("WiFi connect failed, will retry in background");
  }
}

void maintainWiFi(unsigned long now) {
  if (WiFi.status() == WL_CONNECTED) return;
  if (now - lastWifiAttempt < RECONNECT_INTERVAL) return;
  lastWifiAttempt = now;
  Serial.println("WiFi disconnected, reconnecting...");
  connectWiFi();
}

void sendReadings(float tempC[SENSOR_COUNT]) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi not connected, skipping upload");
    return;
  }

  HTTPClient http;
  String url = String("http://") + SERVER_HOST + ":" + SERVER_PORT + SERVER_PATH;
  http.begin(url);
  http.addHeader("Content-Type", "application/json");

  String payload = String("{\"device\":\"") + DEVICE_ID + "\",\"readings\":[";
  for (int i = 0; i < SENSOR_COUNT; i++) {
    if (i > 0) payload += ",";
    payload += "{\"room\":\"" + String(SENSOR_ROOMS[i]) + "\",\"temp_c\":" + String(tempC[i], 1) + "}";
  }
  payload += "]}";

  int httpCode = http.POST(payload);

  if (httpCode > 0) {
    Serial.printf("Upload OK, HTTP %d\n", httpCode);
  } else {
    Serial.printf("Upload failed: %s\n", http.errorToString(httpCode).c_str());
  }

  http.end();
}

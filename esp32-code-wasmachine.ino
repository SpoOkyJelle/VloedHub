#include <WiFi.h>
#include <HTTPClient.h>

// ---------- WiFi settings ----------
const char* WIFI_SSID     = "Ziggo4680326";
const char* WIFI_PASSWORD = "eyrfTfdp77gfdrxt";
const char* HOSTNAME      = "GoonESP32-Wasmachine";

// ---------- Server settings ----------
const char* SERVER_HOST = "192.168.178.10";
const int   SERVER_PORT = 5000;
const char* SERVER_PATH = "/api/wasmachine";

// ---------- LDR ----------
#define LDR_PIN 34

// Kalibratie: open de Serial Monitor (115200 baud) en kijk naar de "LDR raw"
// waarden met het klaar-lampje uit vs aan. Zet THRESHOLD er tussenin.
// Let op omgevingslicht (dag/avond) — eventueel een kokertje om de LDR helpt.
int THRESHOLD = 2000;

const unsigned long CONFIRM_TIME      = 5000;   // ms aanhoudend licht = echt klaar (voorkomt flukes)
const unsigned long SAMPLE_INTERVAL   = 500;    // ms tussen metingen
const unsigned long RECONNECT_INTERVAL = 30000; // ms tussen WiFi-reconnect pogingen

bool wasFinished = false;
unsigned long lightOnSince = 0;
unsigned long lastSample = 0;
unsigned long lastWifiAttempt = 0;

void setup() {
  Serial.begin(115200);
  pinMode(LDR_PIN, INPUT);

  connectWiFi();

  Serial.println("Setup completed");
}

void loop() {
  unsigned long now = millis();

  maintainWiFi(now);

  if (now - lastSample < SAMPLE_INTERVAL) return;
  lastSample = now;

  int raw = analogRead(LDR_PIN);
  bool lightOn = raw > THRESHOLD;

  Serial.printf("LDR raw: %d  (licht %s)\n", raw, lightOn ? "AAN" : "UIT");

  if (lightOn) {
    if (lightOnSince == 0) lightOnSince = now;

    if (!wasFinished && now - lightOnSince > CONFIRM_TIME) {
      wasFinished = true;
      Serial.println("Was is klaar!");
      reportFinished();
    }
  } else {
    lightOnSince = 0;
    if (wasFinished) {
      Serial.println("Lampje uit, klaar voor volgende cyclus");
    }
    wasFinished = false;
  }
}

void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.setHostname(HOSTNAME);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("Connecting to WiFi");
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

void reportFinished() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi not connected, kan melding niet versturen");
    return;
  }

  HTTPClient http;
  String url = String("http://") + SERVER_HOST + ":" + SERVER_PORT + SERVER_PATH;
  http.begin(url);
  http.addHeader("Content-Type", "application/json");

  String payload = String("{\"device\":\"") + HOSTNAME + "\"}";
  int httpCode = http.POST(payload);

  if (httpCode > 0) {
    Serial.printf("Melding verstuurd, HTTP %d\n", httpCode);
  } else {
    Serial.printf("Melding mislukt: %s\n", http.errorToString(httpCode).c_str());
  }

  http.end();
}

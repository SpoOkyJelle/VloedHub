#include <WiFi.h>
#include <HTTPClient.h>

// ---------- WiFi settings ----------
const char* WIFI_SSID     = "Ziggo4680326";
const char* WIFI_PASSWORD = "eyrfTfdp77gfdrxt";
const char* HOSTNAME      = "GoonESP32-Wasmachine";

// ---------- Server settings ----------
const char* SERVER_HOST = "192.168.178.10";
const int   SERVER_PORT = 5000;

// ---------- LDR's ----------
// LDR 1: "in gebruik" lampje van de wasmachine
// LDR 2: "klaar" lampje van de wasmachine
#define LDR_RUNNING_PIN 34
#define LDR_DONE_PIN    35

// Kalibratie: open de Serial Monitor (115200 baud) en kijk naar de "LDR raw"
// waarden met de lampjes uit vs aan. Zet de THRESHOLDs er tussenin.
// Let op omgevingslicht (dag/avond) — eventueel een kokertje om de LDR's helpt.
int THRESHOLD_RUNNING = 2000;
int THRESHOLD_DONE    = 2000;

const unsigned long CONFIRM_TIME       = 5000;   // ms aanhoudend licht = echte statuswissel (voorkomt flukes)
const unsigned long SAMPLE_INTERVAL    = 500;    // ms tussen metingen
const unsigned long RECONNECT_INTERVAL = 30000;  // ms tussen WiFi-reconnect pogingen

bool runningReported = false;
unsigned long runningOnSince = 0;

bool doneReported = false;
unsigned long doneOnSince = 0;

unsigned long lastSample = 0;
unsigned long lastWifiAttempt = 0;

void setup() {
  Serial.begin(115200);
  pinMode(LDR_RUNNING_PIN, INPUT);
  pinMode(LDR_DONE_PIN, INPUT);

  connectWiFi();

  Serial.println("Setup completed");
}

void loop() {
  unsigned long now = millis();

  maintainWiFi(now);

  if (now - lastSample < SAMPLE_INTERVAL) return;
  lastSample = now;

  int rawRunning = analogRead(LDR_RUNNING_PIN);
  int rawDone    = analogRead(LDR_DONE_PIN);
  bool runningOn = rawRunning > THRESHOLD_RUNNING;
  bool doneOn    = rawDone > THRESHOLD_DONE;

  Serial.printf("LDR in gebruik: %d (%s)  LDR klaar: %d (%s)\n",
    rawRunning, runningOn ? "AAN" : "UIT",
    rawDone, doneOn ? "AAN" : "UIT");

  // --- "In gebruik" lampje ---
  if (runningOn) {
    if (runningOnSince == 0) runningOnSince = now;

    if (!runningReported && now - runningOnSince > CONFIRM_TIME) {
      runningReported = true;
      Serial.println("Wasmachine in gebruik");
      reportEvent("/api/wasmachine/start");
    }
  } else {
    runningOnSince = 0;
    runningReported = false;
  }

  // --- "Klaar" lampje ---
  if (doneOn) {
    if (doneOnSince == 0) doneOnSince = now;

    if (!doneReported && now - doneOnSince > CONFIRM_TIME) {
      doneReported = true;
      Serial.println("Was is klaar!");
      reportEvent("/api/wasmachine");
    }
  } else {
    doneOnSince = 0;
    if (doneReported) {
      Serial.println("Klaar-lampje uit, wasmachine leeggehaald");
      reportEvent("/api/wasmachine/reset");
    }
    doneReported = false;
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

void reportEvent(const char* path) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi not connected, kan event niet versturen");
    return;
  }

  HTTPClient http;
  String url = String("http://") + SERVER_HOST + ":" + SERVER_PORT + path;
  http.begin(url);
  http.addHeader("Content-Type", "application/json");

  String payload = String("{\"device\":\"") + HOSTNAME + "\"}";
  int httpCode = http.POST(payload);

  if (httpCode > 0) {
    Serial.printf("Event %s verstuurd, HTTP %d\n", path, httpCode);
  } else {
    Serial.printf("Event %s mislukt: %s\n", path, http.errorToString(httpCode).c_str());
  }

  http.end();
}

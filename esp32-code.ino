#include <WiFi.h>
#include <HTTPClient.h>
#include <HardwareSerial.h>

// ---------- WiFi settings ----------
const char* WIFI_SSID     = "Ziggo4680326";
const char* WIFI_PASSWORD = "eyrfTfdp77gfdrxt";
const char* HOSTNAME      = "GoonESP32-P1meter";

// ---------- Server settings ----------
const char* SERVER_HOST = "192.168.178.10";
const int   SERVER_PORT = 5000;
const char* SERVER_PATH = "/api/p1data";

// ---------- P1 IN ----------
#define PIN_DATA_IN     1
#define PIN_REQ_IN      2
// Status LED
#define REQ_STATUS_LED  9

HardwareSerial mySerial(1);

unsigned long lastRequestTime = 0;
unsigned long requestStartTime = 0;
const unsigned long REQUEST_INTERVAL_MS = 1000;  // Request interval time (ms)
const unsigned long REQUEST_TIMEOUT_MS  = 5000;  // Request timeout time (ms)
const unsigned long UPLOAD_INTERVAL_MS  = 15000; // Minimum time between uploads (ms)

unsigned long lastUploadTime = 0;

bool requestActive = false;
bool checksumStarted = false;
int checksumBytesReceived = 0;

// Buffer for one telegram
String telegramBuffer = "";

// Parsed values
float voltageL1 = 0, voltageL2 = 0, voltageL3 = 0;
float currentL1 = 0, currentL2 = 0, currentL3 = 0;

// Per-phase instantaneous power (this is what 21.7.0/41.7.0/61.7.0 etc actually are)
float powerDeliveredL1 = 0, powerDeliveredL2 = 0, powerDeliveredL3 = 0;
float powerReturnedL1 = 0, powerReturnedL2 = 0, powerReturnedL3 = 0;

// True household totals (from 1-0:1.7.0 / 1-0:2.7.0)
float powerDeliveredTotalKW = 0, powerReturnedTotalKW = 0;

float gasM3 = 0;

void setup() {
  Serial.begin(115200);
  pinMode(PIN_REQ_IN, OUTPUT);
  pinMode(REQ_STATUS_LED, OUTPUT);
  digitalWrite(PIN_REQ_IN, LOW);
  digitalWrite(REQ_STATUS_LED, LOW);
  mySerial.begin(115200, SERIAL_8N1, PIN_DATA_IN, -1);

  connectWiFi();

  Serial.println("Setup completed");
}

void loop() {
  unsigned long currentMillis = millis();

  // Start new request
  if (!requestActive && (currentMillis - lastRequestTime >= REQUEST_INTERVAL_MS)) {
    digitalWrite(PIN_REQ_IN, HIGH);
    digitalWrite(REQ_STATUS_LED, HIGH);
    requestActive = true;
    requestStartTime = currentMillis;
    lastRequestTime = currentMillis;
    checksumStarted = false;
    checksumBytesReceived = 0;
    telegramBuffer = "";
  }

  // Read incoming P1 data
  while (mySerial.available()) {
    int byteRead = mySerial.read();
    if (byteRead != -1) {
      char c = (char)byteRead;

      if (requestActive) {
        telegramBuffer += c;

        if (!checksumStarted) {
          if (c == '!') {
            checksumStarted = true;
            checksumBytesReceived = 0;
          }
        } else {
          checksumBytesReceived++;
          if (checksumBytesReceived >= 4) {
            digitalWrite(PIN_REQ_IN, LOW);
            digitalWrite(REQ_STATUS_LED, LOW);
            requestActive = false;
            checksumStarted = false;

            parseTelegram(telegramBuffer);
            printSummary();

            if (currentMillis - lastUploadTime >= UPLOAD_INTERVAL_MS) {
              sendData();
              lastUploadTime = currentMillis;
            }
          }
        }
      }
    }
  }

  // Request timeout
  if (requestActive && (currentMillis - requestStartTime > REQUEST_TIMEOUT_MS)) {
    digitalWrite(PIN_REQ_IN, LOW);
    digitalWrite(REQ_STATUS_LED, LOW);
    requestActive = false;
    checksumStarted = false;
    Serial.println("[TIMEOUT]");
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

// Pull a numeric value out of a line like "1-0:32.7.0(229.0*V)"
float extractValue(const String& line) {
  int start = line.indexOf('(');
  int end = line.indexOf('*', start);
  if (end == -1) end = line.indexOf(')', start);
  if (start == -1 || end == -1) return 0;
  return line.substring(start + 1, end).toFloat();
}

void parseTelegram(const String& telegram) {
  int lineStart = 0;
  while (lineStart < telegram.length()) {
    int lineEnd = telegram.indexOf('\n', lineStart);
    if (lineEnd == -1) lineEnd = telegram.length();
    String line = telegram.substring(lineStart, lineEnd);
    line.trim();

    if (line.startsWith("1-0:32.7.0")) voltageL1 = extractValue(line);
    else if (line.startsWith("1-0:52.7.0")) voltageL2 = extractValue(line);
    else if (line.startsWith("1-0:72.7.0")) voltageL3 = extractValue(line);
    else if (line.startsWith("1-0:31.7.0")) currentL1 = extractValue(line);
    else if (line.startsWith("1-0:51.7.0")) currentL2 = extractValue(line);
    else if (line.startsWith("1-0:71.7.0")) currentL3 = extractValue(line);
    // True household totals
    else if (line.startsWith("1-0:1.7.0")) powerDeliveredTotalKW = extractValue(line);
    else if (line.startsWith("1-0:2.7.0")) powerReturnedTotalKW = extractValue(line);
    // Per-phase instantaneous power
    else if (line.startsWith("1-0:21.7.0")) powerDeliveredL1 = extractValue(line);
    else if (line.startsWith("1-0:22.7.0")) powerReturnedL1 = extractValue(line);
    else if (line.startsWith("1-0:41.7.0")) powerDeliveredL2 = extractValue(line);
    else if (line.startsWith("1-0:42.7.0")) powerReturnedL2 = extractValue(line);
    else if (line.startsWith("1-0:61.7.0")) powerDeliveredL3 = extractValue(line);
    else if (line.startsWith("1-0:62.7.0")) powerReturnedL3 = extractValue(line);
    else if (line.startsWith("0-1:24.2.1")) {
      int start = line.lastIndexOf('(');
      int end = line.indexOf('*', start);
      if (start != -1 && end != -1) {
        gasM3 = line.substring(start + 1, end).toFloat();
      }
    }

    lineStart = lineEnd + 1;
  }
}

void printSummary() {
  Serial.println("---- P1 reading ----");
  Serial.printf("Voltage:  L1 %.1fV  L2 %.1fV  L3 %.1fV\n", voltageL1, voltageL2, voltageL3);
  Serial.printf("Current:  L1 %.0fA  L2 %.0fA  L3 %.0fA\n", currentL1, currentL2, currentL3);
  Serial.printf("Power L1: %.3f kW delivered, %.3f kW returned\n", powerDeliveredL1, powerReturnedL1);
  Serial.printf("Power L2: %.3f kW delivered, %.3f kW returned\n", powerDeliveredL2, powerReturnedL2);
  Serial.printf("Power L3: %.3f kW delivered, %.3f kW returned\n", powerDeliveredL3, powerReturnedL3);
  Serial.printf("Total:    %.3f kW delivered, %.3f kW returned (net export)\n", powerDeliveredTotalKW, powerReturnedTotalKW);
  Serial.printf("Gas:      %.3f m3\n", gasM3);
  Serial.println("---------------------");
}

void sendData() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi not connected, skipping upload, retrying connection");
    connectWiFi();
    if (WiFi.status() != WL_CONNECTED) return;
  }

  HTTPClient http;
  String url = String("http://") + SERVER_HOST + ":" + SERVER_PORT + SERVER_PATH;
  http.begin(url);
  http.addHeader("Content-Type", "application/json");

  char payload[600];
  snprintf(payload, sizeof(payload),
    "{\"device\":\"%s\","
    "\"voltage_l1\":%.1f,\"voltage_l2\":%.1f,\"voltage_l3\":%.1f,"
    "\"current_l1\":%.0f,\"current_l2\":%.0f,\"current_l3\":%.0f,"
    "\"power_delivered_l1_kw\":%.3f,\"power_delivered_l2_kw\":%.3f,\"power_delivered_l3_kw\":%.3f,"
    "\"power_returned_l1_kw\":%.3f,\"power_returned_l2_kw\":%.3f,\"power_returned_l3_kw\":%.3f,"
    "\"power_delivered_total_kw\":%.3f,\"power_returned_total_kw\":%.3f,"
    "\"gas_m3\":%.3f}",
    HOSTNAME, voltageL1, voltageL2, voltageL3,
    currentL1, currentL2, currentL3,
    powerDeliveredL1, powerDeliveredL2, powerDeliveredL3,
    powerReturnedL1, powerReturnedL2, powerReturnedL3,
    powerDeliveredTotalKW, powerReturnedTotalKW, gasM3);

  int httpCode = http.POST(payload);

  if (httpCode > 0) {
    Serial.printf("Upload OK, HTTP %d\n", httpCode);
  } else {
    Serial.printf("Upload failed: %s\n", http.errorToString(httpCode).c_str());
  }

  http.end();
}
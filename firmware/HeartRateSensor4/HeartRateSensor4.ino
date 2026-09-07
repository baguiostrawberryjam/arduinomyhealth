/*
  ArduinoMyHealth - Catcher Device (ESP32 + ST7789)

  v4 changes over v3:
    - WiFi is set up through a captive portal instead of hardcoded credentials
    - Device key entered once in that portal, stored in NVS
    - Two-step keypad login (User ID, then PIN) against the website
    - Readings POSTed over HTTPS every 15s to ArduinoMyHealth, not ThingSpeak
    - Heartbeat every 10 minutes so the website shows the device online
    - Automatic logout after ~2 minutes idle
    - Four correctness fixes, marked FIX 1..4 below

  Display drawing, pins, keypad wiring and the SpO2 algorithm are unchanged.
*/

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <WiFiManager.h>
#include <Preferences.h>
#include <Keypad.h>
#include <SPI.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ST7789.h>
#include <ClosedCube_MAX30205.h>
#include "MAX30105.h"
#include "heartRate.h"
#include "spo2_algorithm.h"

// --- 1. SERVER SETTINGS ---
// The only thing to change if the site moves to a custom domain.
const char* SERVER_BASE = "https://arduinomyhealth.onrender.com";

// WiFi credentials and the device key are NOT here any more. WiFi is entered in
// the setup portal; the device key is entered there too and kept in NVS.
Preferences prefs;
String deviceKey = "";

// ---------------- KEYPAD SETTINGS ----------------
const byte ROWS = 4;
const byte COLS = 4;

char keys[ROWS][COLS] = {
  {'1','2','3','A'},
  {'4','5','6','B'},
  {'7','8','9','C'},
  {'*','0','#','D'}
};

byte rowPins[ROWS] = {26, 25, 33, 32};
byte colPins[COLS] = {13, 12, 14, 27};

Keypad keypad = Keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);

// Two-step login: User ID first, then PIN. LOGIN_CODE / LOGIN_PIN is the whole
// of the login state.
const int LOGIN_CODE = 0;
const int LOGIN_PIN  = 1;
int loginStep = LOGIN_CODE;

String enteredUserCode = "";
String enteredPIN = "";
bool isLoggedIn = false;

// The session token lives in RAM only, never in NVS. A power cut logs everyone
// out, which is what stops the next person's readings being written to the
// previous person's record.
String sessionToken = "";
String loggedInName = "";

// ---------------- TFT SETTINGS ----------------
#define TFT_CS    15
#define TFT_DC    2
#define TFT_RST   4

Adafruit_ST7789 tft = Adafruit_ST7789(TFT_CS, TFT_DC, TFT_RST);

// ---------------- TEMP SENSOR ----------------
ClosedCube_MAX30205 bodyTempSensor;

// ---------------- MAX30102 ----------------
MAX30105 particleSensor;

// ---------------- GLOBAL VARIABLES ----------------
float bodyTemp = 0.0;
long beatsPerMinute = 0;
int spO2 = 0;
long lastBeat = 0;
long lastIrValue = 0;          // for the finger-present check

// ---------------- SpO2 ALGORITHM BUFFERS ----------------
#define SPO2_BUFFER_SIZE 100
#define SPO2_REFRESH_SIZE 25

uint32_t irBuffer[SPO2_BUFFER_SIZE];
uint32_t redBuffer[SPO2_BUFFER_SIZE];
int spo2BufferIndex = 0;

int32_t spo2Result;
int8_t  spo2Valid;
int32_t hrResultFromAlgo;
int8_t  hrValidFromAlgo;

// ---------------- TIMERS ----------------
unsigned long lastUploadTime = 0;
const unsigned long uploadDelay = 15000;        // 15s between readings
unsigned long lastDisplayTime = 0;
const unsigned long displayDelay = 300;
unsigned long lastTempReadTime = 0;             // FIX 2
const unsigned long tempReadDelay = 1000;
unsigned long lastHeartbeatTime = 0;
const unsigned long heartbeatDelay = 600000;    // 10 minutes
unsigned long lastActivityTime = 0;
const unsigned long idleTimeout = 120000;       // ~2 minutes

String lastAlertMsg = "INIT";

// Plausibility limits, the same numbers the server and website use.
const float TEMP_MIN = 20.0, TEMP_MAX = 45.0;
const long  BPM_MIN = 20,    BPM_MAX = 255;
const int   SPO2_MIN = 50,   SPO2_MAX = 100;
const long  FINGER_IR_THRESHOLD = 50000;

// =====================================================
// SETUP
// =====================================================
void setup() {
  Serial.begin(115200);
  Serial.println("BOOT OK");

  // ---------------- TFT INIT ----------------
  tft.init(240, 320);

  tft.setRotation(1);
  tft.invertDisplay(false);

  // FIX 4: SPI.setFrequency() did nothing. Adafruit_SPITFT starts its own SPI
  // transaction before every draw using the library's own stored frequency, so
  // the global setting was overridden every time. This is the call that sticks.
  // If the display glitches on breadboard wiring, lower this to 10000000.
  tft.setSPISpeed(20000000);
  delay(100);

  tft.fillScreen(ST77XX_BLACK);
  tft.setTextColor(ST77XX_WHITE);
  tft.setTextSize(2);
  tft.setCursor(20, 20);
  tft.println("System Booting...");
  Serial.println("TFT init done");

  // ---------------- WIFI + DEVICE KEY ----------------
  connectWiFi();

  // ---------------- TEMP SENSOR ----------------
  Wire.begin();
  bodyTempSensor.begin(0x4F);

  // ---------------- MAX30102 ----------------
  if (!particleSensor.begin(Wire, I2C_SPEED_FAST)) {
    Serial.println("MAX30102 not found!");
    tft.setCursor(20, 60);
    tft.setTextColor(ST77XX_RED);
    tft.println("MAX30102 ERROR!");
    while (1);
  }

  particleSensor.setup(0x1F, 4, 2, 100, 411, 4096);
  particleSensor.setPulseAmplitudeRed(0x1F);
  particleSensor.setPulseAmplitudeIR(0x1F);
  particleSensor.setPulseAmplitudeGreen(0);

  // Can block for up to 20s if Render has gone to sleep, so say what is
  // happening rather than leaving the WiFi screen up.
  showMessage("CONNECTING...", ST77XX_BLUE, 0);
  sendHeartbeat();            // tell the website we are alive straight away
  drawLoginScreen();
}

// =====================================================
// WIFI SETUP PORTAL
// =====================================================
void connectWiFi() {
  prefs.begin("catcher", false);
  deviceKey = prefs.getString("devicekey", "");

  tft.fillScreen(ST77XX_BLACK);
  tft.setTextColor(ST77XX_WHITE);
  tft.setTextSize(2);
  tft.setCursor(10, 20);
  tft.println("WiFi setup:");
  tft.setCursor(10, 60);
  tft.println("Join WiFi network");
  tft.setTextColor(ST77XX_YELLOW);
  tft.setCursor(10, 90);
  tft.println("ArduinoMyHealth");
  tft.setTextColor(ST77XX_WHITE);
  tft.setCursor(10, 130);
  tft.setTextSize(1);
  tft.println("Then pick your WiFi and enter the device key.");
  tft.println("This screen closes once connected.");
  tft.println("");
  tft.println("Hold D at power-on to reopen this setup later.");

  // One extra text field on the page you already have to open for WiFi. No
  // keypad entry, no reflash, and it survives power loss.
  WiFiManagerParameter keyParam("devicekey", "Device Key", deviceKey.c_str(), 80);

  WiFiManager wm;
  wm.addParameter(&keyParam);
  wm.setConfigPortalTimeout(180);

  // Hold D at power-on to force the setup portal open. Needed because
  // autoConnect() returns straight away when WiFi is already remembered, which
  // leaves no way to change the network or the device key without a reflash.
  bool ok;
  if (portalRequested()) {
    Serial.println("D held at boot: opening setup portal");
    ok = wm.startConfigPortal("ArduinoMyHealth");
  } else {
    ok = wm.autoConnect("ArduinoMyHealth");
  }

  if (!ok) {
    wifiFailed();
  }

  saveDeviceKey(keyParam);

  // The ESP32 remembers WiFi credentials from whatever sketch ran before, so
  // autoConnect() can succeed on the very first boot of this firmware without
  // ever showing the portal — and the device key would never get entered.
  // Open the portal explicitly for that case.
  if (deviceKey.length() == 0) {
    Serial.println("No device key stored; opening portal to collect it");
    showMessage("SET DEVICE KEY", ST77XX_BLUE, 0);
    if (!wm.startConfigPortal("ArduinoMyHealth")) {
      wifiFailed();
    }
    saveDeviceKey(keyParam);
  }

  Serial.print("WiFi connected: ");
  Serial.println(WiFi.localIP());
  Serial.print("Device key length: ");
  Serial.println(deviceKey.length());     // never print the key itself

  if (deviceKey.length() == 0) {
    Serial.println("WARNING: no device key set. Every request will be rejected.");
  }
}

// Poll the keypad briefly at boot. getKey() reports one press per event, so a
// short poll is enough to notice a held key.
bool portalRequested() {
  unsigned long start = millis();
  while (millis() - start < 1500) {
    if (keypad.getKey() == 'D') return true;
  }
  return false;
}

void saveDeviceKey(WiFiManagerParameter &keyParam) {
  String enteredKey = String(keyParam.getValue());
  enteredKey.trim();
  if (enteredKey.length() > 0 && enteredKey != deviceKey) {
    deviceKey = enteredKey;
    prefs.putString("devicekey", deviceKey);
    Serial.println("Device key saved to NVS");
  }
}

void wifiFailed() {
  // Nothing works without WiFi, so restart and offer the portal again rather
  // than sitting on a dead screen.
  Serial.println("WiFi setup timed out, restarting");
  tft.fillScreen(ST77XX_RED);
  tft.setTextColor(ST77XX_WHITE);
  tft.setTextSize(2);
  tft.setCursor(20, 100);
  tft.println("WiFi failed");
  delay(3000);
  ESP.restart();
}

// =====================================================
// MAIN LOOP
// =====================================================
void loop() {
  sendHeartbeat();

  if (!isLoggedIn) {
    handleLogin();
    return;
  }

  char key = keypad.getKey();
  if (key == 'A') {
    logout("");
    return;
  }
  if (key) {
    lastActivityTime = millis();
  }

  readSensors();

  // A finger on the sensor counts as activity. Without this, someone measuring
  // quietly for three minutes would be logged out mid-session.
  if (lastIrValue >= FINGER_IR_THRESHOLD) {
    lastActivityTime = millis();
  }

  if (millis() - lastActivityTime > idleTimeout) {
    Serial.println("Idle timeout, logging out");
    logout("TIMED OUT");
    return;
  }

  if (millis() - lastDisplayTime > displayDelay) {
    updateDisplayValues();
    checkAlerts();
    lastDisplayTime = millis();
  }

  sendReading();
}

// =====================================================
// SENSOR READING
// =====================================================
void readSensors() {
  // FIX 2: was `if (millis() % 1000 < 10)`, a 10ms window the loop usually
  // missed, so the temperature updated only occasionally and unpredictably.
  if (millis() - lastTempReadTime >= tempReadDelay) {
    bodyTemp = bodyTempSensor.readTemperature();
    lastTempReadTime = millis();
  }

  // FIX 1: was getIR() and getRed(), two separate calls that can land on
  // different FIFO samples. The SpO2 maths compares the red and IR waveforms
  // point by point, so phase-shifted channels give a wrong answer that still
  // looks plausible. Reading both from the same FIFO sample fixes it.
  particleSensor.check();
  while (particleSensor.available()) {
    uint32_t red = particleSensor.getFIFORed();
    uint32_t ir  = particleSensor.getFIFOIR();
    particleSensor.nextSample();

    lastIrValue = ir;
    if (ir < FINGER_IR_THRESHOLD) {
      beatsPerMinute = 0;
    }
    updateSpO2(ir, red);
  }
}

// =====================================================
// SpO2 ALGORITHM
// =====================================================
void updateSpO2(uint32_t irValue, uint32_t redValue) {
  if (irValue < FINGER_IR_THRESHOLD) {
    spO2 = 0;
    spo2BufferIndex = 0;
    return;
  }

  irBuffer[spo2BufferIndex] = irValue;
  redBuffer[spo2BufferIndex] = redValue;
  spo2BufferIndex++;

  if (spo2BufferIndex < SPO2_BUFFER_SIZE) {
    return;
  }

  maxim_heart_rate_and_oxygen_saturation(
    irBuffer, SPO2_BUFFER_SIZE, redBuffer,
    &spo2Result, &spo2Valid,
    &hrResultFromAlgo, &hrValidFromAlgo
  );

  // UPDATE SpO2
  if (spo2Valid && spo2Result > 0 && spo2Result <= 100) {
    spO2 = spo2Result;
  }

  // UPDATE HEART RATE FROM ALGORITHM
  if (hrValidFromAlgo && hrResultFromAlgo > 20 && hrResultFromAlgo < 255) {
    beatsPerMinute = hrResultFromAlgo;
  }

  int keepFrom = SPO2_BUFFER_SIZE - SPO2_REFRESH_SIZE;
  for (int i = 0; i < SPO2_REFRESH_SIZE; i++) {
    irBuffer[i] = irBuffer[keepFrom + i];
    redBuffer[i] = redBuffer[keepFrom + i];
  }
  spo2BufferIndex = SPO2_REFRESH_SIZE;
}

// =====================================================
// LOGIN SCREEN
// =====================================================
void drawLoginScreen() {
  tft.fillScreen(ST77XX_YELLOW);
  tft.drawRect(10, 10, 300, 220, ST77XX_BLACK);
  tft.setCursor(30, 50);
  tft.setTextSize(3);
  tft.setTextColor(ST77XX_BLACK);
  tft.println("SECURITY LOGIN");
  tft.setCursor(30, 100);
  tft.setTextSize(2);

  if (loginStep == LOGIN_CODE) {
    tft.println("Enter User ID:");
  } else {
    tft.println("Enter PIN:");
  }

  tft.setCursor(30, 180);
  tft.setTextColor(ST77XX_BLUE);
  tft.println("Press # to Enter");
  tft.setCursor(30, 140);
  tft.setTextColor(ST77XX_BLACK);
}

// =====================================================
// MAIN DASHBOARD
// =====================================================
void drawMainDashboard() {
  tft.fillScreen(ST77XX_BLACK);
  tft.fillRect(0, 0, 320, 30, ST77XX_BLUE);
  tft.setTextColor(ST77XX_WHITE);
  tft.setTextSize(2);
  tft.setCursor(50, 8);
  tft.println("PATIENT DASHBOARD");
  tft.setTextSize(2);
  tft.setTextColor(ST77XX_WHITE);

  tft.setCursor(10, 50);
  tft.print("Body Temp:");
  tft.setCursor(260, 50);
  tft.print("C");

  tft.setCursor(10, 100);
  tft.print("Heart Rate:");
  tft.setCursor(240, 100);
  tft.print("BPM");

  tft.setCursor(10, 150);
  tft.print("Blood O2:");
  tft.setCursor(260, 150);
  tft.print("%");
}

// =====================================================
// UPDATE VALUES
// =====================================================
void updateDisplayValues() {
  tft.setTextSize(3);

  tft.setTextColor(ST77XX_GREEN, ST77XX_BLACK);
  tft.setCursor(150, 45);
  tft.print(bodyTemp, 1);
  tft.print(" ");

  tft.setTextColor(ST77XX_CYAN, ST77XX_BLACK);
  tft.setCursor(160, 95);
  tft.print(beatsPerMinute);
  tft.print("   ");

  tft.setTextColor(ST77XX_MAGENTA, ST77XX_BLACK);
  tft.setCursor(180, 145);
  tft.print(spO2);
  tft.print("  ");
}

// =====================================================
// ALERTS
// =====================================================
void checkAlerts() {
  String alertMsg = "";

  if (bodyTemp > 37.5) {
    alertMsg = "HIGH TEMP!";
  } else if ((beatsPerMinute < 60 && beatsPerMinute > 0) || beatsPerMinute > 100) {
    alertMsg = "ABNORMAL HR!";
  } else if (spO2 < 95 && spO2 > 0) {
    alertMsg = "LOW SpO2!";
  }

  if (alertMsg != lastAlertMsg) {
    if (alertMsg == "") {
      tft.fillRect(0, 190, 320, 50, ST77XX_BLACK);
    } else {
      tft.fillRect(0, 190, 320, 50, ST77XX_RED);
      tft.setTextColor(ST77XX_WHITE);
      tft.setTextSize(3);
      tft.setCursor(40, 205);
      tft.println(alertMsg);
    }
    lastAlertMsg = alertMsg;
  }
}

// =====================================================
// LOGIN HANDLER  (two-step: User ID, then PIN)
// =====================================================
void handleLogin() {
  char key = keypad.getKey();
  if (!key) return;

  if (key == '*') {
    // Start over, whichever step we were on.
    loginStep = LOGIN_CODE;
    enteredUserCode = "";
    enteredPIN = "";
    drawLoginScreen();
    return;
  }

  if (key == '#') {
    if (loginStep == LOGIN_CODE) {
      if (enteredUserCode.length() != 6) {
        showMessage("NEED 6 DIGITS", ST77XX_RED, 1500);
        enteredUserCode = "";
        drawLoginScreen();
        return;
      }
      loginStep = LOGIN_PIN;
      enteredPIN = "";
      drawLoginScreen();
      return;
    }

    // PIN entered: ask the website whether this is a real account.
    if (enteredPIN.length() != 4) {
      showMessage("NEED 4 DIGITS", ST77XX_RED, 1500);
      enteredPIN = "";
      drawLoginScreen();
      return;
    }

    showMessage("CHECKING...", ST77XX_BLUE, 0);   // no pause; the POST is the wait
    if (doLogin(enteredUserCode, enteredPIN)) {
      isLoggedIn = true;
      lastActivityTime = millis();
      lastUploadTime = millis();
      resetSensorWindow();
      loginStep = LOGIN_CODE;
      enteredUserCode = "";
      enteredPIN = "";
      lastAlertMsg = "INIT";
      drawMainDashboard();
    } else {
      loginStep = LOGIN_CODE;
      enteredUserCode = "";
      enteredPIN = "";
      drawLoginScreen();
    }
    return;
  }

  // A digit. Echo a star so nobody reads a PIN over your shoulder.
  if (key >= '0' && key <= '9') {
    if (loginStep == LOGIN_CODE) {
      if (enteredUserCode.length() < 6) enteredUserCode += key;
    } else {
      if (enteredPIN.length() < 4) enteredPIN += key;
    }
    tft.setTextColor(ST77XX_BLACK, ST77XX_YELLOW);
    tft.setTextSize(3);
    tft.print("*");
  }
}

void logout(String reason) {
  isLoggedIn = false;
  sessionToken = "";
  loggedInName = "";
  loginStep = LOGIN_CODE;
  enteredUserCode = "";
  enteredPIN = "";
  if (reason.length() > 0) {
    showMessage(reason, ST77XX_BLUE, 1500);
  }
  drawLoginScreen();
}

void showMessage(String msg, uint16_t colour, int holdMs) {
  tft.fillScreen(colour);
  tft.setTextColor(ST77XX_WHITE);
  tft.setTextSize(3);
  tft.setCursor(30, 100);
  tft.println(msg);
  if (holdMs > 0) delay(holdMs);
}

// =====================================================
// NETWORK
// =====================================================

// Pull one string field out of a JSON response. The only fields we read are a
// JWT and a name, neither of which contains a quote or a backslash, so this is
// enough and saves pulling in a JSON library.
String jsonString(String json, String key) {
  String needle = "\"" + key + "\":\"";
  int start = json.indexOf(needle);
  if (start < 0) return "";
  start += needle.length();
  int end = json.indexOf('"', start);
  if (end < 0) return "";
  return json.substring(start, end);
}

// One POST. Returns the HTTP status, or -1 if the request could not be made.
// `response` is filled with the body.
int postJson(String path, String body, String bearer, String &response) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("  no WiFi");
    return -1;
  }

  WiFiClientSecure client;
  // Not validating the server certificate. A pinned root CA would be stronger,
  // but it expires and would strand the device mid-defense; this is a tradeoff
  // taken deliberately, not an oversight.
  client.setInsecure();

  HTTPClient http;
  http.setTimeout(20000);          // Render can take ~20s to wake from sleep
  if (!http.begin(client, String(SERVER_BASE) + path)) {
    Serial.println("  http.begin failed");
    return -1;
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Key", deviceKey);
  if (bearer.length() > 0) {
    http.addHeader("Authorization", "Bearer " + bearer);
  }

  int code = http.POST(body);

  // Logged before reading the body, so a stall while reading is still visible
  // on serial instead of looking like a dead device.
  Serial.print("  POST ");
  Serial.print(path);
  Serial.print(" -> ");
  Serial.println(code);

  // A 204 has no body, and Express sends no Content-Length with it. getString()
  // then has no length to read to and waits for the connection to close, which
  // keep-alive means never happens — so it blocked for the full 20s timeout on
  // every heartbeat. Nothing to read, so do not read.
  response = (code > 0 && code != 204) ? http.getString() : "";
  http.end();

  return code;
}

// Exchange User ID + PIN for a session token.
bool doLogin(String userCode, String pin) {
  String body = "{\"userCode\":\"" + userCode + "\",\"pin\":\"" + pin + "\"}";
  String response;
  int code = postJson("/api/session/login", body, "", response);

  if (code == 200) {
    sessionToken = jsonString(response, "sessionToken");
    loggedInName = jsonString(response, "name");
    if (sessionToken.length() == 0) {
      showMessage("SERVER ERROR", ST77XX_RED, 1500);
      return false;
    }
    Serial.print("  logged in as ");
    Serial.println(loggedInName);
    return true;
  }

  if (code == 401 && response.indexOf("invalid_device_key") >= 0) {
    showMessage("DEVICE KEY BAD", ST77XX_RED, 2500);
  }
  else if (code == 401) showMessage("WRONG ID/PIN", ST77XX_RED, 1500);
  else if (code == 429) showMessage("TOO MANY TRIES", ST77XX_RED, 1500);
  else if (code < 0)    showMessage("NO SERVER", ST77XX_RED, 1500);
  else                  showMessage("LOGIN FAILED", ST77XX_RED, 1500);
  return false;
}

// Is the current reading worth sending? Nothing is recorded when nobody is
// using the device, which is what keeps the history clean instead of filling it
// with blanks between sessions.
bool readingIsValid() {
  if (lastIrValue < FINGER_IR_THRESHOLD) return false;
  // Checked first: NaN fails every comparison below, so a failed temperature
  // read would otherwise pass the range test and be sent as "nan".
  if (isnan(bodyTemp)) return false;
  if (beatsPerMinute < BPM_MIN || beatsPerMinute > BPM_MAX) return false;
  if (spO2 < SPO2_MIN || spO2 > SPO2_MAX) return false;
  if (bodyTemp < TEMP_MIN || bodyTemp > TEMP_MAX) return false;
  return true;
}

// FIX 3: the upload blocks for a second or more, during which the sensor FIFO
// overflows. Without clearing it, the next 100-sample window straddles that gap
// and the algorithm reads the discontinuity as noise. Gets worse with HTTPS,
// which is why it has to land in the same version as the HTTPS switch.
void resetSensorWindow() {
  particleSensor.clearFIFO();
  spo2BufferIndex = 0;
}

void sendReading() {
  if (millis() - lastUploadTime < uploadDelay) return;
  lastUploadTime = millis();

  if (!readingIsValid()) {
    Serial.println("  reading not valid, skipping upload");
    return;
  }

  String body = "{\"bpm\":" + String(beatsPerMinute) +
                ",\"spo2\":" + String(spO2) +
                ",\"tempC\":" + String(bodyTemp, 1) + "}";
  String response;
  int code = postJson("/api/readings", body, sessionToken, response);

  // The 15-minute session token ran out while this person was still measuring.
  // We do not keep the PIN, so they log in again — which is also the correct
  // answer for a shared device.
  if (code == 401) {
    logout("SESSION ENDED");
    return;
  }

  // A reading counts as proof of life on the server, so the heartbeat timer
  // only matters while nobody is measuring.
  if (code == 201) {
    lastHeartbeatTime = millis();
  }

  resetSensorWindow();
}

void sendHeartbeat() {
  if (lastHeartbeatTime != 0 && millis() - lastHeartbeatTime < heartbeatDelay) return;
  lastHeartbeatTime = millis();

  String response;
  postJson("/api/device/heartbeat", "", "", response);
}

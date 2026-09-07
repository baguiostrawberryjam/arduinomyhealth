# Catcher Device firmware

`HeartRateSensor4/HeartRateSensor4.ino` — the sketch running on the ESP32.

Open the **folder** `HeartRateSensor4` in the Arduino IDE (the folder name has to
match the `.ino` name). Earlier versions v1–v3 are not here; they live outside
the repo as history and are superseded by this one.

## Libraries

Install via Library Manager:

| Library | Notes |
| :--- | :--- |
| WiFiManager | tzapu — the captive setup portal |
| Keypad | 4x4 matrix |
| Adafruit GFX | |
| Adafruit ST7735/ST7789 | |
| SparkFun MAX3010x | pulse oximeter, provides `spo2_algorithm.h` |
| ClosedCube MAX30205 | body temperature |

`WiFi`, `WiFiClientSecure`, `HTTPClient`, `Preferences` and `SPI` all ship with
the ESP32 core. Board: ESP32 Dev Module. Serial monitor at **115200**.

## First-time setup

1. Flash and open Serial.
2. The device raises a WiFi network called **ArduinoMyHealth**. Join it from a
   phone or laptop and open `http://192.168.4.1` if the page does not appear on
   its own.
3. **Configure WiFi** → pick the network, enter its password, and paste the
   server's `DEVICE_KEY` into the **Device Key** field on the same page. Save.
4. Serial should show `Device key saved to NVS`, an IP, `Device key length: 48`,
   and `POST /api/device/heartbeat -> 204`.

WiFi credentials and the device key both persist in NVS, so this is a one-time
step. It survives power loss and reflashing.

**Hold `D` at power-on** to reopen the setup portal later — needed for changing
WiFi network when the old one is still in range, and for rotating `DEVICE_KEY`.

Note that the ESP32 remembers WiFi credentials from whatever sketch ran before.
On the first boot of this firmware the portal may therefore never appear, which
would leave the device key unset; the firmware detects an empty key and opens
the portal anyway.

## Taking a reading

User ID (6 digits) → `#` → PIN (4 digits) → `#`. Readings upload every 15s while
a finger is on the sensor. `A` logs out, and so does ~2 minutes idle.

Nothing is recorded when nobody is logged in, which is what keeps each person's
history free of blank stretches between sessions.

## The four correctness fixes

Marked `FIX 1`..`FIX 4` in the source:

1. **Paired IR/Red FIFO sampling** — `getIR()` and `getRed()` were separate calls
   that could land on different FIFO samples. SpO2 compares the two waveforms
   point by point, so phase-shifted channels gave a wrong answer that still
   looked plausible.
2. **Timer-based temperature reads** — `millis() % 1000 < 10` was a 10ms window
   the loop usually missed.
3. **Sensor buffer reset after upload** — the upload blocks long enough for the
   FIFO to overflow; without clearing it the next window straddles the gap and
   the algorithm reads the discontinuity as noise.
4. **`tft.setSPISpeed()`** — `SPI.setFrequency()` did nothing, because
   Adafruit_SPITFT opens its own SPI transaction before every draw.

## Known limitations

- **The server certificate is not validated** (`client.setInsecure()`). A pinned
  root CA is stronger but expires, and would strand the device.
- **Login needs the network.** No server, no logins — inherent to per-session
  authentication on a shared terminal. Worth naming in the paper.
- **Readings during a WiFi outage are lost.** There is no offline buffer.
- **Session expiry returns to the login screen.** The PIN is not kept, so the
  person logs in again. Sessions last 15 minutes; a measurement takes 3–8.

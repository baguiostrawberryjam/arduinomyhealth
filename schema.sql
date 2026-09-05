-- ArduinoMyHealth schema. Executed on every boot; every statement is
-- IF NOT EXISTS, so booting against an existing database is a no-op.
--
-- Three tables, per the shared-kiosk model: one Catcher Device used by many
-- people, each authenticating per session at the keypad.

-- A person with a website account.
--   user_code       6 digits, typed at the Catcher keypad. A login identifier,
--                   not a secret — you cannot type an email on a 4x4 keypad.
--   device_pin_hash the 4-digit PIN, bcrypt-hashed. This is the secret.
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL,
  email           TEXT    NOT NULL UNIQUE,
  password_hash   TEXT    NOT NULL,
  user_code       TEXT    NOT NULL UNIQUE,
  device_pin_hash TEXT    NOT NULL,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- One validated measurement. recorded_at is assigned by the server: the ESP32
-- has no RTC and resets its clock every boot, so its own timestamps cannot be
-- trusted. Stored as ISO-8601 UTC; the browser converts to Manila for display.
CREATE TABLE IF NOT EXISTS readings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bpm         INTEGER NOT NULL,
  spo2        INTEGER NOT NULL,
  temp_c      REAL    NOT NULL,
  recorded_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Every dashboard load queries one user's readings over a time window. Without
-- this index that is a full table scan.
CREATE INDEX IF NOT EXISTS idx_readings_user_time ON readings (user_id, recorded_at);

-- There is exactly one Catcher Device, so its liveness is a single row rather
-- than a table of devices. The CHECK enforces that.
CREATE TABLE IF NOT EXISTS device_state (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  last_seen_at TEXT
);

INSERT OR IGNORE INTO device_state (id, last_seen_at) VALUES (1, NULL);

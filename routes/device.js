// Catcher Device endpoints — API Contract v1.
//
//   POST /api/session/login     X-Device-Key            -> 200 { sessionToken, name }
//   POST /api/readings          X-Device-Key + Bearer   -> 201 { ok: true }
//   POST /api/device/heartbeat  X-Device-Key            -> 204
//
// Two identities, deliberately separate:
//
//   Device key    proves the request came from the real terminal. Permanent,
//                 provisioned once through the WiFi setup portal, lives in NVS.
//   Session token proves who is currently measuring. 15 minutes, RAM only, so a
//                 power cut logs everyone out — correct for a shared device.
//
// The device key alone can never write a reading. Without the second identity
// the server has no answer to "whose reading is this?", which is the whole
// problem with treating a shared terminal as if it belonged to one person.

import crypto from 'node:crypto';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { db } from '../db.js';
import { readDeviceToken, signDeviceToken } from '../session.js';

export const deviceRoutes = Router();

const BCRYPT_ROUNDS = 10;

// Same reasoning as the login route: compare against a real hash when the user
// code is unknown, so response time cannot be used to discover which codes are
// live. A malformed placeholder is rejected without doing the work.
const DUMMY_HASH = bcrypt.hashSync('no user matched this code', BCRYPT_ROUNDS);

const deviceKey = process.env.DEVICE_KEY?.trim();
export const deviceKeyConfigured = Boolean(deviceKey);

/** Plausibility bounds. One bad reading otherwise rescales an entire chart. */
const LIMITS = {
  bpm: [20, 255],
  spo2: [50, 100],
  tempC: [20, 45],
};

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  // Length is not secret, and timingSafeEqual throws on a mismatch.
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/** Every route here is device-only. No device key, no entry. */
function requireDeviceKey(req, res, next) {
  if (!deviceKeyConfigured) {
    // Misconfiguration, not a client error — say so rather than pretending the
    // credentials were wrong and sending someone hunting the firmware.
    return res.status(503).json({ error: 'device_key_not_configured' });
  }
  if (!timingSafeEqual(req.get('x-device-key') ?? '', deviceKey)) {
    return res.status(401).json({ error: 'invalid_device_key' });
  }
  next();
}

// Rate limited per userCode, NOT per IP. Every request comes from the one
// Catcher, so an IP limit would throttle the whole clinic the moment one person
// fumbled a PIN. Per code, a 4-digit PIN's 10,000 combinations stop being
// brute-forceable by someone standing at the keypad.
const pinLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.body?.userCode ?? 'unknown'),
  message: { error: 'too_many_attempts' },
});

deviceRoutes.post('/session/login', requireDeviceKey, pinLimiter, async (req, res, next) => {
  const userCode = typeof req.body?.userCode === 'string' ? req.body.userCode.trim() : '';
  const pin = typeof req.body?.pin === 'string' ? req.body.pin.trim() : '';

  if (!/^\d{6}$/.test(userCode) || !/^\d{4}$/.test(pin)) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  try {
    const found = await db.execute({
      sql: 'SELECT id, name, device_pin_hash FROM users WHERE user_code = ?',
      args: [userCode],
    });
    const user = found.rows[0];
    const ok = await bcrypt.compare(pin, user?.device_pin_hash ?? DUMMY_HASH);

    if (!user || !ok) return res.status(401).json({ error: 'invalid_credentials' });

    res.json({ sessionToken: signDeviceToken(Number(user.id)), name: user.name });
  } catch (err) {
    next(err);
  }
});

deviceRoutes.post('/readings', requireDeviceKey, async (req, res, next) => {
  const userId = readDeviceToken(req);
  if (!userId) return res.status(401).json({ error: 'invalid_session' });

  const bpm = Number(req.body?.bpm);
  const spo2 = Number(req.body?.spo2);
  const tempC = Number(req.body?.tempC);

  const plausible =
    Number.isFinite(bpm) &&
    Number.isFinite(spo2) &&
    Number.isFinite(tempC) &&
    bpm >= LIMITS.bpm[0] &&
    bpm <= LIMITS.bpm[1] &&
    spo2 >= LIMITS.spo2[0] &&
    spo2 <= LIMITS.spo2[1] &&
    tempC >= LIMITS.tempC[0] &&
    tempC <= LIMITS.tempC[1];

  if (!plausible) return res.status(422).json({ error: 'implausible_reading' });

  try {
    // recorded_at is assigned here, never sent by the device: the ESP32 has no
    // RTC and resets its clock on every boot.
    const recordedAt = new Date().toISOString();
    await db.batch(
      [
        {
          sql: `INSERT INTO readings (user_id, bpm, spo2, temp_c, recorded_at)
                VALUES (?, ?, ?, ?, ?)`,
          args: [userId, Math.round(bpm), Math.round(spo2), tempC, recordedAt],
        },
        // A reading is proof of life, so ingest doubles as a heartbeat. The
        // 10-minute timer only matters while nobody is measuring.
        {
          sql: 'UPDATE device_state SET last_seen_at = ? WHERE id = 1',
          args: [recordedAt],
        },
      ],
      'write'
    );

    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

deviceRoutes.post('/device/heartbeat', requireDeviceKey, async (req, res, next) => {
  try {
    await db.execute({
      sql: 'UPDATE device_state SET last_seen_at = ? WHERE id = 1',
      args: [new Date().toISOString()],
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

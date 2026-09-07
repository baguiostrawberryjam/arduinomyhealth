// Website authentication — API Contract v1.
//
//   POST /api/auth/register  -> 201 { id, userCode }   409 email_taken
//   POST /api/auth/login     -> 200 { id, name }       401 invalid_credentials
//   POST /api/auth/logout    -> 204
//   GET  /api/me             -> 200 { … }              401 unauthenticated
//
// The contract does not define a malformed-input response, so this adds
// 400 { error: 'invalid_input' }. It is an addition, not a change: none of the
// documented shapes moved.

import crypto from 'node:crypto';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { db } from '../db.js';
import { endSession, readSession, requireAuth, startSession } from '../session.js';
import { isAdminEmail } from './admin.js';

export const authRoutes = Router();

// Cost 10, not the more fashionable 12. Render's free instance is CPU-limited
// and login is a blocking call a person waits on; 10 is still far past the
// point where an offline attack on a stolen hash is impractical here.
const BCRYPT_ROUNDS = 10;

/** device_state.last_seen_at within this window means the Catcher is online. */
const DEVICE_ONLINE_WINDOW_MS = 15 * 60_000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A real bcrypt hash, computed once at boot, compared against when the email is
// unknown. It has to be a genuine hash: bcrypt rejects a malformed one straight
// away without doing the work, which leaves the timing difference it was meant
// to hide. Measured, a bogus string answered in 56ms against 120ms for a real
// comparison — enough to enumerate which addresses have accounts.
const DUMMY_HASH = bcrypt.hashSync('no user matched this login', BCRYPT_ROUNDS);

// A 4-digit PIN is 10,000 combinations and a password can be guessed too.
// Per-IP here; the keypad endpoint needs per-userCode instead, because every
// request from the Catcher shares one IP.
const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_attempts' },
});

function validateRegistration(body) {
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const pin = typeof body?.pin === 'string' ? body.pin : '';

  if (!name || name.length > 80) return null;
  if (!EMAIL_RE.test(email) || email.length > 160) return null;
  if (password.length < 8 || password.length > 200) return null;
  if (!/^\d{4}$/.test(pin)) return null;

  return { name, email, password, pin };
}

/** Random 6-digit code. crypto, not Math.random — it is a login identifier. */
function newUserCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function isUniqueViolation(err, column) {
  const message = String(err?.message ?? '').toLowerCase();
  return message.includes('unique') && message.includes(column);
}

authRoutes.post('/auth/register', authLimiter, async (req, res, next) => {
  const input = validateRegistration(req.body);
  if (!input) return res.status(400).json({ error: 'invalid_input' });

  try {
    const [passwordHash, pinHash] = await Promise.all([
      bcrypt.hash(input.password, BCRYPT_ROUNDS),
      bcrypt.hash(input.pin, BCRYPT_ROUNDS),
    ]);

    // Retry only the user_code collision. At 900k codes and a handful of users
    // this effectively never fires, but "effectively never" is not never, and
    // the alternative is a registration that fails for no visible reason.
    for (let attempt = 0; attempt < 5; attempt++) {
      const userCode = newUserCode();
      try {
        const result = await db.execute({
          sql: `INSERT INTO users (name, email, password_hash, user_code, device_pin_hash)
                VALUES (?, ?, ?, ?, ?)`,
          args: [input.name, input.email, passwordHash, userCode, pinHash],
        });
        return res.status(201).json({ id: Number(result.lastInsertRowid), userCode });
      } catch (err) {
        // Checked before the insert would be a race; the unique index is the
        // real arbiter, so let it decide and translate the error.
        if (isUniqueViolation(err, 'email')) {
          return res.status(409).json({ error: 'email_taken' });
        }
        if (!isUniqueViolation(err, 'user_code')) throw err;
      }
    }
    throw new Error('could not allocate a unique user_code after 5 attempts');
  } catch (err) {
    next(err);
  }
});

authRoutes.post('/auth/login', authLimiter, async (req, res, next) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!email || !password) return res.status(400).json({ error: 'invalid_input' });

  try {
    const found = await db.execute({
      sql: 'SELECT id, name, password_hash FROM users WHERE email = ?',
      args: [email],
    });
    const user = found.rows[0];

    // Always run a full comparison, so response time does not reveal which
    // addresses have accounts.
    const ok = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);

    if (!user || !ok) return res.status(401).json({ error: 'invalid_credentials' });

    startSession(res, Number(user.id));
    res.json({ id: Number(user.id), name: user.name });
  } catch (err) {
    next(err);
  }
});

authRoutes.post('/auth/logout', (req, res) => {
  endSession(res);
  res.status(204).end();
});

authRoutes.get('/me', requireAuth, async (req, res, next) => {
  try {
    const [found, device] = await Promise.all([
      db.execute({
        sql: 'SELECT id, name, email, user_code FROM users WHERE id = ?',
        args: [req.userId],
      }),
      db.execute('SELECT last_seen_at FROM device_state WHERE id = 1'),
    ]);

    const user = found.rows[0];
    // The account was deleted while a valid cookie was still out there.
    if (!user) {
      endSession(res);
      return res.status(401).json({ error: 'unauthenticated' });
    }

    const lastSeenAt = device.rows[0]?.last_seen_at ?? null;
    // Computed here, never in the browser: a viewer's phone with a wrong clock
    // must not be able to make a live Catcher look dead.
    const deviceOnline =
      Boolean(lastSeenAt) && Date.now() - new Date(lastSeenAt).getTime() < DEVICE_ONLINE_WINDOW_MS;

    res.json({
      id: Number(user.id),
      name: user.name,
      email: user.email,
      userCode: user.user_code,
      // Decides whether the browser shows the admin link at all. The endpoints
      // check for themselves; this is only so the UI does not offer a door that
      // would answer 403.
      isAdmin: isAdminEmail(user.email),
      deviceOnline,
      deviceLastSeenAt: lastSeenAt,
    });
  } catch (err) {
    next(err);
  }
});

export { readSession };

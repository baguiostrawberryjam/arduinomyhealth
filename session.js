// Browser sessions: a JWT in an httpOnly cookie.
//
// Stateless on purpose. Render restarts the process on every deploy and
// whenever the free instance wakes from sleep; a server-side session store
// would lose every login each time, or would need somewhere to live. A signed
// cookie survives all of it with nothing to run.
//
// The device does NOT use this. It authenticates with X-Device-Key plus a
// short-lived session token — see routes/device.js.

import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

export const IS_PRODUCTION =
  process.env.NODE_ENV === 'production' || Boolean(process.env.RENDER);

const COOKIE_NAME = 'session';
const MAX_AGE_DAYS = 7;

// Both the browser cookie and the Catcher's session token are JWTs signed with
// the same secret, so each one states what it is and every reader checks.
// Without this, a 15-minute keypad token pasted into a cookie would be accepted
// as a 7-day browser login, and vice versa.
const KIND_WEB = 'web';
const KIND_DEVICE = 'device';

/** Contract: keypad sessions expire after 15 minutes. */
const DEVICE_TOKEN_TTL = '15m';

const configuredSecret = process.env.JWT_SECRET?.trim();
export const jwtSecretConfigured = Boolean(configuredSecret);

// Without a configured secret, fall back to an ephemeral one rather than
// refusing to boot. Same reasoning as the database: a service that is up and
// can tell you what is misconfigured beats a dead process that cannot. Every
// restart invalidates sessions, which is exactly the symptom /api/health
// reports as jwtSecret: "missing".
const secret = configuredSecret || crypto.randomBytes(32).toString('hex');

if (!configuredSecret && IS_PRODUCTION) {
  console.warn(
    '\n  WARNING: JWT_SECRET is not set. Using a random secret generated at\n' +
      '  boot, so every restart will log all users out. Set JWT_SECRET.\n'
  );
}

function cookieOptions() {
  return {
    httpOnly: true, // not readable from JavaScript, so XSS cannot steal it
    sameSite: 'lax', // survives normal navigation, blocks cross-site POSTs
    secure: IS_PRODUCTION, // Render terminates TLS; locally we are on http
    path: '/',
    maxAge: MAX_AGE_DAYS * 24 * 60 * 60 * 1000,
  };
}

export function startSession(res, userId) {
  const token = jwt.sign({ uid: userId, kind: KIND_WEB }, secret, {
    expiresIn: `${MAX_AGE_DAYS}d`,
  });
  res.cookie(COOKIE_NAME, token, cookieOptions());
}

export function endSession(res) {
  // Same attributes as when it was set, or the browser keeps the old cookie.
  res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
}

/** The signed-in user's id, or null. Never throws on a malformed cookie. */
export function readSession(req) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;
  try {
    const claims = jwt.verify(token, secret);
    if (claims.kind !== KIND_WEB) return null; // a device token is not a login
    return claims.uid ?? null;
  } catch {
    return null; // expired, tampered with, or signed by a previous secret
  }
}

/** Gate for routes that require a logged-in browser. */
export function requireAuth(req, res, next) {
  const userId = readSession(req);
  if (!userId) return res.status(401).json({ error: 'unauthenticated' });
  req.userId = userId;
  next();
}

// --------------------------------------------------------------- device ----

/**
 * Mint the token the Catcher holds in RAM while one person is measuring.
 *
 * Short-lived by design. It lives only in RAM on the device, so a power cut logs
 * everyone out — the correct behaviour for a shared medical terminal, and the
 * reason readings cannot be misattributed to whoever used it last.
 */
export function signDeviceToken(userId) {
  return jwt.sign({ uid: userId, kind: KIND_DEVICE }, secret, {
    expiresIn: DEVICE_TOKEN_TTL,
  });
}

/** The user id behind an Authorization: Bearer token, or null. */
export function readDeviceToken(req) {
  const header = req.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  try {
    const claims = jwt.verify(match[1], secret);
    if (claims.kind !== KIND_DEVICE) return null; // a browser cookie is not a device session
    return claims.uid ?? null;
  } catch {
    return null; // expired (15 min), tampered with, or from a previous secret
  }
}

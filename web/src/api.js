// API wrappers — API Contract v1.
//
// Every path is relative, never a hardcoded host, so the same build works on
// localhost, on Render, and on the client's own domain with no code change.
//
// MOCK serves the fixtures in mock.js instead of calling the network. Set it to
// false when the backend is live; that is the only line that changes.
import { MOCK_ME, mockRows } from './mock.js';

export const MOCK = false;

export class ApiError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

/** Messages the user should actually see, keyed by the contract's error codes. */
const MESSAGES = {
  email_taken: 'That email address already has an account.',
  invalid_credentials: 'Email or password is incorrect.',
  unauthenticated: 'Your session has expired. Please log in again.',
  too_many_attempts: 'Too many attempts. Please wait a moment and try again.',
  invalid_input: 'Please check the details you entered and try again.',
  server_error: 'Something went wrong on our end. Please try again in a moment.',
  network: 'Could not reach the server. Check your connection and try again.',
};

export function errorMessage(err) {
  if (err instanceof ApiError) return MESSAGES[err.code] ?? 'Something went wrong. Please try again.';
  return MESSAGES.network;
}

async function request(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'include', // the JWT rides in an httpOnly cookie
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('network', 0);
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? 'unknown', res.status);
  return data;
}

// ---------------------------------------------------------------------------
// Mock backend
// ---------------------------------------------------------------------------

const STORE_KEY = 'mock:users';
const SESSION_KEY = 'mock:session';
const SEED_PASSWORD = 'password123';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* private mode, or corrupt value — fall through to the seed */
  }
  const seeded = [{ ...MOCK_ME, password: SEED_PASSWORD, pin: '4821' }];
  writeStore(seeded);
  return seeded;
}

function writeStore(users) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(users));
  } catch {
    /* nothing to do; the session just will not survive a reload */
  }
}

function readSessionId() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}

function writeSessionId(id) {
  try {
    if (id === null) localStorage.removeItem(SESSION_KEY);
    else localStorage.setItem(SESSION_KEY, String(id));
  } catch {
    /* ignore */
  }
}

function newUserCode(users) {
  let code;
  do {
    code = String(Math.floor(100000 + Math.random() * 900000));
  } while (users.some((u) => u.userCode === code));
  return code;
}

function publicUser(user) {
  // deviceLastSeenAt is recomputed per call so the device does not appear to
  // drift further offline the longer the page stays open.
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    userCode: user.userCode,
    deviceOnline: true,
    deviceLastSeenAt: new Date(Date.now() - 4 * 60_000).toISOString(),
  };
}

// Generated once per range per page load. Without this, every switch between
// 24h/7d/30d would reshuffle the history under the user.
const rowCache = new Map();

const mockApi = {
  async register({ name, email, password, pin }) {
    await sleep(400);
    const users = readStore();
    if (users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
      throw new ApiError('email_taken', 409);
    }
    const user = {
      id: Math.max(0, ...users.map((u) => u.id)) + 1,
      name,
      email,
      password,
      pin,
      userCode: newUserCode(users),
    };
    users.push(user);
    writeStore(users);
    return { id: user.id, userCode: user.userCode };
  },

  async login({ email, password }) {
    await sleep(400);
    const user = readStore().find(
      (u) => u.email.toLowerCase() === email.toLowerCase() && u.password === password
    );
    if (!user) throw new ApiError('invalid_credentials', 401);
    writeSessionId(user.id);
    return { id: user.id, name: user.name };
  },

  async logout() {
    await sleep(150);
    writeSessionId(null);
    return null;
  },

  async me() {
    await sleep(250);
    const id = readSessionId();
    const user = readStore().find((u) => u.id === id);
    if (!user) throw new ApiError('unauthenticated', 401);
    return publicUser(user);
  },

  async readings(range) {
    await sleep(500);
    if (!readSessionId()) throw new ApiError('unauthenticated', 401);
    if (!rowCache.has(range)) rowCache.set(range, mockRows(range));
    // Contract: ascending, capped at the 5000 most recent rows.
    return { range, rows: rowCache.get(range).slice(-5000) };
  },
};

// ---------------------------------------------------------------------------
// Public surface — identical shapes either way
// ---------------------------------------------------------------------------

export const api = {
  register: (payload) =>
    MOCK ? mockApi.register(payload) : request('/api/auth/register', { method: 'POST', body: payload }),

  login: (payload) =>
    MOCK ? mockApi.login(payload) : request('/api/auth/login', { method: 'POST', body: payload }),

  logout: () => (MOCK ? mockApi.logout() : request('/api/auth/logout', { method: 'POST' })),

  me: () => (MOCK ? mockApi.me() : request('/api/me')),

  readings: (range) =>
    MOCK ? mockApi.readings(range) : request(`/api/readings?range=${encodeURIComponent(range)}`),
};

/** Shown on the login page while MOCK is on, so the demo account is discoverable. */
export const DEMO_CREDENTIALS = { email: MOCK_ME.email, password: SEED_PASSWORD };

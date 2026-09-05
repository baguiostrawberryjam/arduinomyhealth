// A Catcher Device made of Node.
//
//   node scripts/fake-device.js --code 622701 --pin 4821 [--url http://localhost:3000]
//                               [--interval 15] [--session 5]
//
// Speaks the exact protocol the ESP32 will speak: keypad login for a session
// token, readings every ~15s while a finger is on the sensor, a heartbeat every
// 10 minutes, and re-login when the 15-minute token expires.
//
// This is what makes the hardware optional. By the time the real device posts
// for the first time, these endpoints have been taking traffic for days — so if
// something breaks then, it is unambiguously the firmware. That property is
// worth more than any amount of serial logging.

import process from 'node:process';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const BASE = (arg('url', process.env.BASE_URL || 'http://localhost:3000')).replace(/\/$/, '');
const DEVICE_KEY = process.env.DEVICE_KEY?.trim();
const userCode = arg('code');
const pin = arg('pin');
const intervalSec = Number(arg('interval', 15));
const sessionMin = Number(arg('session', 5));

if (!DEVICE_KEY) {
  console.error('DEVICE_KEY is not set. Run with --env-file-if-exists=.env, or export it.');
  process.exit(1);
}
if (!userCode || !pin) {
  console.error('usage: node scripts/fake-device.js --code <6 digits> --pin <4 digits> [--url …]');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(path, { body, token } = {}) {
  const headers = { 'X-Device-Key': DEVICE_KEY };
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* an HTML error page, most likely — keep the status and move on */
  }
  return { status: res.status, body: json };
}

async function login() {
  const res = await post('/api/session/login', { body: { userCode, pin } });
  if (res.status !== 200) {
    console.error(`  login failed: ${res.status} ${JSON.stringify(res.body)}`);
    return null;
  }
  console.log(`  logged in as ${res.body.name}`);
  return res.body.sessionToken;
}

/** One person's vitals, drifting the way a real measurement does. */
function makeSubject() {
  return {
    bpm: 68 + Math.random() * 22,
    spo2: 96 + Math.random() * 3,
    tempC: 36.4 + Math.random() * 0.8,
    tick: 0,
  };
}

function nextReading(subject) {
  subject.tick += 1;
  return {
    bpm: Math.round(subject.bpm + Math.sin(subject.tick / 3) * 4 + Math.random() * 3),
    spo2: Math.min(100, Math.round(subject.spo2 + Math.random() * 1.5)),
    tempC: +(subject.tempC + Math.random() * 0.2).toFixed(1),
  };
}

let heartbeatAt = 0;
async function maybeHeartbeat() {
  // Every 10 minutes, against Render's ~15 minute sleep. Keeps keypad login
  // instant, and makes the dashboard's online indicator real rather than
  // inferred from whenever the last reading happened to arrive.
  if (Date.now() - heartbeatAt < 10 * 60_000) return;
  const res = await post('/api/device/heartbeat');
  heartbeatAt = Date.now();
  console.log(`  heartbeat -> ${res.status}`);
}

console.log(`fake Catcher Device -> ${BASE}`);
console.log(`  user ${userCode}, reading every ${intervalSec}s, ${sessionMin} min per session\n`);

let stopping = false;
process.on('SIGINT', () => {
  console.log('\nstopping');
  stopping = true;
});

while (!stopping) {
  await maybeHeartbeat();

  const token = await login();
  if (!token) {
    // Wrong credentials, or the service is asleep. Wait rather than hammer it.
    await sleep(30_000);
    continue;
  }

  const subject = makeSubject();
  const until = Date.now() + sessionMin * 60_000;
  let sent = 0;
  let expired = false;

  while (!stopping && Date.now() < until) {
    const reading = nextReading(subject);
    const res = await post('/api/readings', { body: reading, token });

    if (res.status === 201) {
      sent += 1;
      process.stdout.write(
        `\r  ${sent} readings sent — last ${reading.bpm} BPM, ${reading.spo2}%, ${reading.tempC}C   `
      );
    } else if (res.status === 401) {
      // The 15-minute token ran out. Exactly what the firmware must handle.
      console.log('\n  session expired, logging in again');
      expired = true;
      break;
    } else {
      console.log(`\n  reading rejected: ${res.status} ${JSON.stringify(res.body)}`);
    }

    await sleep(intervalSec * 1000);
    await maybeHeartbeat();
  }

  if (!expired && !stopping) {
    // Session over: the person pressed A, or the device timed them out. Nothing
    // is recorded until someone logs in again — which is why the charts have
    // gaps, and why the history stays clean instead of filling with blanks.
    console.log(`\n  session finished (${sent} readings). Idle for 2 min.`);
    for (let i = 0; i < 8 && !stopping; i++) {
      await sleep(15_000);
      await maybeHeartbeat();
    }
  }
}

process.exit(0);

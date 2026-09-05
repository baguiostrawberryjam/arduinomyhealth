// Seed a user with plausible history, straight into the database.
//
//   node scripts/seed.js --email demo@arduinomyhealth.com [--days 30] [--clear]
//
// You cannot demo a 30-day graph with a device that has been running for an
// afternoon, and waiting for real readings to accumulate would gate every chart
// and table on hardware. This writes what a month of use looks like.
//
// Shape matters more than volume. The Catcher only transmits while a finger is
// on the sensor, so real data is short bursts separated by long silence — the
// thing that breaks a chart which interpolates across gaps. Smooth fake data
// would hide that until the hardware was connected.

import process from 'node:process';
import { db } from '../db.js';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

const email = arg('email');
const days = Number(arg('days', 30));
const clear = has('clear');

if (!email) {
  console.error('usage: node scripts/seed.js --email <address> [--days 30] [--clear]');
  process.exit(1);
}

const found = await db.execute({ sql: 'SELECT id, name FROM users WHERE email = ?', args: [email] });
const user = found.rows[0];
if (!user) {
  console.error(`no account with email ${email} — register on the website first`);
  process.exit(1);
}
const userId = Number(user.id);

if (clear) {
  const gone = await db.execute({ sql: 'DELETE FROM readings WHERE user_id = ?', args: [userId] });
  console.log(`cleared ${gone.rowsAffected} existing readings`);
}

const now = Date.now();
const rows = [];

for (let day = days; day >= 0; day--) {
  // Some days nobody measures. A perfectly regular history looks synthetic.
  if (Math.random() < 0.18) continue;

  const sessions = 1 + Math.floor(Math.random() * 3);
  for (let s = 0; s < sessions; s++) {
    const hour = 7 + Math.floor(Math.random() * 14); // waking hours, Manila
    const start = now - day * 864e5 + (hour - 12) * 3600e3 + Math.random() * 1800e3;
    if (start > now) continue;

    const n = 12 + Math.floor(Math.random() * 20); // ~3-8 minutes at 15s

    // Mostly healthy, with occasional sessions outside the limits so the
    // abnormal states are exercised rather than theoretical.
    const roll = Math.random();
    const fever = roll < 0.07;
    const lowSpo2 = roll >= 0.07 && roll < 0.13;
    const tachycardic = roll >= 0.13 && roll < 0.2;

    const baseBpm = tachycardic ? 104 + Math.random() * 12 : 66 + Math.random() * 22;
    const baseTemp = fever ? 37.7 + Math.random() * 0.6 : 36.4 + Math.random() * 0.8;
    const baseSpo2 = lowSpo2 ? 92 + Math.random() * 2 : 96 + Math.random() * 3;

    for (let i = 0; i < n; i++) {
      const at = start + i * 15_000;
      if (at > now) break;
      rows.push([
        userId,
        Math.round(baseBpm + Math.sin(i / 3) * 4 + Math.random() * 3),
        Math.min(100, Math.round(baseSpo2 + Math.random() * 1.5)),
        +(baseTemp + Math.random() * 0.2).toFixed(1),
        new Date(at).toISOString(),
      ]);
    }
  }
}

rows.sort((a, b) => new Date(a[4]) - new Date(b[4]));

// One INSERT at a time to Turso would be a network round trip each; batch.
const SQL = 'INSERT INTO readings (user_id, bpm, spo2, temp_c, recorded_at) VALUES (?, ?, ?, ?, ?)';
const CHUNK = 200;
for (let i = 0; i < rows.length; i += CHUNK) {
  await db.batch(
    rows.slice(i, i + CHUNK).map((args) => ({ sql: SQL, args })),
    'write'
  );
  process.stdout.write(`\r  ${Math.min(i + CHUNK, rows.length)}/${rows.length}`);
}
process.stdout.write('\r');

const summary = (
  await db.execute({
    sql: `SELECT COUNT(*) n, MIN(recorded_at) oldest, MAX(recorded_at) newest,
                 SUM(bpm > 100) high_bpm, SUM(spo2 < 95) low_spo2, SUM(temp_c > 37.5) high_temp
            FROM readings WHERE user_id = ?`,
    args: [userId],
  })
).rows[0];

console.log(`seeded ${rows.length} readings for ${user.name} <${email}>`);
console.log(`  ${summary.n} total, ${String(summary.oldest).slice(0, 10)} to ${String(summary.newest).slice(0, 10)}`);
console.log(`  abnormal: ${summary.high_bpm} high BPM, ${summary.low_spo2} low SpO2, ${summary.high_temp} high temp`);
process.exit(0);

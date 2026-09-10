// Delete an account and everything it owns.
//
//   node scripts/delete-user.js --email someone@example.com          # dry run
//   node scripts/delete-user.js --email someone@example.com --yes    # do it
//
// There is deliberately no delete button in the admin view — a screen that can
// erase a person's history is a screen somebody eventually clicks by accident.
// This is the deliberate path instead: it runs from a terminal, it shows what
// it is about to remove, and it does nothing at all unless you pass --yes.
//
// Two guards, because the mistakes worth preventing here are the human ones:
//
//   1. It matches on email, never on id. A typo finds nobody and stops, where a
//      wrong id would quietly delete the wrong person.
//   2. It refuses to delete the last remaining admin. You cannot lock yourself
//      out of /admin with this script, whatever you type.

import process from 'node:process';
import { db } from '../db.js';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

const email = arg('email')?.trim().toLowerCase();
const confirmed = has('yes');

if (!email) {
  console.error('usage: node scripts/delete-user.js --email <address> [--yes]');
  process.exit(1);
}

// Read the same way routes/admin.js does, so this agrees with the live server.
const adminEmails = new Set(
  (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().replace(/^["']|["']$/g, '').trim().toLowerCase())
    .filter(Boolean)
);

const found = await db.execute({
  sql: `SELECT u.id, u.name, u.email, u.user_code, u.created_at,
               COUNT(r.id) AS reading_count
          FROM users u
          LEFT JOIN readings r ON r.user_id = u.id
         WHERE u.email = ?
      GROUP BY u.id`,
  args: [email],
});

const user = found.rows[0];
if (!user) {
  console.error(`no account with email ${email} — nothing was deleted`);
  process.exit(1);
}

const isAdmin = adminEmails.has(user.email.toLowerCase());
const readingCount = Number(user.reading_count);

console.log('');
console.log('  about to delete');
console.log(`    name       ${user.name}`);
console.log(`    email      ${user.email}`);
console.log(`    user id    ${user.user_code}   (row id ${user.id})`);
console.log(`    registered ${user.created_at}`);
console.log(`    readings   ${readingCount.toLocaleString()}  (deleted with the account)`);
console.log(`    admin      ${isAdmin ? 'YES — currently listed in ADMIN_EMAILS' : 'no'}`);
console.log('');

// The invariant worth enforcing: never delete your way out of admin access.
// Everything else here is recoverable by registering again; a database with no
// admin in it means editing environment variables to get back in.
if (isAdmin && adminEmails.size <= 1) {
  console.error('  refusing: this is the only admin in ADMIN_EMAILS.');
  console.error('  Add a second admin first, or take this one out of ADMIN_EMAILS.');
  process.exit(1);
}

if (!confirmed) {
  console.log('  dry run — nothing was deleted. Re-run with --yes to go ahead.');
  process.exit(0);
}

// Readings first and explicitly, rather than trusting ON DELETE CASCADE: whether
// it fires depends on foreign keys being enabled, which is a PRAGMA that differs
// between a local SQLite file and Turso. Two statements always do the same thing.
const gone = await db.execute({ sql: 'DELETE FROM readings WHERE user_id = ?', args: [user.id] });
await db.execute({ sql: 'DELETE FROM users WHERE id = ?', args: [user.id] });

console.log(`  deleted ${user.email} and ${gone.rowsAffected.toLocaleString()} readings`);

if (isAdmin) {
  console.log('');
  console.log('  Still to do: take this address out of ADMIN_EMAILS on Render.');
  console.log('  Leaving it there is harmless — it matches no account now — but');
  console.log('  someone re-registering that address would become an admin.');
}
console.log('');

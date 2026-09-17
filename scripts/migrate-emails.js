// Migrate admin emails from @arduinomyhealth.ph to @vitalink.ph.
//
//   node --env-file-if-exists=.env scripts/migrate-emails.js
//   node --env-file-if-exists=.env scripts/migrate-emails.js --yes
//
// Without --yes it is a dry run: shows what would change and stops.

import process from 'node:process';
import { db, initSchema } from '../db.js';

const OLD_DOMAIN = '@arduinomyhealth.ph';
const NEW_DOMAIN = '@vitalink.ph';
const apply = process.argv.includes('--yes');

await initSchema();

const result = await db.execute({
  sql: `SELECT id, name, email FROM users WHERE email LIKE ?`,
  args: [`%${OLD_DOMAIN}`],
});

if (result.rows.length === 0) {
  console.log(`No accounts found with ${OLD_DOMAIN} emails. Nothing to do.`);
  process.exit(0);
}

console.log(`Found ${result.rows.length} account(s) to migrate:\n`);
for (const row of result.rows) {
  const newEmail = row.email.replace(OLD_DOMAIN, NEW_DOMAIN);
  console.log(`  ${row.name} <${row.email}>  →  <${newEmail}>`);
}

if (!apply) {
  console.log('\nDry run. Pass --yes to apply.');
  process.exit(0);
}

console.log('');

const stmts = result.rows.map((row) => ({
  sql: 'UPDATE users SET email = ? WHERE id = ?',
  args: [row.email.replace(OLD_DOMAIN, NEW_DOMAIN), row.id],
}));

await db.batch(stmts, 'write');

console.log(`Updated ${stmts.length} email(s).`);
process.exit(0);

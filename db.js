// libSQL client.
//
// Turso in production; a local SQLite file when TURSO_DATABASE_URL is unset, so
// the server boots and is testable with no cloud account. That fallback is a
// development convenience only — Render's free filesystem is ephemeral, so a
// file database there is silently wiped on every deploy and restart. Booting in
// production without Turso credentials therefore logs a loud warning.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';

const here = path.dirname(fileURLToPath(import.meta.url));

const configuredUrl = process.env.TURSO_DATABASE_URL?.trim();
const authToken = process.env.TURSO_AUTH_TOKEN?.trim() || undefined;

export const usingLocalFallback = !configuredUrl;
const url = configuredUrl || `file:${path.join(here, 'data', 'local.db')}`;

if (url.startsWith('file:')) {
  fs.mkdirSync(path.dirname(url.slice('file:'.length)), { recursive: true });
}

export const db = createClient({ url, authToken });

/** What /api/health reports, without leaking the connection string. */
export function describeDatabase() {
  if (!usingLocalFallback) return 'turso';
  return 'local-file';
}

/**
 * Create the tables. Runs on every boot; schema.sql is entirely IF NOT EXISTS,
 * so this is a no-op against an existing database. A schema file rather than a
 * migration tool: the schema changes maybe twice in this project's life.
 */
export async function initSchema() {
  const sql = fs.readFileSync(path.join(here, 'schema.sql'), 'utf8');
  await db.executeMultiple(sql);
}

/** Cheap round trip, so /api/health reflects the database and not just Node. */
export async function pingDatabase() {
  await db.execute('SELECT 1');
}

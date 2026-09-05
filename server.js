// ArduinoMyHealth — one Express process serving both the REST API and the built
// React dashboard.
//
// One service is deliberate: no CORS, one URL, one deploy, and it fits Render's
// free instance-hour allowance, which covers exactly one always-on service.
//
// Right now this is the deploy skeleton: /api/health plus static hosting. The
// auth, session and readings routes land next, under /api.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { describeDatabase, initSchema, pingDatabase, usingLocalFallback } from './db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(here, 'web', 'dist');
const INDEX_HTML = path.join(DIST_DIR, 'index.html');
const PORT = Number(process.env.PORT) || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production' || Boolean(process.env.RENDER);

const startedAt = Date.now();
const app = express();

app.disable('x-powered-by');
// Render terminates TLS in front of us; without this, req.secure is false and
// the auth cookie would never get its Secure flag set.
app.set('trust proxy', 1);
app.use(express.json({ limit: '16kb' }));

// ---------------------------------------------------------------- API ------

/**
 * Liveness plus a real database round trip.
 *
 * This is what proves a deploy actually works, so it reports the database
 * separately from the process: a 200 with db "error" means Node is up and the
 * Turso credentials are wrong, which is a completely different problem from the
 * service failing to boot.
 */
app.get('/api/health', async (req, res) => {
  const body = {
    ok: true,
    service: 'arduinomyhealth',
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    database: describeDatabase(),
    frontendBuilt: fs.existsSync(INDEX_HTML),
  };
  try {
    await pingDatabase();
    body.db = 'ok';
  } catch (err) {
    body.db = 'error';
    body.dbError = err.message;
  }
  res.json(body);
});

// Unknown /api/* must never fall through to the SPA — an API typo should be a
// JSON 404, not a 200 with an HTML page that the frontend then fails to parse.
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'not_found' });
});

// ----------------------------------------------------------- frontend ------

if (fs.existsSync(INDEX_HTML)) {
  // index: false so every non-file request falls through to the SPA handler
  // below, which is what makes a deep link like /login work on a hard refresh.
  app.use(express.static(DIST_DIR, { index: false, maxAge: '1h' }));
  app.use((req, res) => res.sendFile(INDEX_HTML));
} else {
  app.use((req, res) => {
    res
      .status(503)
      .type('text/plain')
      .send(
        'Frontend has not been built.\n\nRun:  npm run build\n' +
          '(or, from web/:  npm install && npm run build)\n'
      );
  });
}

// ---------------------------------------------------------------- boot ------

async function start() {
  if (IS_PRODUCTION && usingLocalFallback) {
    console.warn(
      '\n  WARNING: running in production with no TURSO_DATABASE_URL.\n' +
        '  Falling back to a local SQLite file. Render\'s filesystem is ephemeral,\n' +
        '  so every reading will be lost on the next deploy or restart.\n' +
        '  Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.\n'
    );
  }

  try {
    await initSchema();
    console.log(`  schema ready (${describeDatabase()})`);
  } catch (err) {
    // Do not exit. A database problem should still leave the service up so
    // /api/health can report what is wrong — a dead process on Render just
    // says "deploy failed" and tells you nothing.
    console.error(`  schema failed: ${err.message}`);
  }

  if (!fs.existsSync(INDEX_HTML)) {
    console.warn('  frontend not built — web/dist is missing, API only');
  }

  app.listen(PORT, () => {
    console.log(`  ArduinoMyHealth listening on http://localhost:${PORT}`);
  });
}

start();

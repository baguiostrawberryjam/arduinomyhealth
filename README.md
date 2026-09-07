# ArduinoMyHealth

One Express process serving the REST API and the built React dashboard, backed
by Turso (libSQL). Readings come from a single shared **Catcher Device**; each
person authenticates at its keypad with a 6-digit User ID and a 4-digit PIN.

```
health-monitor/
├── server.js       Express: /api/* + static web/dist + SPA fallback
├── db.js           libSQL client (Turso, or a local file for development)
├── schema.sql      CREATE TABLE IF NOT EXISTS, run on every boot
├── web/            Vite React dashboard (its own package.json)
├── firmware/       Catcher Device sketch (ESP32) — see firmware/README.md
└── .env.example
```

## Running locally

```bash
npm install          # server deps
npm run build        # installs and builds web/ into web/dist
npm start            # http://localhost:3000
```

That serves the production build. For frontend work, run the Vite dev server in
a second terminal instead — it proxies `/api` to port 3000, so both halves work
together with hot reload:

```bash
cd web && npm run dev    # http://localhost:5173
```

No database setup is needed locally. With `TURSO_DATABASE_URL` unset, `db.js`
falls back to a SQLite file at `data/local.db` and creates the schema on boot.

## Deploying to Render

| Setting | Value |
| :--- | :--- |
| Root directory | leave blank — `server.js` is at the repo root |
| Build command | `npm install && cd web && npm install && npm run build` |
| Start command | `node server.js` |
| Region | Singapore — the only Asian region, closest to the Catcher and to Turso in Tokyo |
| Instance type | Free |

Environment variables — all four, before the first deploy:

| Variable | Where it comes from |
| :--- | :--- |
| `TURSO_DATABASE_URL` | Turso dashboard, `libsql://…` |
| `TURSO_AUTH_TOKEN` | Turso dashboard |
| `JWT_SECRET` | Any long random string; signs the browser session cookie |
| `DEVICE_KEY` | Any long random string; also entered into the Catcher's WiFi portal |

Do **not** set `PORT` — Render provides it.

### Checking a deploy

`GET /api/health` reports the process and the database separately:

```json
{ "ok": true, "database": "turso", "db": "ok", "frontendBuilt": true }
```

- `db: "error"` with the service still up means Node is fine and the Turso
  credentials are wrong. The server deliberately does not exit on a database
  failure, because a crashed process on Render only tells you "deploy failed".
- `database: "local-file"` in production means `TURSO_DATABASE_URL` is missing.
  Render's filesystem is ephemeral, so every reading would be lost on the next
  deploy. The boot log warns loudly about this.
- `frontendBuilt: false` means the build command did not produce `web/dist`.

### Free-tier notes

- Render free services **sleep after ~15 minutes idle** and take up to a minute
  to wake. The Catcher's 10-minute heartbeat keeps the service warm while the
  device is powered — which matters because keypad login is a blocking network
  call, and a cold start in front of a panel is the demo failing. Open the site
  a few minutes before a defense in case the device has been off.
- The free allowance is ~750 instance-hours/month, which covers **one**
  always-on service. Do not deploy a second free service.
- Do not use Render's own free Postgres: those databases **expire after 30
  days**. Turso is the database, and its free plan (5 GB, 500M row reads/month)
  is far beyond this project's few thousand rows.

## Status

Done: the dashboard, the deploy skeleton, all website endpoints, all Catcher
endpoints, and the seed and fake-device scripts. The frontend runs on the live
API (`MOCK = false`).

Next: firmware v4 — WiFiManager, the device key in NVS, two-step keypad login,
HTTPS POST, ~2-minute idle logout, 10-minute heartbeat, and the four firmware
correctness fixes.

## Scripts

```bash
# 30 days of plausible history for an existing account
node --env-file-if-exists=.env scripts/seed.js --email you@example.com --days 30 --clear

# a Catcher Device made of Node: keypad login, readings every 15s, heartbeat
node --env-file-if-exists=.env scripts/fake-device.js --code 622701 --pin 4821
```

`fake-device.js` speaks the exact protocol the ESP32 will speak, so the
endpoints have been taking traffic long before any hardware does.

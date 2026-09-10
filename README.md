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

Optional:

| Variable | Where it comes from |
| :--- | :--- |
| `ADMIN_EMAILS` | Comma-separated emails that may open `/admin`. Blank means nobody. |

Do **not** set `PORT` — Render provides it.

### Checking a deploy

`GET /api/health` reports the process and the database separately:

```json
{ "ok": true, "database": "turso", "db": "ok", "frontendBuilt": true,
  "admins": 1, "adminEmails": "set" }
```

- `db: "error"` with the service still up means Node is fine and the Turso
  credentials are wrong. The server deliberately does not exit on a database
  failure, because a crashed process on Render only tells you "deploy failed".
- `database: "local-file"` in production means `TURSO_DATABASE_URL` is missing.
  Render's filesystem is ephemeral, so every reading would be lost on the next
  deploy. The boot log warns loudly about this.
- `frontendBuilt: false` means the build command did not produce `web/dist`.
- `adminEmails: "unset"` means `ADMIN_EMAILS` never reached the process — it was
  not saved, it is on another service, or the name is misspelled. `"set"` with
  `admins: 0` is the opposite problem: the variable is there and nothing in it
  parsed. Either way the site works; `/admin` just belongs to nobody.

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

## The admin view

`/admin` lists every account — name, email, User ID, how many readings they have
and when the last one arrived — and selecting a name opens that person's
dashboard, the same page with the same charts, table, zoom and CSV.

Who may see it is the `ADMIN_EMAILS` environment variable, a comma-separated
list, rather than a column on `users`. A role column would mean a migration plus
a way to grant and revoke it, for a system whose one or two admins are known
before the deploy. The account has to already exist: register on the site
normally, then add that email to `ADMIN_EMAILS` and restart.

The list is read-only. There is no editing, no deletion, no impersonation, and
no way to reach the keypad as somebody else — an admin reads, and that is all.
Both endpoints check for themselves, so the `isAdmin` flag on `/api/me` only
decides whether the browser bothers to show the link.

Admins are equal — there is no hierarchy in the code. If you keep a "master"
account and a second one you intend to throw away, that distinction is yours,
not the system's, and nothing about deleting one can reach the other: they are
separate rows behind a unique email index, `ADMIN_EMAILS` is a plain list, and a
session cookie carries only its own user id.

### Removing an admin

Two different things, and usually you only want the first:

- **Take away admin rights** — remove the address from `ADMIN_EMAILS` and save.
  It applies on the next request, not whenever their cookie expires. The account
  and its readings are untouched.
- **Delete the account entirely** — `scripts/delete-user.js`, below. This also
  deletes that person's readings, and cannot be undone.

## Status

Done: the dashboard, the deploy skeleton, all website endpoints, all Catcher
endpoints, the admin view, the seed and fake-device scripts, and Catcher Device
firmware v4. The frontend runs on the live API (`MOCK = false`), and the
hardware has been verified end to end.

## Scripts

```bash
# 30 days of plausible history for an existing account
node --env-file-if-exists=.env scripts/seed.js --email you@example.com --days 30 --clear

# a Catcher Device made of Node: keypad login, readings every 15s, heartbeat
node --env-file-if-exists=.env scripts/fake-device.js --code 622701 --pin 4821

# delete an account and its readings — shows what it would remove and stops
node --env-file-if-exists=.env scripts/delete-user.js --email someone@example.com
node --env-file-if-exists=.env scripts/delete-user.js --email someone@example.com --yes
```

`delete-user.js` is a terminal script rather than a button in the admin view on
purpose: a screen that can erase somebody's history is a screen that eventually
gets clicked by accident. It matches on email so a typo finds nobody instead of
finding the wrong person, and it refuses to delete the last remaining admin, so
no sequence of commands can lock you out of `/admin`.

`fake-device.js` speaks the exact protocol the ESP32 will speak, so the
endpoints have been taking traffic long before any hardware does.

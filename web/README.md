# ArduinoMyHealth — frontend

React + Vite, per **API Contract v1**. It now runs against the live API; the
mock fixtures in `src/mock.js` remain so the whole app can be worked on with no
backend running.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # → dist/, served by Express in production
```

## Mock mode

`src/api.js` decides where data comes from:

```js
export const MOCK = false;   // live API  ->  set true for fixtures
```

Nothing else changes. Every page and component only ever sees the shapes the
contract defines, and every request path is relative (`/api/...`), so the same
build works on localhost, on Render, and on the client's own domain.

In dev, `vite.config.js` proxies `/api` to `http://localhost:3000` so relative
paths work before `dist/` is being served by Express.

## Accounts

Live: register on the site. With `MOCK = true`, a fixture account
`juan@example.com` / `password123` is served from `localStorage` instead.

## Layout

| File | Responsibility |
| :--- | :--- |
| `api.js` | fetch wrappers, the `MOCK` toggle, and the mock backend |
| `mock.js` | the contract's fixtures, verbatim |
| `constants.js` | thresholds shared with firmware + backend, and the per-metric config |
| `series.js` | chart thinning and **gap detection** — see below |
| `format.js` | Manila timestamps and CSV building |
| `router.js` | ~20-line router (react-router isn't a dependency) |

## The admin view

`pages/AdminUsers.jsx` serves both `/admin` and `/admin/user/:id`. It holds the
list of users, and when the URL names one it renders `Dashboard` with a
`viewUser` prop instead. Keeping both routes in one component means the single
`/api/admin/users` query answers both screens, and a hard refresh straight onto
a user still has the name and User ID it needs to render.

Nothing else was added: the stat cards, the three charts, the table, the range
control, the tabs, the drag-to-zoom and the CSV all work there unchanged.

## The one thing not to break

The data is **bursts of activity separated by long gaps**: a few minutes of
readings every 15 s, then hours of nothing. A line chart fed those points
naively draws a straight line across the empty hours, inventing readings that
were never taken.

`series.js` prevents that by inserting an explicit `{y: null}` wherever the
Catcher was silent, with `spanGaps: false` on the dataset. The gap threshold is
derived from the series' own median spacing rather than hardcoded, because
thinning changes that spacing between ranges (nothing is dropped at 24h; roughly
one row in ten survives at 30d).

A session that survives thinning as a single point would draw no line at all, so
those points are given a visible dot instead.

If you change the thinning, re-check that no drawn segment spans more than a few
minutes at any range.

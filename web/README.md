# ArduinoMyHealth — frontend

React + Vite. Built entirely against the mock fixtures in `src/mock.js`, per
**API Contract v1**. No backend is required to run it.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # → dist/, served by Express in production
```

## Switching to the real backend

One line, in `src/api.js`:

```js
export const MOCK = false;
```

Nothing else changes. Every page and component only ever sees the shapes the
contract defines, and every request path is relative (`/api/...`), so the same
build works on localhost, on Render, and on the client's own domain.

In dev, `vite.config.js` proxies `/api` to `http://localhost:3000` so relative
paths work before `dist/` is being served by Express.

## Demo account (while `MOCK = true`)

`juan@example.com` / `password123`. Registering creates an extra account in
`localStorage`; clearing site data resets everything to the seed.

## Layout

| File | Responsibility |
| :--- | :--- |
| `api.js` | fetch wrappers, the `MOCK` toggle, and the mock backend |
| `mock.js` | the contract's fixtures, verbatim |
| `constants.js` | thresholds shared with firmware + backend, and the per-metric config |
| `series.js` | chart thinning and **gap detection** — see below |
| `format.js` | Manila timestamps and CSV building |
| `router.js` | ~20-line router (three pages; react-router isn't a dependency) |

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

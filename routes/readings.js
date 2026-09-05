// Readings — API Contract v1.
//
//   GET /api/readings?range=24h|7d|30d  -> 200 { range, rows }  401 unauthenticated
//
// This single endpoint feeds all four dashboard surfaces: the stat cards, the
// three charts, the table, and the CSV. One fetch, one loading state.
//
// POST /api/readings (the Catcher's ingest) lands next, with the device routes.

import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../session.js';

export const readingsRoutes = Router();

const RANGE_SPAN_MS = {
  '24h': 864e5,
  '7d': 6048e5,
  '30d': 2592e6,
};

/** Contract: at most the 5000 most recent rows. */
const MAX_ROWS = 5000;

readingsRoutes.get('/readings', requireAuth, async (req, res, next) => {
  const range = String(req.query.range ?? '24h');
  const span = RANGE_SPAN_MS[range];
  if (!span) return res.status(400).json({ error: 'invalid_input' });

  const since = new Date(Date.now() - span).toISOString();

  try {
    // Ordered DESC so LIMIT keeps the *newest* 5000 rather than the oldest,
    // then reversed, because the contract promises ascending rows. Doing it the
    // other way round would silently drop today's readings on a busy account.
    const result = await db.execute({
      sql: `SELECT id, bpm, spo2, temp_c, recorded_at
              FROM readings
             WHERE user_id = ? AND recorded_at >= ?
          ORDER BY recorded_at DESC, id DESC
             LIMIT ?`,
      args: [req.userId, since, MAX_ROWS],
    });

    const rows = result.rows
      .map((r) => ({
        id: Number(r.id),
        bpm: Number(r.bpm),
        spo2: Number(r.spo2),
        tempC: Number(r.temp_c),
        recordedAt: r.recorded_at,
      }))
      .reverse();

    res.json({ range, rows });
  } catch (err) {
    next(err);
  }
});

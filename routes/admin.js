// Admin — a read-only view of every account, for the researcher or clinician
// running the study.
//
//   GET /api/admin/users -> 200 { users: [...] }   403 forbidden
//
// Who is an admin is decided by the ADMIN_EMAILS environment variable, a
// comma-separated list. That is deliberately not a column: adding a role to the
// schema means a migration, a way to grant it, and a way to revoke it, for a
// system that has one or two admins who are known before the deploy.
//
// Admins read data. Nothing here writes, edits, or deletes.

import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../session.js';

export const adminRoutes = Router();

const adminEmails = new Set(
  (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
);

export const adminCount = adminEmails.size;

export function isAdminEmail(email) {
  return adminEmails.has(String(email ?? '').trim().toLowerCase());
}

/**
 * Is this account id an admin?
 *
 * Re-reads the email from the database rather than trusting anything in the
 * cookie, so removing someone from ADMIN_EMAILS takes effect on their next
 * request instead of whenever their 7-day session happens to expire.
 */
export async function isAdminUser(userId) {
  if (adminEmails.size === 0) return false; // nothing configured, nobody is admin
  const found = await db.execute({
    sql: 'SELECT email FROM users WHERE id = ?',
    args: [userId],
  });
  return isAdminEmail(found.rows[0]?.email);
}

/** Gate for admin-only routes. Runs after requireAuth. */
export async function requireAdmin(req, res, next) {
  try {
    if (!(await isAdminUser(req.userId))) {
      return res.status(403).json({ error: 'forbidden' });
    }
    next();
  } catch (err) {
    next(err);
  }
}

adminRoutes.get('/admin/users', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    // LEFT JOIN, so an account that has never used the Catcher still appears —
    // "registered but has taken no readings" is exactly what an admin needs to
    // see, and an inner join would hide it.
    const result = await db.execute(`
      SELECT u.id, u.name, u.email, u.user_code, u.created_at,
             COUNT(r.id)        AS reading_count,
             MAX(r.recorded_at) AS last_reading_at
        FROM users u
        LEFT JOIN readings r ON r.user_id = u.id
    GROUP BY u.id
    ORDER BY u.name COLLATE NOCASE
    `);

    res.json({
      users: result.rows.map((r) => ({
        id: Number(r.id),
        name: r.name,
        email: r.email,
        userCode: r.user_code,
        createdAt: r.created_at,
        readingCount: Number(r.reading_count),
        lastReadingAt: r.last_reading_at ?? null,
        isAdmin: isAdminEmail(r.email),
      })),
    });
  } catch (err) {
    next(err);
  }
});

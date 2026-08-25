import type { drizzle } from 'drizzle-orm/postgres-js';
import { getDatabaseForOrg, invalidateOrgConnection } from './tenantDirectory';

/**
 * Org-aware database access.
 *
 * ── Why there is no longer a single connection ──────────────────────────────
 *
 * This module used to export a process-wide singleton over one `DATABASE_URL`,
 * which was correct only while every organization shared a database. The moment
 * one is moved to its own, that singleton reads and writes the SHARED database
 * for an org whose data lives elsewhere — and the failure is silent: member
 * lookups return "not found", and `POST /api/checkin` writes an attendance row
 * into a database the app no longer reads.
 *
 * Connection selection now goes through `tenantDirectory`, which resolves an
 * org to its own database. The org-unaware entry point was REMOVED rather than
 * deprecated, so a new route cannot reach for it by habit.
 */

const CONNECTION_ERRORS = new Set(['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT']);

function isConnectionError(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    return false;
  }
  const cause = (err as { cause?: { code?: string } }).cause;
  return !!cause?.code && CONNECTION_ERRORS.has(cause.code);
}

/**
 * Run `fn` against `orgId`'s database, with one retry on a connection-level
 * error.
 *
 * The retry drops the cached handle AND the directory entry, so it re-reads the
 * tenant row: if the failure was caused by a cutover moving this org, the retry
 * finds its new database rather than reconnecting to the old one.
 *
 * Throws `TenantUnavailableError` when the org is not servable — no tenant row
 * in split mode, or `status='migrating'` during a data copy. Callers should
 * surface a 503 and REFUSE. Falling back to a shared connection is exactly the
 * silent divergence this replaces.
 */
export async function withOrgRetry<T>(
  orgId: string,
  fn: (db: ReturnType<typeof drizzle>) => Promise<T>,
): Promise<T> {
  try {
    return await fn(await getDatabaseForOrg(orgId));
  }
  catch (err) {
    if (isConnectionError(err)) {
      await invalidateOrgConnection(orgId);
      return fn(await getDatabaseForOrg(orgId));
    }
    throw err;
  }
}

import type { Sql } from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { Pool } from 'pg';
import postgres from 'postgres';
import { decryptConnectionString, tenantEncryptionKey } from './tenantCrypto';

/**
 * Resolve an organization to its own database.
 *
 * ── Why the kiosk needs this ────────────────────────────────────────────────
 *
 * Until now the kiosk held ONE `DATABASE_URL` for every organization. That is
 * correct while all orgs share a database and silently wrong the moment one is
 * moved: the kiosk would keep reading and writing the SHARED database for an
 * org whose data now lives elsewhere. The failure is not an error — member
 * lookups return "not found", and, worse, `POST /api/checkin` writes an
 * attendance row into a database the app no longer reads. Silent divergence.
 *
 * Ported from dojo-planner's `TenantDirectoryService` + `TenantDb`, adapted to
 * the kiosk's `postgres-js` driver. The control plane uses `pg`, matching the
 * planner, because the directory read is a small infrequent query.
 *
 * ── The local escape hatch is NOT optional ──────────────────────────────────
 *
 * `DEFAULT_TENANT_DATABASE_URL` short-circuits everything below, so
 * `npm run dev` keeps working against one local database with no control
 * plane, no encryption key and no `tenant` row. Without it, adding this file
 * would have made local kiosk development require infrastructure it never
 * needed before.
 *
 * The `NODE_ENV !== 'production'` guard on that hatch is load-bearing: without
 * it a misconfigured production deploy would route EVERY organization to one
 * database — exactly the cross-tenant leak this migration exists to remove.
 */

/** Mirrors dojo-planner's TENANT_STATUS. Only `active` is servable. */
const TENANT_STATUS_ACTIVE = 'active';

/** `region` marking a row that points at the shared database, not its own. */
const SHARED_REGION = 'shared';
/**
 * Written by the planner's auto-registration (and by `rollbackTenant`) for an
 * org that is not cut over. Must match the planner's constant exactly — the
 * two apps read the same rows.
 */
const SHARED_DATABASE_SENTINEL = '__shared_database__';

const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 200;

interface TenantRecord { orgId: string; connectionString: string }
interface CacheEntry { record: TenantRecord; expiresAt: number }

const directoryCache = new Map<string, CacheEntry>();

interface TenantHandle { db: ReturnType<typeof drizzle>; client: Sql }
const handles = new Map<string, TenantHandle>();

let controlPool: Pool | null = null;

/** Thrown when an org has no servable database. Callers should refuse, not fall back. */
export class TenantUnavailableError extends Error {
  constructor(orgId: string, reason: string) {
    super(`Organization ${orgId} cannot be served: ${reason}`);
    this.name = 'TenantUnavailableError';
  }
}

/**
 * True when there is no separate control plane to consult.
 *
 * NOT a routing policy — a deployment fact. Locally the control pool would be
 * a SECOND socket against pglite-server, which accepts exactly one, so the
 * directory must be short-circuited before it is opened.
 */
function noControlPlane(): boolean {
  const control = process.env.CONTROL_DATABASE_URL;
  return !control || control === process.env.DATABASE_URL;
}

/**
 * Is this row's database the shared one?
 *
 * ⚠️ The predicate is the DECRYPTED CONNECTION STRING, never the region label.
 * `registerTenants` writes `region: 'aws-us-east-1'`, which is not in
 * SHARED_REGION — so a region check passes rows that point straight at the
 * shared database. That was a real cross-tenant leak; the label is a cheap
 * secondary filter and can never be the primary one.
 */
function pointsAtSharedDatabase(connectionString: string, region: string): boolean {
  if (
    connectionString === process.env.DATABASE_URL
    || connectionString === process.env.CONTROL_DATABASE_URL
  ) {
    return true;
  }
  return region === SHARED_REGION;
}

/**
 * The database that should serve this org.
 *
 * A row still naming the shared database is simply NOT CUT OVER YET, so it is
 * served from there rather than refused. Refusing is what forced an
 * all-or-nothing flip: with a global mode flag, moving one org 409'd every
 * other org. Orgs move one at a time, and this predicate — the same one the
 * planner uses — is how both apps agree without a coordinated env change.
 */
function resolveConnectionString(orgId: string, stored: string, region: string): string {
  const shared = process.env.DATABASE_URL;

  if (stored === SHARED_DATABASE_SENTINEL) {
    if (!shared) {
      throw new TenantUnavailableError(orgId, 'DATABASE_URL is not set');
    }
    return shared;
  }

  const key = tenantEncryptionKey();
  if (!key) {
    throw new TenantUnavailableError(orgId, 'no tenant encryption key configured');
  }

  const decrypted = decryptConnectionString(stored, key);

  if (pointsAtSharedDatabase(decrypted, region)) {
    if (!shared) {
      throw new TenantUnavailableError(orgId, 'DATABASE_URL is not set');
    }
    return shared;
  }

  return decrypted;
}

function getControlPool(): Pool {
  if (!controlPool) {
    const connectionString = process.env.CONTROL_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('Neither CONTROL_DATABASE_URL nor DATABASE_URL is set');
    }
    controlPool = new Pool({ connectionString, max: 1 });
    controlPool.on('error', () => {
      // An idle-client error must not crash the process; the next query reconnects.
      controlPool = null;
    });
  }
  return controlPool;
}

/**
 * The dev short-circuit. Returns null in production, and null when unset, so
 * the directory is consulted normally.
 */
function escapeHatch(orgId: string): TenantRecord | null {
  if (process.env.NODE_ENV === 'production') {
    return null;
  }
  const connectionString = process.env.DEFAULT_TENANT_DATABASE_URL;
  return connectionString ? { orgId, connectionString } : null;
}

async function resolveTenant(orgId: string): Promise<TenantRecord> {
  const hatch = escapeHatch(orgId);
  if (hatch) {
    return hatch;
  }

  // In shared mode there is nothing to look up: every org lives in the one
  // database this process already knows about. Short-circuit BEFORE opening a
  // control pool — locally that pool is a SECOND socket against pglite-server,
  // which accepts exactly one, so consulting the directory here fails the
  // tenant query with `read ECONNRESET`. Same class of bug as the planner's
  // ControlPool sizing: connection count is a property of the deployment, not
  // of the routing policy.
  if (noControlPlane()) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new TenantUnavailableError(orgId, 'DATABASE_URL is not set');
    }
    return { orgId, connectionString };
  }

  const cached = directoryCache.get(orgId);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.record;
  }
  directoryCache.delete(orgId);

  const { rows } = await getControlPool().query<{
    connection_string_enc: string;
    region: string;
    status: string;
  }>(
    'SELECT connection_string_enc, region, status FROM tenant WHERE org_id = $1 LIMIT 1',
    [orgId],
  );
  const row = rows[0];

  if (!row) {
    // Shared mode returned above, so reaching here means split mode: an
    // unregistered org has no database to serve from.
    throw new TenantUnavailableError(orgId, 'no tenant row');
  }

  // Refuse anything not actively servable. `migrating` lands here, which is the
  // point: during a data copy the kiosk must stop rather than write into a
  // database that is about to be superseded.
  if (row.status !== TENANT_STATUS_ACTIVE) {
    throw new TenantUnavailableError(orgId, `status is '${row.status}'`);
  }

  const record = { orgId, connectionString: resolveConnectionString(orgId, row.connection_string_enc, row.region) };

  if (directoryCache.size >= CACHE_MAX) {
    const oldest = directoryCache.keys().next().value;
    if (oldest !== undefined) {
      directoryCache.delete(oldest);
    }
  }
  directoryCache.set(orgId, { record, expiresAt: Date.now() + CACHE_TTL_MS });

  return record;
}

/** Host of a connection string, for logging. NEVER the credentials. */
export function connectionHost(connectionString: string): string {
  try {
    return new URL(connectionString).host || 'unknown';
  }
  catch {
    // Logging must never break a database resolution.
    return 'unparseable';
  }
}

/**
 * A drizzle handle for `orgId`'s database.
 *
 * Handles are cached per connection string, so orgs still sharing a database
 * share one socket — which matters locally, where pglite-server accepts exactly
 * one connection.
 */
export async function getDatabaseForOrg(orgId: string): Promise<ReturnType<typeof drizzle>> {
  const { connectionString } = await resolveTenant(orgId);

  // If the kiosk is served from the wrong database the symptom is silence:
  // member lookups return "not found" and check-ins insert an attendance row
  // nobody reads. One host per resolution is the only detector. Host only —
  // a connection string carries a password.
  console.warn('[Tenancy] resolved', { orgId, dbHost: connectionHost(connectionString) });

  const existing = handles.get(connectionString);
  if (existing) {
    return existing.db;
  }

  const client = postgres(connectionString, { max: 1, idle_timeout: 20, connect_timeout: 10 });
  const handle = { db: drizzle(client), client };
  handles.set(connectionString, handle);
  return handle.db;
}

/**
 * Drop the cached handle for an org after a connection-level error.
 *
 * Takes an orgId rather than a connection string because a thrown error does
 * not carry one — resolving it here keeps the caller from having to guess.
 * Also clears the directory entry, so a retry re-reads the tenant row: if the
 * failure was caused by a cutover moving the org, the retry finds the new
 * database rather than the dead one.
 */
export async function invalidateOrgConnection(orgId: string): Promise<void> {
  const cached = directoryCache.get(orgId);
  directoryCache.delete(orgId);
  if (!cached) {
    return;
  }
  const handle = handles.get(cached.record.connectionString);
  if (handle) {
    handles.delete(cached.record.connectionString);
    await handle.client.end({ timeout: 5 }).catch(() => {});
  }
}

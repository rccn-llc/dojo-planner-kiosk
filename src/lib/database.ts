import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

// Connection singleton — reused across requests within the same serverless instance.
// Stored on globalThis to survive Next.js hot-module reloads in development.
const globalKey = Symbol.for('dojo-kiosk-db');
const g = globalThis as unknown as Record<symbol, ReturnType<typeof drizzle> | undefined>;

function createConnection(): ReturnType<typeof drizzle> {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  // max: 1 is intentional:
  //   - Local dev: pglite-server only supports a single connection
  //   - Production (Neon serverless): each function instance holds one connection;
  //     Neon's connection pooler (pgBouncer) handles the pool on its side
  const client = postgres(connectionString, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  return drizzle(client);
}

export function getDatabase(): ReturnType<typeof drizzle> {
  if (!g[globalKey]) {
    g[globalKey] = createConnection();
  }
  return g[globalKey];
}

/**
 * Drop the cached connection so the next getDatabase() creates a fresh one.
 * Call this when a query fails with a connection-level error (ECONNRESET, etc.).
 */
export function resetConnection() {
  g[globalKey] = undefined;
}

const CONNECTION_ERRORS = new Set(['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT']);

function isConnectionError(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    return false;
  }
  const cause = (err as { cause?: { code?: string } }).cause;
  return !!cause?.code && CONNECTION_ERRORS.has(cause.code);
}

/**
 * Execute a database operation with one automatic retry on connection-level
 * errors (ECONNRESET, ECONNREFUSED, etc.). On the first failure the cached
 * connection is discarded and a fresh one is created for the retry.
 */
export async function withRetry<T>(fn: (db: ReturnType<typeof drizzle>) => Promise<T>): Promise<T> {
  try {
    return await fn(getDatabase());
  }
  catch (err) {
    if (isConnectionError(err)) {
      resetConnection();
      return fn(getDatabase());
    }
    throw err;
  }
}

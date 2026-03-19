import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

// Connection singleton — reused across requests within the same serverless instance
let cachedConnection: ReturnType<typeof drizzle> | null = null;

export function getDatabase() {
  if (!cachedConnection) {
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
      // ssl is automatically negotiated from the connection string (sslmode=require for Neon)
    });

    cachedConnection = drizzle(client);
  }

  return cachedConnection;
}

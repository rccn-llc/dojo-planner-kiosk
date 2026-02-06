import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

// For now, use a minimal schema type until we can properly import the full schema
// This allows the database connection to work while we work on the import structure
type Schema = Record<string, any>;

// Connection singleton for server-side use
let cachedConnection: ReturnType<typeof drizzle> | null = null;

export function getDatabase() {
  if (!cachedConnection) {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is required');
    }

    // Create postgres client with connection pooling
    const client = postgres(connectionString, {
      max: 10, // Maximum connections in pool for kiosk usage
      idle_timeout: 20, // Close idle connections after 20s
      connect_timeout: 10, // Connection timeout
    });

    cachedConnection = drizzle(client);
  }

  return cachedConnection;
}

// Placeholder until we can properly import the shared schema
export const schema = {} as Schema;
export type Database = typeof schema;

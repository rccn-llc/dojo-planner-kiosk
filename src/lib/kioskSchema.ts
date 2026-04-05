// Drizzle schema for kiosk_device table.
// Mirrors the kiosk_device table from dojo-planner/src/models/Schema.ts.

import { boolean, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const kioskDevice = pgTable(
  'kiosk_device',
  {
    id: text('id').primaryKey(),
    certFingerprint: text('cert_fingerprint').notNull().unique(),
    organizationId: text('organization_id').notNull(),
    name: text('name').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at', { mode: 'date' }),
  },
  table => [
    index('kiosk_device_org_idx').on(table.organizationId),
  ],
);

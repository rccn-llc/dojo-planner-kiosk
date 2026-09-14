// Minimal Drizzle schema for kiosk catalog queries.
// Mirrors the relevant tables from dojo-planner/src/models/Schema.ts.
// Update this file if the upstream schema changes.

import { boolean, integer, pgTable, real, text } from 'drizzle-orm/pg-core';

export const catalogItem = pgTable('catalog_item', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  shortDescription: text('short_description'),
  basePrice: real('base_price').notNull().default(0),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  showOnKiosk: boolean('show_on_kiosk').notNull().default(true),
  // Inventory. The kiosk sold sold-out belts and mouth guards because it never
  // declared these columns and so never read them — the store had no concept of
  // stock at all. `trackInventory = false` means the item is unlimited
  // (services, made-to-order); when true, the per-variant stockQuantity below
  // is authoritative.
  trackInventory: boolean('track_inventory').default(true),
  maxPerOrder: integer('max_per_order').default(10),
});

export const catalogItemVariant = pgTable('catalog_item_variant', {
  id: text('id').primaryKey(),
  catalogItemId: text('catalog_item_id').notNull(),
  name: text('name').notNull(),
  price: real('price').notNull(),
  stockQuantity: integer('stock_quantity').default(0),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const catalogItemImage = pgTable('catalog_item_image', {
  id: text('id').primaryKey(),
  catalogItemId: text('catalog_item_id').notNull(),
  url: text('url').notNull(),
  isPrimary: boolean('is_primary').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
});

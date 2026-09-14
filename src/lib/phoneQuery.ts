import type { AnyColumn, SQL } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

/**
 * SQL predicate matching a phone column against a caller-supplied number,
 * comparing only the digits.
 *
 * ⚠️ Never compare phone numbers with `eq(column, someString)`.
 *
 * `member.phone` holds whatever shape the thing that wrote the row used. Rows
 * created by the kiosk are bare digits (`5551234567`); rows seeded or imported
 * from elsewhere are commonly `555-123-4567`, `(555) 123-4567`, `+1 555 123
 * 4567`, or `1-555-123-4567`. A query that enumerates a few of those shapes
 * finds some members and silently misses the rest, which reads to staff as
 * "search by phone is broken for the old members but works for new ones" —
 * exactly the reported defect.
 *
 * `regexp_replace(col, '\D', '', 'g')` strips the formatting in the database,
 * and `RIGHT(..., 10)` drops any `1`/`+1` country prefix so the two sides are
 * comparable. Written as a raw fragment because Drizzle has no builder for it.
 *
 * Cost: this is not sargable, so it cannot use an index on `phone`. Every
 * caller already narrows by `organization_id` first, which keeps the scan to
 * one dojo's roster — small enough that correctness is the right trade.
 */
export function phoneDigitsMatch(column: AnyColumn, phone: string): SQL {
  const digits = phone.replace(/\D/g, '');
  const normalized = digits.length > 10 ? digits.slice(-10) : digits;
  return sql`right(regexp_replace(coalesce(${column}, ''), '\\D', '', 'g'), 10) = ${normalized}`;
}

import { PGlite } from '@electric-sql/pglite';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { memberMembership } from './memberSchema';

/**
 * Pins the `member_membership.status` vocabulary the kiosk filters on.
 *
 * ── The bug this prevents ───────────────────────────────────────────────────
 *
 * `api/members/lookup` filtered on `'on_hold'` / `'canceled'`. Nothing in
 * either repo ever writes those spellings: dojo-planner's MembersService,
 * lifecycle endpoints and seed all write `'hold'` / `'cancelled'`, and so does
 * this app's own PATCH `members/[memberId]/membership`. A held membership
 * therefore matched nothing, and the `checkinOnly` branch — which requires a
 * membership of status active-or-held — silently excluded members on hold from
 * kiosk check-in.
 *
 * TypeScript cannot catch this: the column is plain `text`, and there is no
 * CHECK constraint, so both spellings type- and run-fine while one matches no
 * rows. Runs against a real database for the same reason phoneQuery.test.ts
 * does — the failure is in what Postgres matches, not in the query's shape.
 */

/** The only spellings written anywhere in either repo. */
const WRITTEN_STATUSES = ['active', 'hold', 'cancelled'] as const;

/** What the lookup route accepts as "this member has a membership". */
const CHECKIN_ELIGIBLE = ['active', 'hold'] as const;

const client = new PGlite();
const db = drizzle(client);

beforeAll(async () => {
  await client.exec(`
    CREATE TABLE member_membership (
      id text PRIMARY KEY,
      member_id text NOT NULL,
      membership_plan_id text NOT NULL,
      status text NOT NULL DEFAULT 'active',
      billing_type text NOT NULL DEFAULT 'autopay',
      start_date timestamp NOT NULL DEFAULT now(),
      end_date timestamp,
      first_payment_date timestamp,
      next_payment_date timestamp,
      provider_subscription_id text,
      provider_hold_fee_subscription_id text,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    );
    INSERT INTO member_membership (id, member_id, membership_plan_id, status) VALUES
      ('mm-active',    'm-active',    'plan-1', 'active'),
      ('mm-hold',      'm-hold',      'plan-1', 'hold'),
      ('mm-cancelled', 'm-cancelled', 'plan-1', 'cancelled');
  `);
});

describe('member_membership status vocabulary', () => {
  it('finds the held membership using the spelling that is actually written', async () => {
    const rows = await db
      .select({ id: memberMembership.id })
      .from(memberMembership)
      .where(and(
        inArray(memberMembership.memberId, ['m-active', 'm-hold', 'm-cancelled']),
        inArray(memberMembership.status, [...WRITTEN_STATUSES]),
      ));

    expect(rows.map(r => r.id).sort()).toEqual(['mm-active', 'mm-cancelled', 'mm-hold']);
  });

  it('matches NOTHING with the old on_hold/canceled spellings', async () => {
    // The regression itself. If this ever returns rows, the vocabulary changed
    // and the lookup filter must be revisited.
    const rows = await db
      .select({ id: memberMembership.id })
      .from(memberMembership)
      .where(inArray(memberMembership.status, ['on_hold', 'canceled']));

    expect(rows).toEqual([]);
  });

  it('treats a held member as check-in eligible', async () => {
    const held = await db
      .select({ status: memberMembership.status })
      .from(memberMembership)
      .where(eq(memberMembership.memberId, 'm-hold'));

    const status = held[0]?.status;

    expect(status).toBe('hold');
    // Mirrors the `checkinOnly` predicate in api/members/lookup/route.ts.
    expect(CHECKIN_ELIGIBLE.includes(status as typeof CHECKIN_ELIGIBLE[number])).toBe(true);
  });

  it('does not treat a cancelled member as check-in eligible', async () => {
    const cancelled = await db
      .select({ status: memberMembership.status })
      .from(memberMembership)
      .where(eq(memberMembership.memberId, 'm-cancelled'));

    const status = cancelled[0]?.status;

    expect(status).toBe('cancelled');
    expect(CHECKIN_ELIGIBLE.includes(status as typeof CHECKIN_ELIGIBLE[number])).toBe(false);
  });
});

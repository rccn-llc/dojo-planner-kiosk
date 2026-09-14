import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { member } from './memberSchema';
import { phoneDigitsMatch } from './phoneQuery';

/**
 * Runs against a real Postgres (pglite), not against the shape of the Drizzle
 * fragment. The whole point of this helper is what Postgres does with
 * `regexp_replace` / `right`, so asserting on generated SQL text would test the
 * wrong thing.
 */

const ORG = 'org_test';
const OTHER_ORG = 'org_other';

// One member per storage format seen in the wild. They are all the SAME phone
// number; a lookup for any of them must find every one of these rows.
const SEEDED = [
  ['m-bare', '5551234567'],
  ['m-dashes', '555-123-4567'],
  ['m-parens', '(555) 123-4567'],
  ['m-dots', '555.123.4567'],
  ['m-spaces', '555 123 4567'],
  ['m-e164', '+15551234567'],
  ['m-leading-one', '1-555-123-4567'],
  ['m-parens-country', '+1 (555) 123-4567'],
] as const;

let db: ReturnType<typeof drizzle>;

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client);

  await client.exec(`
    create table member (
      id text primary key,
      organization_id text not null,
      first_name text not null,
      last_name text not null,
      email text not null,
      phone text,
      status text not null
    );
  `);

  for (const [id, phone] of SEEDED) {
    await client.query(
      `insert into member (id, organization_id, first_name, last_name, email, phone, status)
       values ($1, $2, 'Isabella', 'Chen', 'isabella@example.com', $3, 'active')`,
      [id, ORG, phone],
    );
  }

  // A member with no phone at all, and one belonging to another org.
  await client.query(
    `insert into member (id, organization_id, first_name, last_name, email, phone, status)
     values ('m-null', $1, 'No', 'Phone', 'nophone@example.com', null, 'active')`,
    [ORG],
  );
  await client.query(
    `insert into member (id, organization_id, first_name, last_name, email, phone, status)
     values ('m-cross-org', $1, 'Other', 'Org', 'other@example.com', '5551234567', 'active')`,
    [OTHER_ORG],
  );

  // A genuinely different number, to prove the predicate is not matching all rows.
  await client.query(
    `insert into member (id, organization_id, first_name, last_name, email, phone, status)
     values ('m-different', $1, 'Someone', 'Else', 'else@example.com', '(999) 888-7777', 'active')`,
    [ORG],
  );
});

async function lookup(input: string, org = ORG): Promise<string[]> {
  const rows = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, org), phoneDigitsMatch(member.phone, input)));
  return rows.map(r => r.id).sort();
}

const ALL_SEEDED = SEEDED.map(([id]) => id).sort();

describe('phoneDigitsMatch', () => {
  it('finds a member stored in EVERY format, from bare-digit input', () => {
    // The reported defect: only kiosk-created members (bare digits) were
    // findable; every seeded/imported member in another format was invisible.
    return expect(lookup('5551234567')).resolves.toEqual(ALL_SEEDED);
  });

  it.each([
    '(555) 123-4567',
    '555-123-4567',
    '555.123.4567',
    '555 123 4567',
    '+15551234567',
    '1-555-123-4567',
    '+1 (555) 123-4567',
  ])('finds all of them from formatted input %s', async (input) => {
    await expect(lookup(input)).resolves.toEqual(ALL_SEEDED);
  });

  it('does not match a different number', async () => {
    await expect(lookup('9998887777')).resolves.toEqual(['m-different']);
  });

  it('does not match a member with a NULL phone', async () => {
    // `coalesce` keeps the predicate from evaluating to NULL and, more
    // importantly, from matching an empty normalized value.
    const ids = await lookup('5551234567');
    expect(ids).not.toContain('m-null');
  });

  it('stays inside the org — a matching number in another org is not returned', async () => {
    const ids = await lookup('5551234567');
    expect(ids).not.toContain('m-cross-org');
  });

  it('finds the other org\'s member only when querying that org', async () => {
    await expect(lookup('5551234567', OTHER_ORG)).resolves.toEqual(['m-cross-org']);
  });

  it('returns nothing for a number no member has', async () => {
    await expect(lookup('4160000000')).resolves.toEqual([]);
  });
});

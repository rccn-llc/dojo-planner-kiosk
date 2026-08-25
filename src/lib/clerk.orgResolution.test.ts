import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@clerk/nextjs/server', () => ({
  createClerkClient: () => ({ organizations: { getOrganizationList: async () => ({ data: [] }) } }),
}));

async function load() {
  vi.resetModules();
  return import('./clerk');
}

describe('resolveOrgIdFromRequestOrBody', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('reads the org from the query string', async () => {
    const { resolveOrgIdFromRequestOrBody } = await load();
    const req = new Request('http://x/api?org=org_abc', { method: 'POST' });

    await expect(resolveOrgIdFromRequestOrBody(req, null)).resolves.toBe('org_abc');
  });

  it('falls back to an orgSlug carried in the body', async () => {
    // The member-portal OTP callers are POSTs that send the org in the BODY;
    // the kiosk flow sends it in the QUERY. Both must work, or one surface
    // silently breaks — which is exactly how staff override started returning
    // "invalid code" for a correct code.
    const { resolveOrgIdFromRequestOrBody } = await load();
    const req = new Request('http://x/api', { method: 'POST' });

    await expect(resolveOrgIdFromRequestOrBody(req, { orgSlug: 'org_abc' })).resolves.toBe('org_abc');
  });

  it('treats a raw org id identically in body and query', async () => {
    // The two resolvers diverging meant a request worked via ?org= but not via
    // the body, for the same value.
    const { resolveOrgIdFromRequestOrBody } = await load();
    const viaQuery = await resolveOrgIdFromRequestOrBody(
      new Request('http://x/api?org=org_abc', { method: 'POST' }),
      null,
    );
    const viaBody = await resolveOrgIdFromRequestOrBody(
      new Request('http://x/api', { method: 'POST' }),
      { orgSlug: 'org_abc' },
    );

    expect(viaBody).toBe(viaQuery);
  });

  it('rEFUSES a raw org id in production, from either source', async () => {
    // The raw-id path is a dev convenience: accepting it in production would
    // let a caller name any organization without proving access to its slug.
    vi.stubEnv('NODE_ENV', 'production');
    const { resolveOrgIdFromRequestOrBody } = await load();

    await expect(resolveOrgIdFromRequestOrBody(
      new Request('http://x/api?org=org_abc', { method: 'POST' }),
      null,
    )).resolves.toBeNull();
    await expect(resolveOrgIdFromRequestOrBody(
      new Request('http://x/api', { method: 'POST' }),
      { orgSlug: 'org_abc' },
    )).resolves.toBeNull();
  });

  it('returns null when neither source carries an org', async () => {
    const { resolveOrgIdFromRequestOrBody } = await load();

    await expect(resolveOrgIdFromRequestOrBody(
      new Request('http://x/api', { method: 'POST' }),
      {},
    )).resolves.toBeNull();
  });

  it('cannot be used to widen access: the value only narrows a lookup', async () => {
    // Static analysis flags the OTP routes' `if (!orgId)` as a user-controlled
    // security guard. It IS user-controlled, but the value reaches the database
    // only as an extra AND-predicate (`WHERE id = ? AND organization_id = ?`).
    // Naming another organization therefore matches nothing rather than
    // granting anything, and every downstream decision — the session's org, the
    // staff-eligibility check — reads the DB row, not this value.
    //
    // What this test pins is the one way it could widen: accepting a raw org id
    // in production, which would let a caller name any organization without
    // knowing its slug.
    vi.stubEnv('NODE_ENV', 'production');
    const { resolveOrgIdFromRequestOrBody } = await load();

    const attempts = [
      await resolveOrgIdFromRequestOrBody(new Request('http://x/api?org=org_victim', { method: 'POST' }), null),
      await resolveOrgIdFromRequestOrBody(new Request('http://x/api', { method: 'POST' }), { orgSlug: 'org_victim' }),
    ];

    expect(attempts).toEqual([null, null]);
  });
});

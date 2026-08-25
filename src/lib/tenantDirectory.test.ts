import { beforeEach, describe, expect, it, vi } from 'vitest';

const poolQuery = vi.fn();
vi.mock('pg', () => ({
  Pool: class {
    query(...args: unknown[]) {
      return poolQuery(...args);
    }

    on() {}
  },
}));

vi.mock('postgres', () => ({
  default: () => ({ end: async () => {} }),
}));
vi.mock('drizzle-orm/postgres-js', () => ({
  drizzle: (client: unknown) => ({ __client: client }),
}));

const KEY = 'a'.repeat(64);

async function load() {
  vi.resetModules();
  return import('./tenantDirectory');
}

describe('kiosk tenant directory', () => {
  beforeEach(() => {
    poolQuery.mockReset();
    vi.unstubAllEnvs();
    for (const k of ['DEFAULT_TENANT_DATABASE_URL', 'TENANCY_MODE', 'CONTROL_PLANE_ENCRYPTION_KEY']) {
      delete process.env[k];
    }
    process.env.DATABASE_URL = 'postgres://shared';
  });

  describe('the local escape hatch', () => {
    it('short-circuits to DEFAULT_TENANT_DATABASE_URL without consulting the directory', async () => {
      // Without this, adding the directory would make local kiosk dev require a
      // control plane, an encryption key, and a tenant row — infrastructure it
      // has never needed.
      process.env.DEFAULT_TENANT_DATABASE_URL = 'postgres://local';
      const mod = await load();

      await mod.getDatabaseForOrg('org_a');

      expect(poolQuery).not.toHaveBeenCalled();
    });

    it('rEFUSES the hatch in production', async () => {
      // Load-bearing: without this a misconfigured production deploy routes
      // every organization to one database.
      vi.stubEnv('NODE_ENV', 'production');
      process.env.DEFAULT_TENANT_DATABASE_URL = 'postgres://should-be-ignored';
      process.env.TENANCY_MODE = 'split';
      poolQuery.mockResolvedValue({ rows: [] });
      const mod = await load();

      await expect(mod.getDatabaseForOrg('org_a')).rejects.toThrow(mod.TenantUnavailableError);
      expect(poolQuery).toHaveBeenCalled();
    });
  });

  describe('refusal', () => {
    it('rEFUSES an org whose tenant row is migrating', async () => {
      // The cutover window. Serving here would write check-ins into a database
      // that is about to be superseded — silent divergence.
      process.env.TENANCY_MODE = 'split';
      process.env.CONTROL_PLANE_ENCRYPTION_KEY = KEY;
      poolQuery.mockResolvedValue({
        rows: [{ connection_string_enc: 'x', region: 'aws-us-east-1', status: 'migrating' }],
      });
      const mod = await load();

      await expect(mod.getDatabaseForOrg('org_a')).rejects.toThrow(/migrating/);
    });

    it('rEFUSES a row still pointing at the shared database in split mode', async () => {
      process.env.TENANCY_MODE = 'split';
      process.env.CONTROL_PLANE_ENCRYPTION_KEY = KEY;
      poolQuery.mockResolvedValue({
        rows: [{ connection_string_enc: 'x', region: 'shared', status: 'active' }],
      });
      const mod = await load();

      await expect(mod.getDatabaseForOrg('org_a')).rejects.toThrow(/shared database/);
    });

    it('rEFUSES an unregistered org in split mode', async () => {
      process.env.TENANCY_MODE = 'split';
      poolQuery.mockResolvedValue({ rows: [] });
      const mod = await load();

      await expect(mod.getDatabaseForOrg('org_a')).rejects.toThrow(/no tenant row/);
    });
  });

  describe('shared mode', () => {
    it('does NOT open a control pool — pglite allows only ONE connection', async () => {
      // The regression: consulting the directory in shared mode opened a
      // control pool (pg) alongside the tenant connection (postgres-js). Against
      // pglite-server, which accepts exactly one connection, the second is
      // refused and the tenant query dies with `read ECONNRESET`. Local dev sets
      // only DATABASE_URL, so this is the DEFAULT local path, not an edge case.
      poolQuery.mockRejectedValue(new Error('should not be called'));
      const mod = await load();

      await expect(mod.getDatabaseForOrg('org_a')).resolves.toBeTruthy();
      expect(poolQuery).not.toHaveBeenCalled();
    });

    it('serves an unregistered org from DATABASE_URL', async () => {
      // Every org lives in the one database the kiosk already holds, so a
      // missing tenant row is normal rather than an error.
      poolQuery.mockResolvedValue({ rows: [] });
      const mod = await load();

      await expect(mod.getDatabaseForOrg('org_a')).resolves.toBeTruthy();
    });
  });
});

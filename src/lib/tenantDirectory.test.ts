import { Buffer } from 'node:buffer';
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

/**
 * Build a ciphertext the kiosk can decrypt.
 *
 * The kiosk deliberately has no encrypt helper — the planner owns every write
 * to `tenant` — so the test constructs the same
 * base64(iv || authTag || ciphertext) envelope by hand.
 */
async function encryptFor(plaintext: string): Promise<string> {
  const { createCipheriv, randomBytes } = await import('node:crypto');
  const key = Buffer.from(KEY, 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}

describe('kiosk tenant directory', () => {
  beforeEach(() => {
    poolQuery.mockReset();
    vi.unstubAllEnvs();
    for (const k of ['DEFAULT_TENANT_DATABASE_URL', 'CONTROL_DATABASE_URL', 'CONTROL_PLANE_ENCRYPTION_KEY']) {
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
      process.env.CONTROL_DATABASE_URL = 'postgres://control';
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
      process.env.CONTROL_DATABASE_URL = 'postgres://control';
      process.env.CONTROL_PLANE_ENCRYPTION_KEY = KEY;
      poolQuery.mockResolvedValue({
        rows: [{ connection_string_enc: 'x', region: 'aws-us-east-1', status: 'migrating' }],
      });
      const mod = await load();

      await expect(mod.getDatabaseForOrg('org_a')).rejects.toThrow(/migrating/);
    });

    it('sERVES a row still pointing at the shared database — it is simply not cut over', async () => {
      // This is the A5 inversion. Refusing here is what forced an
      // all-or-nothing flip: with a global mode flag, moving ONE org made every
      // other org unservable. A row naming the shared database has not been
      // cut over yet, so it is served from there.
      process.env.CONTROL_DATABASE_URL = 'postgres://control';
      process.env.CONTROL_PLANE_ENCRYPTION_KEY = KEY;
      poolQuery.mockResolvedValue({
        rows: [{ connection_string_enc: '__shared_database__', region: 'shared', status: 'active' }],
      });
      const mod = await load();

      await expect(mod.getDatabaseForOrg('org_a')).resolves.toBeTruthy();
    });

    it('rEFUSES an unregistered org once a control plane exists', async () => {
      process.env.CONTROL_DATABASE_URL = 'postgres://control';
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

  describe('the per-org split signal', () => {
    it('treats a row ENCRYPTED FROM DATABASE_URL as not cut over, whatever its region says', async () => {
      // The A2 leak, in the kiosk. `registerTenants` writes
      // region 'aws-us-east-1', which is NOT the shared label — so a
      // region-only check would accept this row and "route" the org to a
      // per-tenant database that is actually the shared one. The predicate
      // must be the decrypted string.
      process.env.CONTROL_DATABASE_URL = 'postgres://control';
      process.env.CONTROL_PLANE_ENCRYPTION_KEY = KEY;

      const encrypted = await encryptFor('postgres://shared');

      poolQuery.mockResolvedValue({
        rows: [{ connection_string_enc: encrypted, region: 'aws-us-east-1', status: 'active' }],
      });
      const mod = await load();

      await expect(mod.getDatabaseForOrg('org_a')).resolves.toBeTruthy();
    });

    it('serves a CUT-OVER org from its own database', async () => {
      process.env.CONTROL_DATABASE_URL = 'postgres://control';
      process.env.CONTROL_PLANE_ENCRYPTION_KEY = KEY;

      const encrypted = await encryptFor('postgres://tenant-a');

      poolQuery.mockResolvedValue({
        rows: [{ connection_string_enc: encrypted, region: 'aws-us-east-1', status: 'active' }],
      });
      const mod = await load();

      const db = await mod.getDatabaseForOrg('org_a') as unknown as { __client: unknown };

      expect(db).toBeTruthy();
    });
  });

  describe('connectionHost', () => {
    it('logs the host and NEVER the credentials', async () => {
      const mod = await load();

      const host = mod.connectionHost('postgres://user:npg_secret_not_real@ep-x-pooler.aws.neon.tech/db');

      expect(host).toBe('ep-x-pooler.aws.neon.tech');
      expect(host).not.toContain('npg_secret_not_real');
    });
  });
});

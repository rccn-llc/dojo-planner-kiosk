import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptSecret } from './crypto';

const TEST_KEY_HEX = randomBytes(32).toString('hex');

interface Row {
  clientId: string | null;
  clientSecretEnc: string | null;
  gatewayId: string | null;
  locationTaxRate: number | null;
}

let nextRow: Row | null = null;
const withRetryCalls: number[] = [];

vi.mock('@/lib/database', () => ({
  withRetry: vi.fn(async (fn: (db: unknown) => Promise<unknown>) => {
    withRetryCalls.push(Date.now());
    const fakeDb = {
      select: () => fakeDb,
      from: () => fakeDb,
      where: () => fakeDb,
      limit: async () => (nextRow ? [nextRow] : []),
    };
    return fn(fakeDb);
  }),
}));

async function importFresh() {
  vi.resetModules();
  return import('./iqproConfig');
}

const IQPRO_ENV_KEYS = [
  'IQPRO_CLIENT_ID',
  'IQPRO_CLIENT_SECRET',
  'IQPRO_GATEWAY_ID',
  'IQPRO_SCOPE',
  'IQPRO_OAUTH_URL',
  'IQPRO_BASE_URL',
  'IQPRO_CONFIG_ENCRYPTION_KEY',
] as const;

const savedEnv: Partial<Record<(typeof IQPRO_ENV_KEYS)[number], string | undefined>> = {};

function setEnv(env: Partial<Record<(typeof IQPRO_ENV_KEYS)[number], string>>) {
  for (const k of IQPRO_ENV_KEYS) {
    delete process.env[k];
  }
  for (const [k, v] of Object.entries(env)) {
    process.env[k] = v;
  }
}

beforeEach(() => {
  for (const k of IQPRO_ENV_KEYS) {
    savedEnv[k] = process.env[k];
  }
  nextRow = null;
  withRetryCalls.length = 0;
});

afterEach(() => {
  for (const k of IQPRO_ENV_KEYS) {
    if (savedEnv[k] === undefined) {
      delete process.env[k];
    }
    else {
      process.env[k] = savedEnv[k];
    }
  }
});

describe('resolveIQProConfig', () => {
  it('returns env-only config when DB row is empty', async () => {
    setEnv({
      IQPRO_CLIENT_ID: 'env-client',
      IQPRO_CLIENT_SECRET: 'env-secret',
      IQPRO_GATEWAY_ID: 'env-gw',
      IQPRO_SCOPE: 'env-scope',
      IQPRO_OAUTH_URL: 'https://oauth',
      IQPRO_BASE_URL: 'https://base',
      IQPRO_CONFIG_ENCRYPTION_KEY: TEST_KEY_HEX,
    });
    nextRow = null;
    const mod = await importFresh();
    const cfg = await mod.resolveIQProConfig('org_a');
    expect(cfg).not.toBeNull();
    expect(cfg!.clientId).toBe('env-client');
    expect(cfg!.gatewayId).toBe('env-gw');
    expect(cfg!.source).toBe('env');
  });

  it('returns org config when all three DB fields are present', async () => {
    setEnv({
      IQPRO_SCOPE: 'env-scope',
      IQPRO_OAUTH_URL: 'https://oauth',
      IQPRO_BASE_URL: 'https://base',
      IQPRO_CONFIG_ENCRYPTION_KEY: TEST_KEY_HEX,
    });
    nextRow = {
      clientId: 'db-client',
      clientSecretEnc: encryptSecret('db-secret'),
      gatewayId: 'db-gw',
      locationTaxRate: 8.5,
    };
    const mod = await importFresh();
    const cfg = await mod.resolveIQProConfig('org_b');
    expect(cfg).not.toBeNull();
    expect(cfg!.clientId).toBe('db-client');
    expect(cfg!.clientSecret).toBe('db-secret');
    expect(cfg!.gatewayId).toBe('db-gw');
    expect(cfg!.source).toBe('org');
  });

  it('returns mixed source when only some DB fields are populated', async () => {
    setEnv({
      IQPRO_CLIENT_ID: 'env-client',
      IQPRO_CLIENT_SECRET: 'env-secret',
      IQPRO_SCOPE: 'env-scope',
      IQPRO_OAUTH_URL: 'https://oauth',
      IQPRO_BASE_URL: 'https://base',
      IQPRO_CONFIG_ENCRYPTION_KEY: TEST_KEY_HEX,
    });
    nextRow = {
      clientId: null,
      clientSecretEnc: null,
      gatewayId: 'db-gw',
      locationTaxRate: 0,
    };
    const mod = await importFresh();
    const cfg = await mod.resolveIQProConfig('org_c');
    expect(cfg).not.toBeNull();
    expect(cfg!.clientId).toBe('env-client');
    expect(cfg!.gatewayId).toBe('db-gw');
    expect(cfg!.source).toBe('mixed');
  });

  it('returns null when a required field is missing in both DB and env', async () => {
    setEnv({
      IQPRO_SCOPE: 'env-scope',
      IQPRO_OAUTH_URL: 'https://oauth',
      IQPRO_BASE_URL: 'https://base',
    });
    nextRow = null;
    const mod = await importFresh();
    expect(await mod.resolveIQProConfig('org_d')).toBeNull();
  });

  it('caches per-org for 60s and dedupes DB reads', async () => {
    setEnv({
      IQPRO_SCOPE: 'env-scope',
      IQPRO_OAUTH_URL: 'https://oauth',
      IQPRO_BASE_URL: 'https://base',
      IQPRO_CONFIG_ENCRYPTION_KEY: TEST_KEY_HEX,
    });
    nextRow = {
      clientId: 'db-client',
      clientSecretEnc: encryptSecret('db-secret'),
      gatewayId: 'db-gw',
      locationTaxRate: 3,
    };
    const mod = await importFresh();
    await mod.resolveIQProConfig('org_e');
    await mod.resolveIQProConfig('org_e');
    await mod.resolveIQProConfig('org_e');
    expect(withRetryCalls.length).toBe(1);
  });

  it('resetIQProConfigCache forces a fresh DB read', async () => {
    setEnv({
      IQPRO_SCOPE: 'env-scope',
      IQPRO_OAUTH_URL: 'https://oauth',
      IQPRO_BASE_URL: 'https://base',
      IQPRO_CONFIG_ENCRYPTION_KEY: TEST_KEY_HEX,
    });
    nextRow = {
      clientId: 'db-client',
      clientSecretEnc: encryptSecret('db-secret'),
      gatewayId: 'db-gw',
      locationTaxRate: 0,
    };
    const mod = await importFresh();
    await mod.resolveIQProConfig('org_f');
    mod.resetIQProConfigCache();
    await mod.resolveIQProConfig('org_f');
    expect(withRetryCalls.length).toBe(2);
  });

  it('isolates cache entries per orgId', async () => {
    setEnv({
      IQPRO_SCOPE: 'env-scope',
      IQPRO_OAUTH_URL: 'https://oauth',
      IQPRO_BASE_URL: 'https://base',
      IQPRO_CONFIG_ENCRYPTION_KEY: TEST_KEY_HEX,
    });
    const mod = await importFresh();
    nextRow = {
      clientId: 'orgA-client',
      clientSecretEnc: encryptSecret('orgA-secret'),
      gatewayId: 'orgA-gw',
      locationTaxRate: 5,
    };
    const a = await mod.resolveIQProConfig('orgA');
    nextRow = {
      clientId: 'orgB-client',
      clientSecretEnc: encryptSecret('orgB-secret'),
      gatewayId: 'orgB-gw',
      locationTaxRate: 0,
    };
    const b = await mod.resolveIQProConfig('orgB');
    expect(a!.clientId).toBe('orgA-client');
    expect(b!.clientId).toBe('orgB-client');
  });
});

describe('getOrganizationTaxRate', () => {
  it('returns the location_tax_rate value from the org row', async () => {
    setEnv({
      IQPRO_CLIENT_ID: 'env-client',
      IQPRO_CLIENT_SECRET: 'env-secret',
      IQPRO_GATEWAY_ID: 'env-gw',
      IQPRO_SCOPE: 'env-scope',
      IQPRO_OAUTH_URL: 'https://oauth',
      IQPRO_BASE_URL: 'https://base',
      IQPRO_CONFIG_ENCRYPTION_KEY: TEST_KEY_HEX,
    });
    nextRow = {
      clientId: null,
      clientSecretEnc: null,
      gatewayId: null,
      locationTaxRate: 8.5,
    };
    const mod = await importFresh();
    expect(await mod.getOrganizationTaxRate('org_g')).toBe(8.5);
  });

  it('returns 0 when the column is null', async () => {
    setEnv({
      IQPRO_CLIENT_ID: 'env-client',
      IQPRO_CLIENT_SECRET: 'env-secret',
      IQPRO_GATEWAY_ID: 'env-gw',
      IQPRO_SCOPE: 'env-scope',
      IQPRO_OAUTH_URL: 'https://oauth',
      IQPRO_BASE_URL: 'https://base',
      IQPRO_CONFIG_ENCRYPTION_KEY: TEST_KEY_HEX,
    });
    nextRow = {
      clientId: null,
      clientSecretEnc: null,
      gatewayId: null,
      locationTaxRate: null,
    };
    const mod = await importFresh();
    expect(await mod.getOrganizationTaxRate('org_h')).toBe(0);
  });

  it('shares the cache with resolveIQProConfig', async () => {
    setEnv({
      IQPRO_SCOPE: 'env-scope',
      IQPRO_OAUTH_URL: 'https://oauth',
      IQPRO_BASE_URL: 'https://base',
      IQPRO_CONFIG_ENCRYPTION_KEY: TEST_KEY_HEX,
    });
    nextRow = {
      clientId: 'db-client',
      clientSecretEnc: encryptSecret('db-secret'),
      gatewayId: 'db-gw',
      locationTaxRate: 4.25,
    };
    const mod = await importFresh();
    await mod.resolveIQProConfig('org_i');
    expect(await mod.getOrganizationTaxRate('org_i')).toBe(4.25);
    expect(withRetryCalls.length).toBe(1);
  });
});

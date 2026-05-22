import { eq } from 'drizzle-orm';
import { pgTable, real, text } from 'drizzle-orm/pg-core';
import { decryptSecret } from '@/lib/crypto';
import { withRetry } from '@/lib/database';

const organizationConfig = pgTable('organization', {
  id: text('id').primaryKey(),
  iqproConfigClientId: text('iqpro_config_client_id'),
  iqproConfigClientSecretEncrypted: text('iqpro_config_client_secret_enc'),
  iqproConfigGatewayId: text('iqpro_config_gateway_id'),
  locationTaxRate: real('location_tax_rate'),
});

export interface IQProConfig {
  clientId: string;
  clientSecret: string;
  gatewayId: string;
  scope: string;
  oauthUrl: string;
  baseUrl: string;
  source: 'org' | 'env' | 'mixed';
}

interface CacheEntry {
  config: IQProConfig | null;
  taxRate: number;
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 200;

const perOrgCache = new Map<string, CacheEntry>();

function cacheGet(orgId: string): CacheEntry | null {
  const entry = perOrgCache.get(orgId);
  if (!entry) {
    return null;
  }
  if (Date.now() > entry.expiresAt) {
    perOrgCache.delete(orgId);
    return null;
  }
  return entry;
}

function cacheSet(orgId: string, entry: Omit<CacheEntry, 'expiresAt'>): void {
  if (perOrgCache.size >= CACHE_MAX) {
    const firstKey = perOrgCache.keys().next().value;
    if (firstKey !== undefined) {
      perOrgCache.delete(firstKey);
    }
  }
  perOrgCache.set(orgId, { ...entry, expiresAt: Date.now() + CACHE_TTL_MS });
}

export function resetIQProConfigCache(): void {
  perOrgCache.clear();
}

function decryptOrNull(enc: string | null | undefined): string | null {
  if (!enc) {
    return null;
  }
  try {
    return decryptSecret(enc);
  }
  catch (err) {
    console.error('[iqproConfig] failed to decrypt client secret:', err instanceof Error ? err.message : 'unknown');
    throw new Error('Failed to decrypt stored IQPro client secret');
  }
}

function buildConfig(
  src: { clientId: string | null; clientSecret: string | null; gatewayId: string | null },
  dbHasAnyField: boolean,
): IQProConfig | null {
  const clientId = src.clientId ?? process.env.IQPRO_CLIENT_ID ?? null;
  const clientSecret = src.clientSecret ?? process.env.IQPRO_CLIENT_SECRET ?? null;
  const gatewayId = src.gatewayId ?? process.env.IQPRO_GATEWAY_ID ?? null;
  const scope = process.env.IQPRO_SCOPE ?? null;
  const oauthUrl = process.env.IQPRO_OAUTH_URL ?? null;
  const baseUrl = process.env.IQPRO_BASE_URL ?? null;

  if (!clientId || !clientSecret || !gatewayId || !scope || !oauthUrl || !baseUrl) {
    return null;
  }

  const dbCount = [src.clientId, src.clientSecret, src.gatewayId].filter(v => v != null).length;
  let source: IQProConfig['source'];
  if (!dbHasAnyField || dbCount === 0) {
    source = 'env';
  }
  else if (dbCount === 3) {
    source = 'org';
  }
  else {
    source = 'mixed';
  }

  return { clientId, clientSecret, gatewayId, scope, oauthUrl, baseUrl, source };
}

async function loadFromDb(orgId: string): Promise<{ config: IQProConfig | null; taxRate: number }> {
  const rows = await withRetry(db =>
    db
      .select({
        clientId: organizationConfig.iqproConfigClientId,
        clientSecretEnc: organizationConfig.iqproConfigClientSecretEncrypted,
        gatewayId: organizationConfig.iqproConfigGatewayId,
        locationTaxRate: organizationConfig.locationTaxRate,
      })
      .from(organizationConfig)
      .where(eq(organizationConfig.id, orgId))
      .limit(1),
  );
  const row = rows[0];

  const dbClientId = row?.clientId ?? null;
  const dbSecret = decryptOrNull(row?.clientSecretEnc);
  const dbGatewayId = row?.gatewayId ?? null;
  const dbHasAnyField = Boolean(dbClientId || dbSecret || dbGatewayId);
  const taxRate = row?.locationTaxRate ?? 0;

  const config = buildConfig({ clientId: dbClientId, clientSecret: dbSecret, gatewayId: dbGatewayId }, dbHasAnyField);

  if (config && config.source === 'env') {
    console.warn(`[iqproConfig] org ${orgId} resolved to env-fallback credentials — populate Payment Settings in the main app to use this org's merchant.`);
  }

  return { config, taxRate };
}

export async function resolveIQProConfig(orgId: string): Promise<IQProConfig | null> {
  const cached = cacheGet(orgId);
  if (cached) {
    return cached.config;
  }
  const loaded = await loadFromDb(orgId);
  cacheSet(orgId, loaded);
  return loaded.config;
}

export async function getOrganizationTaxRate(orgId: string): Promise<number> {
  const cached = cacheGet(orgId);
  if (cached) {
    return cached.taxRate;
  }
  const loaded = await loadFromDb(orgId);
  cacheSet(orgId, loaded);
  return loaded.taxRate;
}

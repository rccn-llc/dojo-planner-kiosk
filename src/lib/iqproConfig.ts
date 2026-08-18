import { eq } from 'drizzle-orm';
import { pgTable, real, text } from 'drizzle-orm/pg-core';
import { decryptSecret } from '@/lib/crypto';
import { withRetry } from '@/lib/database';

const organizationConfig = pgTable('organization', {
  id: text('id').primaryKey(),
  // dojo-planner B3 replaced the three iqpro_config_* columns with ONE
  // AES-256-GCM blob holding `{ provider, credentials }`. Same encryption key
  // (IQPRO_CONFIG_ENCRYPTION_KEY) and same scheme, so nothing else changes
  // here. See dojo-planner's PaymentProviderConfigService.
  paymentProvider: text('payment_provider'),
  paymentProviderConfigEncrypted: text('payment_provider_config_enc'),
  locationTaxRate: real('location_tax_rate'),
});

/**
 * Shape of the decrypted blob. Kept deliberately lenient about providers the
 * kiosk cannot yet transact on: an org switched to Square resolves to a null
 * config here, which the payment routes already treat as "not configured"
 * rather than charging through the wrong merchant. Square support in the
 * kiosk is phase B5k.
 */
interface StoredProviderConfig {
  provider: string;
  credentials: Record<string, string>;
}

/**
 * Decrypt + parse the credential blob. Fails closed on BOTH a bad decrypt and
 * a malformed payload — either means we cannot trust what merchant we would be
 * charging, so falling back to env credentials would be worse than erroring.
 */
function readConfigBlob(enc: string | null | undefined): StoredProviderConfig | null {
  const json = decryptRequired(enc);
  if (!json) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  }
  catch {
    throw new Error('Stored payment provider credentials are malformed');
  }
  const blob = parsed as StoredProviderConfig;
  if (!blob || typeof blob.provider !== 'string' || typeof blob.credentials !== 'object' || blob.credentials === null) {
    throw new Error('Stored payment provider credentials are malformed');
  }
  return blob;
}

// The service fee is a fixed platform rate — dojo-planner hard-codes it and does
// NOT store it per-org (there is no organization.service_fee_rate column). Keep
// it as a constant here to match. If per-org service fees ever become a real
// feature, dojo-planner must add the column + Payment Settings UI first; only
// then re-introduce a DB read here.
export const DEFAULT_SERVICE_FEE_PCT = 3.75;

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

// Returns null when there is no ciphertext to decrypt, but THROWS (fail closed)
// when a present ciphertext can't be decrypted — a corrupt/rotated secret must
// not silently fall through to env-fallback credentials for a payment path.
function decryptRequired(enc: string | null | undefined): string | null {
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
        paymentProvider: organizationConfig.paymentProvider,
        configEnc: organizationConfig.paymentProviderConfigEncrypted,
        locationTaxRate: organizationConfig.locationTaxRate,
      })
      .from(organizationConfig)
      .where(eq(organizationConfig.id, orgId))
      .limit(1),
  );
  const row = rows[0];
  const taxRate = row?.locationTaxRate ?? 0;

  // An org on a non-IQPro provider gets a null config: the kiosk has no Square
  // implementation yet (B5k), and silently using IQPro credentials would send
  // the money to the wrong merchant account.
  if (row?.paymentProvider && row.paymentProvider !== 'iqpro') {
    console.warn(`[iqproConfig] org ${orgId} uses payment provider "${row.paymentProvider}", which the kiosk cannot process yet.`);
    return { config: null, taxRate };
  }

  const blob = readConfigBlob(row?.configEnc);
  const stored = blob?.provider === 'iqpro' ? blob.credentials : null;

  const dbClientId = stored?.clientId ?? null;
  const dbSecret = stored?.clientSecret ?? null;
  const dbGatewayId = stored?.gatewayId ?? null;
  const dbHasAnyField = Boolean(stored);

  const config = buildConfig({ clientId: dbClientId, clientSecret: dbSecret, gatewayId: dbGatewayId }, dbHasAnyField);

  if (config && config.source === 'env') {
    console.warn(`[iqproConfig] org ${orgId} resolved to env-fallback credentials — populate Payment Settings in the main app to use this org's merchant.`);
  }

  return { config, taxRate };
}

// In-flight loads, so concurrent cold calls for the same org (e.g. resolve
// config + tax back-to-back on a cold cache) collapse to one DB round-trip.
const inFlight = new Map<string, Promise<{ config: IQProConfig | null; taxRate: number }>>();

async function getCached(orgId: string): Promise<CacheEntry> {
  const cached = cacheGet(orgId);
  if (cached) {
    return cached;
  }
  let load = inFlight.get(orgId);
  if (!load) {
    load = loadFromDb(orgId).finally(() => inFlight.delete(orgId));
    inFlight.set(orgId, load);
  }
  const loaded = await load;
  cacheSet(orgId, loaded);
  return { ...loaded, expiresAt: Date.now() + CACHE_TTL_MS };
}

export async function resolveIQProConfig(orgId: string): Promise<IQProConfig | null> {
  return (await getCached(orgId)).config;
}

export async function getOrganizationTaxRate(orgId: string): Promise<number> {
  return (await getCached(orgId)).taxRate;
}

// The service fee is a fixed platform rate (dojo-planner hard-codes it; there is
// no per-org column). Kept async so call sites don't change if per-org fees ever
// become a real DB-backed feature.
export async function getOrganizationServiceFeePct(): Promise<number> {
  return DEFAULT_SERVICE_FEE_PCT;
}

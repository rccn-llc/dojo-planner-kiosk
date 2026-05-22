/**
 * IQPro payment integration for the kiosk.
 * Mirrors src/libs/IQPro.ts from dojo-planner.
 *
 * This module is a pure HTTP wrapper — it imports no DB code and reads no
 * IQPro_* env vars. Every exported function takes a resolved `IQProConfig`
 * (see `src/lib/iqproConfig.ts`) as its first argument. Routes resolve the
 * config once at the boundary and thread it through.
 */

import type { IQProConfig } from '@/lib/iqproConfig';
import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TokenizationIframeConfig {
  origin: string;
  tokenizationId: string;
  tokenScheme: string;
  authenticationKey: string;
  timestamp: string;
  iframeScriptUrl: string;
}

type AchAccountType = 'Checking' | 'Savings';

interface TokenizeAchParams {
  accountNumber: string;
  routingNumber: string;
  secCode?: string;
  achAccountType?: AchAccountType;
}

interface TokenizeAchResult {
  achToken: string;
}

// ── Service-fee constant ──────────────────────────────────────────────────────

/**
 * Service fee percentage applied to EVERY transaction.
 *
 * TODO(per-org service fee): when the main app exposes an
 * `organization.service_fee_rate` column, replace this constant with a per-org
 * lookup mirroring the tax-rate pattern in `iqproConfig.ts`.
 */
const SERVICE_FEE_PCT = 3.75;

// ── OAuth token cache (keyed by clientId) ────────────────────────────────────

const OAUTH_CACHE_MAX = 100;
const oauthTokenCache = new Map<string, { token: string; expiresAt: number }>();

export function resetOAuthTokenCache(): void {
  oauthTokenCache.clear();
}

async function getOAuthToken(config: IQProConfig): Promise<string> {
  const cached = oauthTokenCache.get(config.clientId);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.token;
  }

  const res = await fetch(config.oauthUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: config.scope,
    }),
  });

  if (!res.ok) {
    throw new Error(`IQPro OAuth failed: ${res.status}`);
  }

  const data = await res.json() as { access_token: string; expires_in?: number };
  const expiresIn = data.expires_in ?? 3600;

  if (oauthTokenCache.size >= OAUTH_CACHE_MAX) {
    let oldestKey: string | null = null;
    let oldestExpiry = Infinity;
    for (const [k, v] of oauthTokenCache) {
      if (v.expiresAt < oldestExpiry) {
        oldestExpiry = v.expiresAt;
        oldestKey = k;
      }
    }
    if (oldestKey !== null) {
      oauthTokenCache.delete(oldestKey);
    }
  }

  const entry = {
    token: data.access_token,
    expiresAt: Date.now() + (expiresIn - 60) * 1000,
  };
  oauthTokenCache.set(config.clientId, entry);
  return entry.token;
}

// ── Tokenization config ───────────────────────────────────────────────────────

export async function getTokenizationConfig(config: IQProConfig, clientOrigin: string): Promise<TokenizationIframeConfig | null> {
  const token = await getOAuthToken(config);

  const res = await fetch(`${config.baseUrl}/api/v1/gateway/${config.gatewayId}/tokenization/configuration`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: clientOrigin,
    },
  });

  if (!res.ok) {
    throw new Error(`Tokenization config request failed: ${res.status}`);
  }

  const json = await res.json() as Record<string, unknown>;

  const data = json?.data as Record<string, unknown> | undefined;
  const iframeConfig
    = (data?.iframeConfiguration as Record<string, unknown> | undefined)?.iqProV2
      ?? (data?.mobileConfiguration as Record<string, unknown> | undefined)?.iqProV2;

  if (!iframeConfig) {
    throw new Error('Tokenization config missing iframe configuration');
  }

  const cfg = iframeConfig as Record<string, string | undefined>;
  const isSandbox = config.baseUrl.includes('sandbox');
  const iframeScriptUrl = isSandbox
    ? 'https://sandbox.api.basyspro.com/Iframe/iframe/iframe-v3.js'
    : 'https://api.basyspro.com/Iframe/iframe/iframe-v3.js';

  if (!cfg.origin || !cfg.tokenizationId || !cfg.tokenScheme || !cfg.authenticationKey || !cfg.timestamp) {
    throw new Error('Tokenization config missing required fields');
  }

  return {
    origin: cfg.origin,
    tokenizationId: cfg.tokenizationId,
    tokenScheme: cfg.tokenScheme,
    authenticationKey: cfg.authenticationKey,
    timestamp: cfg.timestamp,
    iframeScriptUrl,
  };
}

// ── Direct API helpers (no SDK needed) ────────────────────────────────────────

const isDev = process.env.NODE_ENV === 'development';

/** Strip CR/LF to prevent log-injection (CodeQL js/log-injection). */
function sanitizeForLog(value: unknown): string {
  return String(value).replace(/[\r\n]+/g, '');
}

function devLog(...args: unknown[]) {
  if (isDev) {
    console.warn(...args);
  }
}

/**
 * Make an authenticated POST request to the IQPro gateway API.
 */
export async function iqproPost<T = Record<string, unknown>>(
  config: IQProConfig,
  path: string,
  body: unknown,
): Promise<T> {
  const token = await getOAuthToken(config);

  devLog('[IQPro] POST', sanitizeForLog(path));
  devLog('[IQPro] POST request body:', sanitizeForLog(JSON.stringify(body, null, 2)));

  const res = await fetch(`${config.baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => '');
    console.error(`[IQPro] POST ${sanitizeForLog(path)} FAILED (${res.status}):`, sanitizeForLog(errorBody));
    throw new Error(`IQPro API ${path} failed: ${res.status} ${errorBody}`);
  }

  const text = await res.text();
  const json = text ? JSON.parse(text) as T : {} as T;
  devLog(`[IQPro] POST ${sanitizeForLog(path)} response (${res.status}):`, sanitizeForLog(text || '(empty body)'));
  return json;
}

/**
 * Make an authenticated GET request to the IQPro gateway API.
 */
export async function iqproGet<T = Record<string, unknown>>(
  config: IQProConfig,
  path: string,
): Promise<T> {
  const token = await getOAuthToken(config);

  devLog('[IQPro] GET', sanitizeForLog(path));

  const res = await fetch(`${config.baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => '');
    console.error(`[IQPro] GET ${sanitizeForLog(path)} FAILED (${res.status}):`, sanitizeForLog(errorBody));
    throw new Error(`IQPro API GET ${path} failed: ${res.status}`);
  }

  const text = await res.text();
  const json = text ? JSON.parse(text) as T : {} as T;
  devLog(`[IQPro] GET ${sanitizeForLog(path)} response (${res.status}):`, sanitizeForLog(text || '(empty body)'));
  return json;
}

/**
 * Make an authenticated PUT request to the IQPro gateway API.
 */
export async function iqproPut<T = Record<string, unknown>>(
  config: IQProConfig,
  path: string,
  body: unknown,
): Promise<T> {
  const token = await getOAuthToken(config);

  devLog('[IQPro] PUT', sanitizeForLog(path));
  devLog('[IQPro] PUT request body:', sanitizeForLog(JSON.stringify(body, null, 2)));

  const res = await fetch(`${config.baseUrl}${path}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => '');
    console.error(`[IQPro] PUT ${sanitizeForLog(path)} FAILED (${res.status}):`, sanitizeForLog(errorBody));
    throw new Error(`IQPro API PUT ${path} failed: ${res.status} ${errorBody}`);
  }

  const text = await res.text();
  const json = text ? JSON.parse(text) as T : {} as T;
  devLog(`[IQPro] PUT ${sanitizeForLog(path)} response (${res.status}):`, sanitizeForLog(text || '(empty body)'));
  return json;
}

// ── Gateway processors (cached by gatewayId) ─────────────────────────────────

interface GatewayProcessors {
  cardProcessorId: string | null;
  achProcessorId: string | null;
}

const processorsCache = new Map<string, GatewayProcessors>();

export function resetProcessorsCache(): void {
  processorsCache.clear();
}

export async function getGatewayProcessors(config: IQProConfig): Promise<GatewayProcessors> {
  const cached = processorsCache.get(config.gatewayId);
  if (cached) {
    return cached;
  }

  const token = await getOAuthToken(config);

  const res = await fetch(`${config.baseUrl}/api/gateway/${config.gatewayId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`Gateway config request failed: ${res.status}`);
  }

  const json = await res.json() as Record<string, unknown>;
  const data = json?.data as Record<string, unknown> | undefined;
  const processors = (data?.processors ?? []) as Array<{
    processorId: string;
    isDefaultCard: boolean;
    isDefaultAch: boolean;
  }>;

  const defaultCard = processors.find(p => p.isDefaultCard);
  const defaultAch = processors.find(p => p.isDefaultAch);

  const entry: GatewayProcessors = {
    cardProcessorId: defaultCard?.processorId ?? null,
    achProcessorId: defaultAch?.processorId ?? null,
  };
  processorsCache.set(config.gatewayId, entry);
  return entry;
}

// ── Fee calculation ───────────────────────────────────────────────────────────

function roundCents(n: number): number {
  return Math.round(n * 100) / 100;
}

interface ComputedFeeBreakdown {
  baseAmount: number; // subtotal - discount (amount fees are calculated on)
  taxAmount: number; // store only; 0 for memberships
  taxPct: number; // the rate that was applied (0 if non-taxable)
  serviceFeeAmount: number; // from IQPro /calculatefees (not computed locally)
  serviceFeePct: number; // the rate that was requested
  amount: number; // final total charged = base + tax + serviceFee
}

interface CalculateServiceFeeParams {
  baseAmount: number;
  processorId: string;
  token?: string;
  creditCardBin?: string;
}

/**
 * Call IQPro's POST /transaction/calculatefees to get the service fee amount
 * for a given base.
 */
async function fetchServiceFeeAmount(config: IQProConfig, params: CalculateServiceFeeParams): Promise<number> {
  const body: Record<string, unknown> = {
    baseAmount: params.baseAmount,
    addTaxToTotal: true,
    taxAmount: 0,
    processorId: params.processorId,
    transactionType: 'Sale',
    paymentAdjustments: [
      { type: 'ServiceFee', percentage: SERVICE_FEE_PCT, flatAmount: null },
    ],
  };
  if (params.token) {
    body.token = params.token;
  }
  else if (params.creditCardBin) {
    body.creditCardBin = params.creditCardBin;
  }

  const res = await iqproPost<{ data?: { serviceFeesAmount?: number } }>(
    config,
    `/api/gateway/${config.gatewayId}/transaction/calculatefees`,
    body,
  );
  const data = (res.data ?? res) as { serviceFeesAmount?: number };
  return roundCents(data.serviceFeesAmount ?? 0);
}

/**
 * Compute the full fee breakdown for a transaction.
 * - Tax is computed locally from `taxStatePct` (the per-org rate the caller
 *   resolved from `organization.location_tax_rate`); 0 for non-taxable charges.
 * - Service fee amount is computed by IQPro via /calculatefees, using the
 *   module-level `SERVICE_FEE_PCT`.
 */
export async function computeFeeBreakdown(
  config: IQProConfig,
  baseAmount: number,
  isTaxable: boolean,
  taxStatePct: number,
  serviceFeeLookup: Omit<CalculateServiceFeeParams, 'baseAmount'>,
): Promise<ComputedFeeBreakdown> {
  const base = roundCents(baseAmount);
  const taxPct = isTaxable ? taxStatePct : 0;
  const taxAmount = roundCents(base * (taxPct / 100));
  const serviceFeeAmount = await fetchServiceFeeAmount(config, { ...serviceFeeLookup, baseAmount: base });
  const amount = roundCents(base + taxAmount + serviceFeeAmount);
  return {
    baseAmount: base,
    taxAmount,
    taxPct,
    serviceFeeAmount,
    serviceFeePct: SERVICE_FEE_PCT,
    amount,
  };
}

/**
 * Build the paymentAdjustments entry for the service fee.
 *
 * IQPro requires ServiceFee adjustments to be expressed as a percentage only.
 */
export function buildServiceFeeAdjustment(breakdown: ComputedFeeBreakdown): {
  type: string;
  percentage: number;
  flatAmount: null;
} {
  return {
    type: 'ServiceFee',
    percentage: breakdown.serviceFeePct,
    flatAmount: null,
  };
}

/**
 * Build the paymentAdjustments entry for sales tax. Used for STORE
 * (catalog merchandise) transactions only. IQPro requires Tax adjustments to
 * be expressed as a flat amount only.
 */
export function buildTaxAdjustment(breakdown: ComputedFeeBreakdown): {
  type: string;
  percentage: null;
  flatAmount: number;
} {
  return {
    type: 'Tax',
    percentage: null,
    flatAmount: breakdown.taxAmount,
  };
}

// ── Transaction response parsing ──────────────────────────────────────────────

/**
 * Parse an IQPro transaction response into an approval status.
 */
export function mapTransactionStatus(txData: Record<string, unknown>): 'approved' | 'declined' {
  const raw = ((txData.status ?? '') as string).toLowerCase();
  if (raw === 'captured' || raw === 'settled' || raw === 'authorized' || raw === 'pendingsettlement') {
    return 'approved';
  }
  return 'declined';
}

/**
 * Throws if the transaction was not approved.
 */
export function assertTransactionApproved(txData: Record<string, unknown>): void {
  if (mapTransactionStatus(txData) === 'approved') {
    return;
  }
  const reason = (txData.processorResponseText ?? txData.processorResponseMessage ?? txData.response ?? 'Transaction declined') as string;
  throw new Error(reason);
}

// ── ACH tokenization ──────────────────────────────────────────────────────────

export async function tokenizeAch(config: IQProConfig, params: TokenizeAchParams): Promise<TokenizeAchResult> {
  const token = await getOAuthToken(config);
  const vaultBaseUrl = new URL(config.baseUrl).origin;

  const res = await fetch(`${vaultBaseUrl}/vault/api/v1/Tokenize/Ach`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      accountNumber: params.accountNumber,
      routingNumber: params.routingNumber,
      secCode: params.secCode ?? 'PPD',
      achAccountType: params.achAccountType ?? 'Checking',
    }),
  });

  if (!res.ok) {
    throw new Error(`ACH tokenization failed: ${res.status}`);
  }

  const json = await res.json() as Record<string, unknown>;
  const data = json?.data as Record<string, unknown> | undefined;
  const achToken = (data?.achId ?? json?.achToken ?? data?.achToken ?? json?.token) as string | undefined;

  if (!achToken) {
    throw new Error('ACH tokenization response missing token');
  }

  return { achToken };
}

// ── Vaulted customer search (by phone) ───────────────────────────────────────

interface VaultedCustomerMatch {
  customerId: string;
  customerPaymentMethodId: string;
  fullName: string;
  paymentMethodType: 'card' | 'ach';
  cardMaskedNumber?: string;
}

function digitsOnly(s: string): string {
  return s.replace(/\D/g, '');
}

function pickDefaultPaymentMethod(
  paymentMethods: Array<Record<string, unknown>>,
): Record<string, unknown> | null {
  if (!paymentMethods.length) {
    return null;
  }
  return paymentMethods.find(pm => pm.isDefault === true) ?? paymentMethods[0] ?? null;
}

function extractFullName(customer: Record<string, unknown>): string {
  const direct = (customer.name ?? customer.fullName ?? '') as string;
  if (direct.trim()) {
    return direct.trim();
  }
  const first = (customer.firstName ?? '') as string;
  const last = (customer.lastName ?? '') as string;
  const joined = `${first} ${last}`.trim();
  if (joined) {
    return joined;
  }
  const addresses = (customer.addresses ?? []) as Array<Record<string, unknown>>;
  const billing = addresses.find(a => a.isBilling) ?? addresses[0];
  if (billing) {
    const af = (billing.firstName ?? '') as string;
    const al = (billing.lastName ?? '') as string;
    const aj = `${af} ${al}`.trim();
    if (aj) {
      return aj;
    }
  }
  return 'Saved customer';
}

/**
 * Search the IQPro customer vault by phone number.
 */
export async function searchCustomersByPhone(config: IQProConfig, phone: string): Promise<VaultedCustomerMatch[]> {
  const cleaned = digitsOnly(phone);
  if (cleaned.length < 10) {
    return [];
  }

  const res = await iqproPost<{ data?: unknown }>(
    config,
    `/api/gateway/${config.gatewayId}/customer/search`,
    {
      phone: { operator: 'IsLike', value: cleaned },
      includeDefaultAddresses: true,
      includeDefaultPayment: true,
      includeStats: false,
      offSet: 0,
      limit: 25,
    },
  );

  const raw = (res as Record<string, unknown>).data ?? res;
  let customers: Array<Record<string, unknown>> = [];
  if (Array.isArray(raw)) {
    customers = raw as Array<Record<string, unknown>>;
  }
  else if (raw && typeof raw === 'object') {
    const maybeResults = (raw as Record<string, unknown>).results
      ?? (raw as Record<string, unknown>).customers
      ?? (raw as Record<string, unknown>).items;
    if (Array.isArray(maybeResults)) {
      customers = maybeResults as Array<Record<string, unknown>>;
    }
  }

  const matches: VaultedCustomerMatch[] = [];
  for (const customer of customers) {
    const customerId = (customer.customerId ?? customer.id) as string | undefined;
    if (!customerId) {
      continue;
    }
    const defaultPM = customer.defaultPaymentMethod as Record<string, unknown> | undefined;
    const paymentMethods = (customer.paymentMethods ?? []) as Array<Record<string, unknown>>;
    const pm = defaultPM ?? pickDefaultPaymentMethod(paymentMethods);
    if (!pm) {
      continue;
    }
    const customerPaymentMethodId = (pm.paymentMethodId ?? pm.customerPaymentMethodId ?? pm.id) as string | undefined;
    if (!customerPaymentMethodId) {
      continue;
    }
    const card = pm.card as Record<string, unknown> | undefined;
    const ach = pm.ach as Record<string, unknown> | undefined;
    const paymentMethodType: 'card' | 'ach' = card ? 'card' : ach ? 'ach' : 'card';
    const cardMaskedNumber = card
      ? ((card.maskedNumber ?? card.maskedCard ?? '') as string) || undefined
      : undefined;

    matches.push({
      customerId,
      customerPaymentMethodId,
      fullName: extractFullName(customer),
      paymentMethodType,
      cardMaskedNumber,
    });
  }

  return matches;
}

// ── Match token (HMAC envelope for vaulted-customer chooser) ─────────────────

interface MatchTokenPayload {
  customerId: string;
  customerPaymentMethodId: string;
  paymentMethodType: 'card' | 'ach';
  cardMaskedNumber?: string;
  exp: number;
}

const MATCH_TOKEN_TTL_MS = 5 * 60 * 1000;

function getMatchTokenSecret(config: IQProConfig): string {
  return process.env.KIOSK_MATCH_TOKEN_SECRET ?? config.clientSecret;
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

export function signMatchToken(config: IQProConfig, payload: Omit<MatchTokenPayload, 'exp'>): string {
  const full: MatchTokenPayload = { ...payload, exp: Date.now() + MATCH_TOKEN_TTL_MS };
  const body = base64UrlEncode(Buffer.from(JSON.stringify(full), 'utf8'));
  const sig = base64UrlEncode(createHmac('sha256', getMatchTokenSecret(config)).update(body).digest());
  return `${body}.${sig}`;
}

/**
 * Verify a signed match token.
 *
 * Returns `null` when the input is missing or not a string. Throws on a
 * present-but-invalid token.
 */
export function verifyMatchToken(config: IQProConfig, token: unknown): MatchTokenPayload | null {
  if (typeof token !== 'string' || token.length === 0) {
    return null;
  }
  const parts = token.split('.');
  if (parts.length !== 2) {
    throw new Error('Invalid match token');
  }
  const body = parts[0];
  const sig = parts[1];
  if (!body || !sig) {
    throw new Error('Invalid match token');
  }
  const expected = base64UrlEncode(createHmac('sha256', getMatchTokenSecret(config)).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error('Invalid match token signature');
  }
  let payload: MatchTokenPayload;
  try {
    payload = JSON.parse(base64UrlDecode(body).toString('utf8')) as MatchTokenPayload;
  }
  catch {
    throw new Error('Invalid match token body');
  }
  if (typeof payload.exp !== 'number' || Date.now() > payload.exp) {
    throw new Error('Match token expired');
  }
  if (!payload.customerId || !payload.customerPaymentMethodId) {
    throw new Error('Match token missing required fields');
  }
  return payload;
}

/**
 * IQPro payment integration for the kiosk.
 * Mirrors src/libs/IQPro.ts from dojo-planner.
 */

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

// ── Config check ──────────────────────────────────────────────────────────────

export function isIQProConfigured(): boolean {
  return !!(
    process.env.IQPRO_CLIENT_ID
    && process.env.IQPRO_CLIENT_SECRET
    && process.env.IQPRO_SCOPE
    && process.env.IQPRO_OAUTH_URL
    && process.env.IQPRO_BASE_URL
    && process.env.IQPRO_GATEWAY_ID
  );
}

// ── OAuth token (cached per process) ─────────────────────────────────────────

let cachedOAuthToken: { token: string; expiresAt: number } | null = null;

async function getOAuthToken(): Promise<string> {
  if (cachedOAuthToken && Date.now() < cachedOAuthToken.expiresAt) {
    return cachedOAuthToken.token;
  }

  const res = await fetch(process.env.IQPRO_OAUTH_URL!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.IQPRO_CLIENT_ID!,
      client_secret: process.env.IQPRO_CLIENT_SECRET!,
      scope: process.env.IQPRO_SCOPE!,
    }),
  });

  if (!res.ok) {
    throw new Error(`IQPro OAuth failed: ${res.status}`);
  }

  const data = await res.json() as { access_token: string; expires_in?: number };
  const expiresIn = data.expires_in ?? 3600;

  cachedOAuthToken = {
    token: data.access_token,
    expiresAt: Date.now() + (expiresIn - 60) * 1000,
  };

  return cachedOAuthToken.token;
}

// ── Tokenization config ───────────────────────────────────────────────────────

export async function getTokenizationConfig(clientOrigin: string): Promise<TokenizationIframeConfig | null> {
  if (!isIQProConfigured()) {
    return null;
  }

  const token = await getOAuthToken();
  const baseUrl = process.env.IQPRO_BASE_URL!;
  const gatewayId = process.env.IQPRO_GATEWAY_ID!;

  const res = await fetch(`${baseUrl}/api/v1/gateway/${gatewayId}/tokenization/configuration`, {
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
  const isSandbox = baseUrl.includes('sandbox');
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
  path: string,
  body: unknown,
): Promise<T> {
  const token = await getOAuthToken();
  const baseUrl = process.env.IQPRO_BASE_URL!;

  devLog('[IQPro] POST', sanitizeForLog(path));
  devLog('[IQPro] POST request body:', sanitizeForLog(JSON.stringify(body, null, 2)));

  const res = await fetch(`${baseUrl}${path}`, {
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
  path: string,
): Promise<T> {
  const token = await getOAuthToken();
  const baseUrl = process.env.IQPRO_BASE_URL!;

  devLog('[IQPro] GET', sanitizeForLog(path));

  const res = await fetch(`${baseUrl}${path}`, {
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
  path: string,
  body: unknown,
): Promise<T> {
  const token = await getOAuthToken();
  const baseUrl = process.env.IQPRO_BASE_URL!;

  devLog('[IQPro] PUT', sanitizeForLog(path));
  devLog('[IQPro] PUT request body:', sanitizeForLog(JSON.stringify(body, null, 2)));

  const res = await fetch(`${baseUrl}${path}`, {
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

// ── Gateway processors ───────────────────────────────────────────────────────

interface GatewayProcessors {
  cardProcessorId: string | null;
  achProcessorId: string | null;
}

let cachedProcessors: GatewayProcessors | null = null;

export async function getGatewayProcessors(): Promise<GatewayProcessors> {
  if (cachedProcessors) {
    return cachedProcessors;
  }
  if (!isIQProConfigured()) {
    return { cardProcessorId: null, achProcessorId: null };
  }

  const token = await getOAuthToken();
  const baseUrl = process.env.IQPRO_BASE_URL!;
  const gatewayId = process.env.IQPRO_GATEWAY_ID!;

  const res = await fetch(`${baseUrl}/api/gateway/${gatewayId}`, {
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

  cachedProcessors = {
    cardProcessorId: defaultCard?.processorId ?? null,
    achProcessorId: defaultAch?.processorId ?? null,
  };

  return cachedProcessors;
}

// ── Tax + service fee config ──────────────────────────────────────────────────

/**
 * Sales-tax percentage applied to STORE (catalog merchandise) transactions.
 * Memberships and other non-store charges are not taxed.
 *
 * Currently sourced from the KIOSK_TAX_STATE_PCT env var as a stand-in for a
 * per-organization database column — when that column exists, replace this
 * helper with a per-transaction lookup keyed on the organization ID.
 */
function getKioskTaxStatePct(): number {
  const fromEnv = process.env.KIOSK_TAX_STATE_PCT?.trim();
  if (!fromEnv) {
    throw new Error('KIOSK_TAX_STATE_PCT is not set. Add it to .env.local (e.g. KIOSK_TAX_STATE_PCT=3.75).');
  }
  const parsed = Number.parseFloat(fromEnv);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`KIOSK_TAX_STATE_PCT must be a non-negative number, got "${fromEnv}"`);
  }
  return parsed;
}

/**
 * Service fee percentage applied to EVERY transaction (store, membership,
 * cancellation fee). Passed to IQPro as a paymentAdjustment of type "ServiceFee".
 * The flat amount is computed by IQPro's /calculatefees endpoint (not locally)
 * per Basys team guidance.
 */
function getKioskServiceFeePct(): number {
  const fromEnv = process.env.KIOSK_SERVICE_FEE_PCT?.trim();
  if (!fromEnv) {
    throw new Error('KIOSK_SERVICE_FEE_PCT is not set. Add it to .env.local (e.g. KIOSK_SERVICE_FEE_PCT=3.75).');
  }
  const parsed = Number.parseFloat(fromEnv);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`KIOSK_SERVICE_FEE_PCT must be a non-negative number, got "${fromEnv}"`);
  }
  return parsed;
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
 * for a given base. We send a single paymentAdjustment of type "ServiceFee"
 * with the configured percentage; IQPro returns the computed flat amount in
 * `serviceFeesAmount`.
 */
async function fetchServiceFeeAmount(params: CalculateServiceFeeParams): Promise<number> {
  const gatewayId = process.env.IQPRO_GATEWAY_ID!;
  const body: Record<string, unknown> = {
    baseAmount: params.baseAmount,
    addTaxToTotal: true,
    taxAmount: 0,
    processorId: params.processorId,
    transactionType: 'Sale',
    paymentAdjustments: [
      { type: 'ServiceFee', percentage: getKioskServiceFeePct(), flatAmount: null },
    ],
  };
  // IQPro accepts exactly one of token or creditCardBin.
  if (params.token) {
    body.token = params.token;
  }
  else if (params.creditCardBin) {
    body.creditCardBin = params.creditCardBin;
  }

  const res = await iqproPost<{ data?: { serviceFeesAmount?: number } }>(
    `/api/gateway/${gatewayId}/transaction/calculatefees`,
    body,
  );
  const data = (res.data ?? res) as { serviceFeesAmount?: number };
  return roundCents(data.serviceFeesAmount ?? 0);
}

/**
 * Compute the full fee breakdown for a transaction.
 * - Tax is computed locally (store only; 0 for memberships).
 * - Service fee amount is computed by IQPro via /calculatefees, using the
 *   configured ServiceFee percentage. A processor ID + token-or-BIN are required.
 */
export async function computeFeeBreakdown(
  baseAmount: number,
  isTaxable: boolean,
  serviceFeeLookup: Omit<CalculateServiceFeeParams, 'baseAmount'>,
): Promise<ComputedFeeBreakdown> {
  const base = roundCents(baseAmount);
  const taxPct = isTaxable ? getKioskTaxStatePct() : 0;
  const serviceFeePct = getKioskServiceFeePct();
  const taxAmount = roundCents(base * (taxPct / 100));
  const serviceFeeAmount = await fetchServiceFeeAmount({ ...serviceFeeLookup, baseAmount: base });
  const amount = roundCents(base + taxAmount + serviceFeeAmount);
  return {
    baseAmount: base,
    taxAmount,
    taxPct,
    serviceFeeAmount,
    serviceFeePct,
    amount,
  };
}

/**
 * Build the paymentAdjustments entry for the service fee.
 *
 * IQPro requires ServiceFee adjustments to be expressed as a percentage only —
 * passing a flatAmount with type: "ServiceFee" fails validation with
 * "ServiceFee must be expressed as a percentage". The gateway computes the
 * flat amount itself from the percentage.
 *
 * We still call /calculatefees upstream to preview the exact flat amount
 * (and surface it in our UI/receipts), but on the /transaction call we only
 * send the percentage.
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
 * (catalog merchandise) transactions only. Per Basys team guidance, tax is
 * expressed solely via this paymentAdjustment (not via remit.taxAmount) so it
 * shows up distinctly in reporting.
 *
 * IQPro requires Tax adjustments to be expressed as a flat amount only —
 * passing a percentage with type: "Tax" fails validation with
 * "Tax must be expressed as a flat amount".
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
 * IQPro returns `status: "Captured" | "Settled" | "Authorized" | "Declined"
 * | "Failed" | "PendingSettlement"` etc. Anything not in the approved set
 * (or declined, for explicit error handling) is treated as declined for
 * safety — we never want to treat an ambiguous status as approved.
 */
export function mapTransactionStatus(txData: Record<string, unknown>): 'approved' | 'declined' {
  const raw = ((txData.status ?? '') as string).toLowerCase();
  if (raw === 'captured' || raw === 'settled' || raw === 'authorized' || raw === 'pendingsettlement') {
    return 'approved';
  }
  return 'declined';
}

/**
 * Throws if the transaction was not approved. The thrown Error's message
 * includes IQPro's processorResponseText when available so decline reasons
 * bubble up cleanly to the client.
 */
export function assertTransactionApproved(txData: Record<string, unknown>): void {
  if (mapTransactionStatus(txData) === 'approved') {
    return;
  }
  const reason = (txData.processorResponseText ?? txData.processorResponseMessage ?? txData.response ?? 'Transaction declined') as string;
  throw new Error(reason);
}

// ── ACH tokenization ──────────────────────────────────────────────────────────

export async function tokenizeAch(params: TokenizeAchParams): Promise<TokenizeAchResult> {
  if (!isIQProConfigured()) {
    throw new Error('IQPro is not configured');
  }

  const token = await getOAuthToken();
  const vaultBaseUrl = new URL(process.env.IQPRO_BASE_URL!).origin;

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
  // Fall back to billing address contact name when present.
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
 * Search the IQPro customer vault by phone number. Returns one entry per
 * matching customer with a usable default payment method. Customers with no
 * payment methods are filtered out. Returns [] when nothing matches.
 */
export async function searchCustomersByPhone(phone: string): Promise<VaultedCustomerMatch[]> {
  if (!isIQProConfigured()) {
    return [];
  }
  const cleaned = digitsOnly(phone);
  if (cleaned.length < 10) {
    return [];
  }

  const gatewayId = process.env.IQPRO_GATEWAY_ID!;
  // IQPro's customer/search expects a full CustomerSearchModel where each
  // string field is a SearchFilterString ({ operator, value }). We narrow on
  // phone with IsLike and rely on includeDefaultPayment/includeDefaultAddresses
  // to return the data we need to build the chooser. paymentType is omitted
  // (i.e., not filtered) so both vaulted card and ACH customers come back.
  const res = await iqproPost<{ data?: unknown }>(
    `/api/gateway/${gatewayId}/customer/search`,
    {
      phone: { operator: 'IsLike', value: cleaned },
      includeDefaultAddresses: true,
      includeDefaultPayment: true,
      includeStats: false,
      // IQPro's offSet is 0-based; sending 1 skips the first row.
      offSet: 0,
      limit: 25,
    },
  );

  // IQPro search responses may shape results as { data: [...] }, { data: { results: [...] } },
  // or a bare array. Normalize.
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
    // The search response can return the default PM directly under
    // `defaultPaymentMethod` (when includeDefaultPayment=true) or the full
    // list under `paymentMethods`. Prefer the former, fall back to the latter.
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

function getMatchTokenSecret(): string {
  const secret = process.env.KIOSK_MATCH_TOKEN_SECRET ?? process.env.IQPRO_CLIENT_SECRET;
  if (!secret) {
    throw new Error('KIOSK_MATCH_TOKEN_SECRET (or IQPRO_CLIENT_SECRET fallback) must be set');
  }
  return secret;
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

export function signMatchToken(payload: Omit<MatchTokenPayload, 'exp'>): string {
  const full: MatchTokenPayload = { ...payload, exp: Date.now() + MATCH_TOKEN_TTL_MS };
  const body = base64UrlEncode(Buffer.from(JSON.stringify(full), 'utf8'));
  const sig = base64UrlEncode(createHmac('sha256', getMatchTokenSecret()).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyMatchToken(token: string): MatchTokenPayload {
  const parts = token.split('.');
  if (parts.length !== 2) {
    throw new Error('Invalid match token');
  }
  const body = parts[0];
  const sig = parts[1];
  if (!body || !sig) {
    throw new Error('Invalid match token');
  }
  const expected = base64UrlEncode(createHmac('sha256', getMatchTokenSecret()).update(body).digest());
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

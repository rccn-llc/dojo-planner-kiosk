/**
 * IQPro payment integration for the kiosk.
 * Mirrors src/libs/IQPro.ts from dojo-planner.
 */

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

  devLog('[IQPro] POST', path);
  devLog('[IQPro] POST request body:', JSON.stringify(body, null, 2));

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
    console.error(`[IQPro] POST ${path} FAILED (${res.status}):`, errorBody);
    throw new Error(`IQPro API ${path} failed: ${res.status} ${errorBody}`);
  }

  const text = await res.text();
  const json = text ? JSON.parse(text) as T : {} as T;
  devLog(`[IQPro] POST ${path} response (${res.status}):`, text || '(empty body)');
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

  devLog('[IQPro] GET', path);

  const res = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => '');
    console.error(`[IQPro] GET ${path} FAILED (${res.status}):`, errorBody);
    throw new Error(`IQPro API GET ${path} failed: ${res.status}`);
  }

  const text = await res.text();
  const json = text ? JSON.parse(text) as T : {} as T;
  devLog(`[IQPro] GET ${path} response (${res.status}):`, text || '(empty body)');
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

  devLog('[IQPro] PUT', path);
  devLog('[IQPro] PUT request body:', JSON.stringify(body, null, 2));

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
    console.error(`[IQPro] PUT ${path} FAILED (${res.status}):`, errorBody);
    throw new Error(`IQPro API PUT ${path} failed: ${res.status} ${errorBody}`);
  }

  const text = await res.text();
  const json = text ? JSON.parse(text) as T : {} as T;
  devLog(`[IQPro] PUT ${path} response (${res.status}):`, text || '(empty body)');
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

// ── Tax state ─────────────────────────────────────────────────────────────────

/**
 * The state used for sales-tax calculation when calling IQPro's calculatefees
 * endpoint. Currently sourced from the KIOSK_TAX_STATE env var as a stand-in
 * for per-organization location lookup — the long-term plan is to derive this
 * from the organization's primary address (Clerk metadata or a DB field) so a
 * single kiosk deployment can handle dojos in different states correctly.
 */
export function getKioskTaxState(): string {
  const fromEnv = process.env.KIOSK_TAX_STATE?.trim();
  if (!fromEnv) {
    throw new Error('KIOSK_TAX_STATE is not set. Add it to .env.local (e.g. KIOSK_TAX_STATE=CA).');
  }
  return fromEnv.toUpperCase();
}

// ── Fee calculation ───────────────────────────────────────────────────────────

interface CalculateFeesParams {
  baseAmount: number;
  processorId: string;
  state: string;
  paymentMethod: 'card' | 'ach';
  creditCardBin?: string;
  token?: string;
  paymentAdjustments?: Array<{
    type: string;
    percentage?: number | null;
    flatAmount?: number | null;
  }>;
}

interface CalculateFeesResult {
  isSurchargeable: boolean;
  isPinCapable: boolean;
  surchargeRate: number;
  surchargeAmount: number;
  serviceFeesAmount: number;
  convenienceFeesAmount: number;
  baseAmount: number;
  amount: number;
  tip: number;
  taxAmount: number;
  cardBrand: string | null;
  cardType: string | null;
}

export async function calculateTransactionFees(
  params: CalculateFeesParams,
): Promise<CalculateFeesResult> {
  const gatewayId = process.env.IQPRO_GATEWAY_ID!;
  const body: Record<string, unknown> = {
    baseAmount: params.baseAmount,
    addTaxToTotal: true,
    taxAmount: 0,
    processorId: params.processorId,
    transactionType: 'Sale',
    state: params.state,
  };
  // IQPro accepts exactly one of token or creditCardBin, never both. Prefer
  // token when available — it identifies the specific card, whereas BIN only
  // identifies the issuing range.
  if (params.token) {
    body.token = params.token;
  }
  else if (params.creditCardBin) {
    body.creditCardBin = params.creditCardBin;
  }
  if (params.paymentAdjustments && params.paymentAdjustments.length > 0) {
    body.paymentAdjustments = params.paymentAdjustments;
  }

  const res = await iqproPost<{ data?: CalculateFeesResult }>(
    `/api/gateway/${gatewayId}/transaction/calculatefees`,
    body,
  );
  const data = (res.data ?? res) as CalculateFeesResult;
  return data;
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
      secCode: params.secCode ?? 'WEB',
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

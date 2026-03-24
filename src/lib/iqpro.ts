/**
 * IQPro payment integration for the kiosk.
 * Mirrors src/libs/IQPro.ts from dojo-planner.
 */

// Module name as a variable so that bundlers (turbopack / webpack) do NOT
// statically resolve the optional @dojo-planner/iqpro-client package.
const IQPRO_MODULE = '@dojo-planner/iqpro-client';

// ── Types ─────────────────────────────────────────────────────────────────────

// Minimal shape of the IQPro client used by this service.
// The actual client is loaded dynamically to avoid bundler errors
// when the optional @dojo-planner/iqpro-client package is absent.
interface IQProClientShape {
  customers: {
    create: (params: Record<string, unknown>) => Promise<{ customerId: string }>;
    get: (customerId: string) => Promise<Record<string, unknown>>;
    createPaymentMethod: (customerId: string, params: Record<string, unknown>) => Promise<{
      paymentMethodId?: string;
      customerPaymentMethodId?: string;
      customerPaymentId?: string;
    }>;
  };
  transactions: {
    create: (params: Record<string, unknown>) => Promise<{ id: string; status?: string; processorResponseMessage?: string }>;
  };
  post: <T = Record<string, unknown>>(path: string, body?: unknown) => Promise<T>;
}

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

// ── IQPro client ──────────────────────────────────────────────────────────────

let iqproClient: IQProClientShape | null = null;

export async function getIQProClient(): Promise<IQProClientShape | null> {
  if (!isIQProConfigured()) {
    return null;
  }

  if (!iqproClient) {
    const mod = await import(/* webpackIgnore: true */ IQPRO_MODULE);
    const IQProClient = mod.IQProClient;
    const client = new IQProClient({
      clientId: process.env.IQPRO_CLIENT_ID!,
      clientSecret: process.env.IQPRO_CLIENT_SECRET!,
      scope: process.env.IQPRO_SCOPE!,
      oauthUrl: process.env.IQPRO_OAUTH_URL!,
      baseUrl: process.env.IQPRO_BASE_URL!,
    });
    (client as { setGatewayContext: (id: string) => void }).setGatewayContext(process.env.IQPRO_GATEWAY_ID!);
    iqproClient = client as IQProClientShape;
  }

  return iqproClient;
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

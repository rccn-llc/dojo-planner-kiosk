/**
 * Square REST transport. No SDK.
 *
 * A port of dojo-planner's `src/libs/Square.ts` — keep the two in step. The
 * only intended differences are the config type (the kiosk resolves its own)
 * and console logging in place of the planner's structured logger.
 *
 * Mirrors `libs/IQPro.ts` deliberately: raw `fetch`, every request and response
 * body logged through the structured logger. That logging is what made IQPro's
 * vague 4xx errors diagnosable from Better Stack without re-running a payment,
 * and Square's error envelope is no friendlier.
 *
 * ── Scope ───────────────────────────────────────────────────────────────────
 *
 * This is MEMBER-facing money only — the org's own merchant account. The
 * platform's SaaS subscription (what a dojo pays to use Dojo Planner) is
 * always IQPro and resolves through `resolvePlatformIQProConfig`, which is
 * typed against `IQProConfig` and cannot receive a Square config. An
 * organization choosing Square changes how ITS members are charged; it never
 * changes how that organization pays us.
 *
 * ── Money ───────────────────────────────────────────────────────────────────
 *
 * Square speaks integer minor units; this codebase speaks float dollars. Every
 * crossing goes through `toMinorUnits` / `fromMinorUnits` below — never an
 * inline `* 100`, because each ad-hoc conversion is a rounding decision on the
 * money path.
 */

import type { SquareServerConfig } from './iqproConfig';

/** Square's API version, pinned. Sent on every request. */
const SQUARE_API_VERSION = '2025-01-23';

/**
 * Base URL for the configured environment.
 *
 * `environment` is a `z.enum` rather than a bare string precisely so a typo
 * cannot silently mean production — IQPro's habit of sniffing
 * `baseUrl.includes('sandbox')` is what this avoids.
 */
export function squareBaseUrl(config: SquareServerConfig): string {
  return config.environment === 'production'
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com';
}

/**
 * Dollars → integer minor units (cents for USD).
 *
 * Rounds half-away-from-zero at the cent, matching `roundCents` in
 * `libs/IQPro.ts`. Anything that reaches Square as money passes through here.
 */
export function toMinorUnits(dollars: number): number {
  return Math.round(dollars * 100);
}

/** Integer minor units → dollars, for storage in our float-dollar columns. */
export function fromMinorUnits(minor: number): number {
  return Math.round(minor) / 100;
}

/** A Square API error, carrying the category/code Square returned. */
export class SquareApiError extends Error {
  readonly status: number;
  readonly category?: string;
  readonly code?: string;

  constructor(path: string, status: number, body: string) {
    const parsed = parseSquareErrors(body);
    super(
      parsed
        ? `Square ${path} failed (${status}): ${parsed.category}/${parsed.code} — ${parsed.detail}`
        : `Square ${path} failed (${status}): ${body || '(empty body)'}`,
    );
    this.name = 'SquareApiError';
    this.status = status;
    this.category = parsed?.category;
    this.code = parsed?.code;
  }
}

/**
 * Square reports failures as `{ errors: [{ category, code, detail }] }`.
 *
 * Returns the first error, or null when the body is not that shape — a 502
 * from an intermediary, say, which would otherwise throw while being parsed.
 */
function parseSquareErrors(body: string): { category: string; code: string; detail: string } | null {
  try {
    const json = JSON.parse(body) as {
      errors?: Array<{ category?: string; code?: string; detail?: string }>;
    };
    const first = json.errors?.[0];
    if (!first) {
      return null;
    }
    return {
      category: first.category ?? 'UNKNOWN',
      code: first.code ?? 'UNKNOWN',
      detail: first.detail ?? '(no detail)',
    };
  }
  catch {
    return null;
  }
}

async function squareRequest<T>(
  config: SquareServerConfig,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `${squareBaseUrl(config)}${path}`;

  // Full body, like the kiosk's IQPro transport. The access token is a header,
  // so it is not in here; Square never echoes card data back into a body.
  console.warn('[Square] request', method, path, body === undefined ? '' : JSON.stringify(body));

  const res = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${config.accessToken}`,
      'Content-Type': 'application/json',
      'Square-Version': SQUARE_API_VERSION,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const text = await res.text();

  if (!res.ok) {
    console.error('[Square] request failed', method, path, res.status, text || '(empty body)');
    throw new SquareApiError(path, res.status, text);
  }

  console.warn('[Square] response', method, path, res.status, text);

  // A 204 has no body; callers of such endpoints expect an empty object.
  return (text ? JSON.parse(text) : {}) as T;
}

export async function squarePost<T = Record<string, unknown>>(
  config: SquareServerConfig,
  path: string,
  body: unknown,
): Promise<T> {
  return squareRequest<T>(config, 'POST', path, body);
}

export async function squareGet<T = Record<string, unknown>>(
  config: SquareServerConfig,
  path: string,
): Promise<T> {
  return squareRequest<T>(config, 'GET', path);
}

export async function squarePut<T = Record<string, unknown>>(
  config: SquareServerConfig,
  path: string,
  body: unknown,
): Promise<T> {
  return squareRequest<T>(config, 'PUT', path, body);
}

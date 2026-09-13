/**
 * Signed envelopes for the saved-payment-method chooser.
 *
 * The kiosk shows a returning member their saved card by name, and the browser
 * must be able to send back "charge that one" without ever holding the
 * provider's customer or payment-method ids. A match token is that handle: the
 * ids travel inside an HMAC-signed body the client cannot forge.
 *
 * ⚠️ The body is base64url, NOT encrypted — a client can decode and read it.
 * The signature only proves it was not tampered with. Never put anything in
 * here that the browser must not see.
 *
 * Provider-neutral by design. This used to live in `iqpro.ts` and take an
 * `IQProConfig`, purely to reach the dev-only fallback secret — which made the
 * whole saved-card flow IQPro-shaped even though nothing about signing is.
 */

import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface MatchTokenPayload {
  /**
   * The org this token was minted for.
   *
   * ⚠️ Without this claim a token minted at one dojo is structurally valid at
   * another: the signature verifies, the ids are real, and the charge lands on
   * a customer the caller has no relationship with. Verification REQUIRES a
   * matching orgId.
   */
  orgId: string;
  customerId: string;
  customerPaymentMethodId: string;
  paymentMethodType: 'card' | 'ach';
  cardMaskedNumber?: string;
  exp: number;
}

const MATCH_TOKEN_TTL_MS = 5 * 60 * 1000;

/**
 * The HMAC key.
 *
 * `KIOSK_MATCH_TOKEN_SECRET` is independent of any payment credential, so
 * rotating a merchant secret does not silently invalidate in-flight tokens —
 * and a token secret is a different trust domain from a gateway credential.
 * Required in production; outside it, a fixed development value keeps local
 * setup to one command.
 */
function getMatchTokenSecret(): string {
  const dedicated = process.env.KIOSK_MATCH_TOKEN_SECRET;
  if (dedicated) {
    return dedicated;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('KIOSK_MATCH_TOKEN_SECRET is required in production');
  }
  return 'kiosk-dev-match-token-secret';
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

/**
 * Verify a signed match token against the org making the request.
 *
 * Returns `null` when the input is missing or not a string — that is the
 * ordinary "no saved card chosen" path. Throws on a present-but-invalid token,
 * including one minted for a different organization.
 */
export function verifyMatchToken(expectedOrgId: string, token: unknown): MatchTokenPayload | null {
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
  // Cross-tenant guard. A valid signature proves only that WE minted it, not
  // that it belongs to the dojo now presenting it.
  if (payload.orgId !== expectedOrgId) {
    throw new Error('Match token was issued for a different organization');
  }

  return payload;
}

import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Kiosk attestation token.
 *
 * The public kiosk terminal has no logged-in user, so the payment routes can't
 * gate on a session. Instead the kiosk page mints a short-lived signed token
 * (via GET /api/payment/attestation) and passes it back on payment requests.
 * The routes verify it before charging. Combined with per-IP/per-org rate
 * limiting, this raises the bar on scripted card-testing: an attacker must
 * first fetch a fresh token per burst rather than hammering the charge path
 * directly.
 *
 * This is a bot/abuse control, NOT authentication — it does not identify a
 * person. The signing key is independent of the IQPro merchant credential so
 * rotating one doesn't affect the other.
 */

interface AttestationPayload {
  orgId: string;
  exp: number;
}

const ATTESTATION_TTL_MS = 15 * 60 * 1000;

function getAttestationSecret(): string {
  const secret = process.env.KIOSK_ATTESTATION_SECRET;
  if (secret) {
    return secret;
  }
  // Require a dedicated secret in production so the token can't be forged; a
  // deterministic dev fallback keeps local runs working without extra setup.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('KIOSK_ATTESTATION_SECRET is required in production');
  }
  return 'dev-kiosk-attestation-secret';
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

export function signAttestationToken(orgId: string): string {
  const payload: AttestationPayload = { orgId, exp: Date.now() + ATTESTATION_TTL_MS };
  const body = base64UrlEncode(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = base64UrlEncode(createHmac('sha256', getAttestationSecret()).update(body).digest());
  return `${body}.${sig}`;
}

/**
 * Verify a kiosk attestation token for a given org.
 * Returns true only for a well-formed, unexpired token whose signature matches
 * and whose `orgId` equals the one being charged.
 */
export function verifyAttestationToken(token: unknown, orgId: string): boolean {
  if (typeof token !== 'string' || token.length === 0) {
    return false;
  }
  const parts = token.split('.');
  if (parts.length !== 2) {
    return false;
  }
  const [body, sig] = parts;
  if (!body || !sig) {
    return false;
  }
  const expected = base64UrlEncode(createHmac('sha256', getAttestationSecret()).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return false;
  }
  let payload: AttestationPayload;
  try {
    payload = JSON.parse(base64UrlDecode(body).toString('utf8')) as AttestationPayload;
  }
  catch {
    return false;
  }
  if (typeof payload.exp !== 'number' || Date.now() > payload.exp) {
    return false;
  }
  return payload.orgId === orgId;
}

import { Buffer } from 'node:buffer';
import { createDecipheriv } from 'node:crypto';
import process from 'node:process';

/**
 * AES-256-GCM for tenant connection strings.
 *
 * ── Why this is separate from `libs/Crypto.ts` ──────────────────────────────
 *
 * Same algorithm and same on-disk layout, but a DIFFERENT key. A database
 * connection string is a higher trust tier than a payment gateway id, so the
 * two secret domains are deliberately kept apart. Merging them would mean one
 * compromised key exposes both.
 *
 * ── Why this reads process.env directly ─────────────────────────────────────
 *
 * The kiosk has no validated Env module, and every consumer here is a hot
 * request path resolving a tenant connection.
 *
 * ── DECRYPT ONLY ────────────────────────────────────────────────────────────
 *
 * The planner's copy also encrypts, because it provisions tenants. The kiosk
 * never writes a `tenant` row, so it does not get that capability — a public
 * terminal should not hold the ability to mint tenant connection strings.
 * Ported from dojo-planner `src/libs/TenantCrypto.ts`; the on-disk format must
 * stay byte-identical or rows written by the planner become unreadable here.
 *
 * ── Layout ──────────────────────────────────────────────────────────────────
 *
 * base64( iv(12) || authTag(16) || ciphertext ) — identical to `libs/Crypto.ts`,
 * so ciphertext written by one is readable by the other given the same key.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * The tenant-connection key, or null when unset.
 *
 * Falls back to the IQPro key so local dev and CI keep working without a second
 * secret configured. Returns null rather than throwing: callers differ on
 * whether a missing key is fatal — `autoRegisterTenant` degrades to a sentinel,
 * the read path must hard-fail.
 */
export function tenantEncryptionKey(): Buffer | null {
  const hex = process.env.CONTROL_PLANE_ENCRYPTION_KEY ?? process.env.IQPRO_CONFIG_ENCRYPTION_KEY;
  if (!hex) {
    return null;
  }
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error(
      'Tenant encryption key must be 64 hex chars (32 bytes). Check '
      + 'CONTROL_PLANE_ENCRYPTION_KEY.',
    );
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Decrypt a stored connection string.
 *
 * Throws on a bad key, a truncated value, or a failed auth tag. That is
 * deliberate: returning a partial or garbage string would hand a caller
 * something it might try to connect to.
 */
export function decryptConnectionString(ciphertextB64: string, key: Buffer): string {
  const buf = Buffer.from(ciphertextB64, 'base64');
  if (buf.length < IV_BYTES + TAG_BYTES + 1) {
    throw new Error('encrypted connection string is too short');
  }
  const decipher = createDecipheriv(ALGORITHM, key, buf.subarray(0, IV_BYTES));
  decipher.setAuthTag(buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  return Buffer.concat([
    decipher.update(buf.subarray(IV_BYTES + TAG_BYTES)),
    decipher.final(),
  ]).toString('utf8');
}

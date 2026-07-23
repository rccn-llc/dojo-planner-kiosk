import { Buffer } from 'node:buffer';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

const KEY_BYTES = 32; // AES-256

function loadKey(): Buffer {
  const hex = process.env.IQPRO_CONFIG_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error('IQPRO_CONFIG_ENCRYPTION_KEY is not set; cannot encrypt or decrypt IQPro secrets');
  }
  // Buffer.from(hex, 'hex') silently truncates odd-length / non-hex input, which
  // would otherwise surface as a cryptic "Invalid key length" at cipher time.
  // Validate up front so a misconfigured key fails with a clear message.
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length !== KEY_BYTES * 2) {
    throw new Error(`IQPRO_CONFIG_ENCRYPTION_KEY must be ${KEY_BYTES} bytes hex-encoded (${KEY_BYTES * 2} hex chars)`);
  }
  return Buffer.from(hex, 'hex');
}

export function encryptSecret(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

export function decryptSecret(ciphertextB64: string): string {
  const key = loadKey();
  const buf = Buffer.from(ciphertextB64, 'base64');
  if (buf.length < IV_BYTES + TAG_BYTES + 1) {
    throw new Error('encrypted payload is too short');
  }
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

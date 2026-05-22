import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from './crypto';

const TEST_KEY_HEX = randomBytes(32).toString('hex');

describe('crypto', () => {
  let savedKey: string | undefined;

  beforeEach(() => {
    savedKey = process.env.IQPRO_CONFIG_ENCRYPTION_KEY;
    process.env.IQPRO_CONFIG_ENCRYPTION_KEY = TEST_KEY_HEX;
  });

  afterEach(() => {
    if (savedKey === undefined) {
      delete process.env.IQPRO_CONFIG_ENCRYPTION_KEY;
    }
    else {
      process.env.IQPRO_CONFIG_ENCRYPTION_KEY = savedKey;
    }
  });

  it('round-trips a plaintext through encrypt → decrypt', () => {
    const plaintext = 'super-secret-iqpro-client-secret-value';
    const enc = encryptSecret(plaintext);
    expect(decryptSecret(enc)).toBe(plaintext);
  });

  it('produces a different ciphertext on each encrypt (fresh IV)', () => {
    const a = encryptSecret('same plaintext');
    const b = encryptSecret('same plaintext');
    expect(a).not.toBe(b);
  });

  it('throws when the auth tag is tampered', () => {
    const enc = encryptSecret('hello');
    const buf = Buffer.from(enc, 'base64');
    // Flip a bit inside the auth-tag region (bytes 12..28).
    buf[15] = buf[15]! ^ 0xFF;
    const tampered = buf.toString('base64');
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('throws when the encryption key env var is missing', () => {
    delete process.env.IQPRO_CONFIG_ENCRYPTION_KEY;
    expect(() => encryptSecret('x')).toThrow(/IQPRO_CONFIG_ENCRYPTION_KEY/);
    expect(() => decryptSecret('x')).toThrow(/IQPRO_CONFIG_ENCRYPTION_KEY/);
  });

  it('rejects payloads shorter than iv + tag + ciphertext', () => {
    expect(() => decryptSecret(Buffer.from('short').toString('base64'))).toThrow(/too short/);
  });
});

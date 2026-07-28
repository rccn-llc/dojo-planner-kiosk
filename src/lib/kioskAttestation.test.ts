import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signAttestationToken, verifyAttestationToken } from './kioskAttestation';

const TEST_SECRET = 'test-kiosk-attestation-secret-value';

describe('kioskAttestation', () => {
  let savedSecret: string | undefined;

  beforeEach(() => {
    savedSecret = process.env.KIOSK_ATTESTATION_SECRET;
    process.env.KIOSK_ATTESTATION_SECRET = TEST_SECRET;
  });

  afterEach(() => {
    if (savedSecret === undefined) {
      delete process.env.KIOSK_ATTESTATION_SECRET;
    }
    else {
      process.env.KIOSK_ATTESTATION_SECRET = savedSecret;
    }
    vi.useRealTimers();
  });

  it('verifies a freshly signed token for the same org', () => {
    const token = signAttestationToken('org_123');
    expect(verifyAttestationToken(token, 'org_123')).toBe(true);
  });

  it('rejects a token presented for a different org', () => {
    const token = signAttestationToken('org_123');
    expect(verifyAttestationToken(token, 'org_456')).toBe(false);
  });

  it('rejects missing / malformed tokens', () => {
    expect(verifyAttestationToken(undefined, 'org_123')).toBe(false);
    expect(verifyAttestationToken('', 'org_123')).toBe(false);
    expect(verifyAttestationToken('not-a-token', 'org_123')).toBe(false);
    expect(verifyAttestationToken('a.b.c', 'org_123')).toBe(false);
  });

  it('rejects a tampered signature', () => {
    const token = signAttestationToken('org_123');
    const [body] = token.split('.');
    const forged = `${body}.deadbeef`;
    expect(verifyAttestationToken(forged, 'org_123')).toBe(false);
  });

  it('rejects a token signed with a different secret', () => {
    const token = signAttestationToken('org_123');
    process.env.KIOSK_ATTESTATION_SECRET = 'a-different-secret';
    expect(verifyAttestationToken(token, 'org_123')).toBe(false);
  });

  it('rejects an expired token', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const token = signAttestationToken('org_123');
    // Advance beyond the 15-minute TTL.
    vi.setSystemTime(new Date('2026-01-01T00:16:00Z'));
    expect(verifyAttestationToken(token, 'org_123')).toBe(false);
  });
});

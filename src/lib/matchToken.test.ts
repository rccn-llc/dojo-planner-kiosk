import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_A = 'org_aaa';
const ORG_B = 'org_bbb';

async function load() {
  return import('./matchToken');
}

describe('matchToken', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.KIOSK_MATCH_TOKEN_SECRET = 'test_match_secret_not_real';
  });

  it('round-trips a token for the org that minted it', async () => {
    const { signMatchToken, verifyMatchToken } = await load();
    const token = signMatchToken({
      orgId: ORG_A,
      customerId: 'cust-1',
      customerPaymentMethodId: 'pm-1',
      paymentMethodType: 'card',
    });

    const payload = verifyMatchToken(ORG_A, token);

    expect(payload?.customerId).toBe('cust-1');
    expect(payload?.customerPaymentMethodId).toBe('pm-1');
    expect(payload?.orgId).toBe(ORG_A);
  });

  it('rEFUSES a token minted for a different organization', async () => {
    // The cross-tenant guard. Without the orgId claim this token verifies
    // cleanly at org B and charges a customer it has no relationship with —
    // the signature only proves WE minted it, not who it belongs to.
    const { signMatchToken, verifyMatchToken } = await load();
    const token = signMatchToken({
      orgId: ORG_A,
      customerId: 'cust-1',
      customerPaymentMethodId: 'pm-1',
      paymentMethodType: 'card',
    });

    expect(() => verifyMatchToken(ORG_B, token)).toThrow(/different organization/i);
  });

  it('rejects a token signed with another secret', async () => {
    const { signMatchToken } = await load();
    const token = signMatchToken({
      orgId: ORG_A,
      customerId: 'cust-1',
      customerPaymentMethodId: 'pm-1',
      paymentMethodType: 'card',
    });

    vi.resetModules();
    process.env.KIOSK_MATCH_TOKEN_SECRET = 'a-different-secret';
    const { verifyMatchToken } = await load();

    expect(() => verifyMatchToken(ORG_A, token)).toThrow(/signature/i);
  });

  it('rejects a tampered body', async () => {
    const { signMatchToken, verifyMatchToken } = await load();
    const token = signMatchToken({
      orgId: ORG_A,
      customerId: 'cust-1',
      customerPaymentMethodId: 'pm-1',
      paymentMethodType: 'card',
    });
    const [body, sig] = token.split('.');
    const forged = `${body}x.${sig}`;

    expect(() => verifyMatchToken(ORG_A, forged)).toThrow();
  });

  it('rejects an expired token', async () => {
    const { signMatchToken, verifyMatchToken } = await load();
    const token = signMatchToken({
      orgId: ORG_A,
      customerId: 'cust-1',
      customerPaymentMethodId: 'pm-1',
      paymentMethodType: 'card',
    });

    // 5-minute TTL; jump past it.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 6 * 60 * 1000);
    try {
      expect(() => verifyMatchToken(ORG_A, token)).toThrow(/expired/i);
    }
    finally {
      vi.useRealTimers();
    }
  });

  it('returns null for absent input — that is the no-saved-card path, not an error', async () => {
    const { verifyMatchToken } = await load();

    expect(verifyMatchToken(ORG_A, undefined)).toBeNull();
    expect(verifyMatchToken(ORG_A, '')).toBeNull();
  });

  it('rEQUIRES a dedicated secret in production', async () => {
    // Outside production a fixed dev value keeps setup to one command; in
    // production an unset secret must fail loudly rather than signing with a
    // predictable constant.
    vi.resetModules();
    delete process.env.KIOSK_MATCH_TOKEN_SECRET;
    vi.stubEnv('NODE_ENV', 'production');
    const { signMatchToken } = await load();

    expect(() => signMatchToken({
      orgId: ORG_A,
      customerId: 'c',
      customerPaymentMethodId: 'p',
      paymentMethodType: 'card',
    })).toThrow(/KIOSK_MATCH_TOKEN_SECRET/);

    vi.unstubAllEnvs();
  });
});

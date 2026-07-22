import type { IQProConfig } from './iqproConfig';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetOAuthTokenCache, resetProcessorsCache } from './iqpro';

function makeConfig(overrides: Partial<IQProConfig> = {}): IQProConfig {
  return {
    clientId: 'client-A',
    clientSecret: 'secret-A',
    gatewayId: 'gw-A',
    scope: 'scope',
    oauthUrl: 'https://oauth.example.test/token',
    baseUrl: 'https://api.example.test',
    source: 'org',
    ...overrides,
  };
}

const realFetch = globalThis.fetch;

beforeEach(() => {
  resetOAuthTokenCache();
  resetProcessorsCache();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('oAuth token cache', () => {
  it('caches per clientId — second call with same config does not re-fetch', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: 'tok-A', expires_in: 3600 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { iqproGet } = await import('./iqpro');
    // First call triggers OAuth then GET (2 fetches).
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: 'tok-A', expires_in: 3600 }), { status: 200 }),
    );
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    await iqproGet(makeConfig(), '/api/whatever');

    // Second call should reuse the cached token — only one new fetch (the GET).
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    await iqproGet(makeConfig(), '/api/whatever');

    // 2 OAuth + 2 GET = 4 normally; cache hit means 1 OAuth + 2 GET = 3.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('keeps tokens for different clientIds in separate cache slots', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: 'tok-A', expires_in: 3600 }), { status: 200 }),
    );
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: 'tok-B', expires_in: 3600 }), { status: 200 }),
    );
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));

    const { iqproGet } = await import('./iqpro');
    await iqproGet(makeConfig({ clientId: 'client-A' }), '/api/x');
    await iqproGet(makeConfig({ clientId: 'client-B' }), '/api/x');

    // Two distinct OAuth fetches expected — one per clientId.
    const oauthCalls = fetchMock.mock.calls.filter(args => String(args[0]).includes('oauth')).length;
    expect(oauthCalls).toBe(2);
  });

  it('resetOAuthTokenCache forces a re-fetch on the next call', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: 'tok-A', expires_in: 3600 }), { status: 200 }),
    );
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: 'tok-A2', expires_in: 3600 }), { status: 200 }),
    );
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));

    const { iqproGet } = await import('./iqpro');
    await iqproGet(makeConfig(), '/api/x');
    resetOAuthTokenCache();
    await iqproGet(makeConfig(), '/api/x');

    const oauthCalls = fetchMock.mock.calls.filter(args => String(args[0]).includes('oauth')).length;
    expect(oauthCalls).toBe(2);
  });
});

describe('getGatewayProcessors', () => {
  function mockGateway(processors: unknown[]) {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 }),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { processors } }), { status: 200 }),
    );
    return fetchMock;
  }

  it('prefers the processors flagged as default', async () => {
    mockGateway([
      { processorId: 'proc-first', isDefaultCard: false, isDefaultAch: false },
      { processorId: 'proc-card', isDefaultCard: true, isDefaultAch: false },
      { processorId: 'proc-ach', isDefaultCard: false, isDefaultAch: true },
    ]);

    const { getGatewayProcessors } = await import('./iqpro');

    await expect(getGatewayProcessors(makeConfig())).resolves.toEqual({
      cardProcessorId: 'proc-card',
      achProcessorId: 'proc-ach',
    });
  });

  // Regression: gateways with processors provisioned but none flagged default
  // used to resolve to null, which hard-failed every charge.
  it('falls back to the first processor when none is flagged default', async () => {
    mockGateway([
      { processorId: 'proc-only', isDefaultCard: false, isDefaultAch: false },
      { processorId: 'proc-second', isDefaultCard: false, isDefaultAch: false },
    ]);

    const { getGatewayProcessors } = await import('./iqpro');

    await expect(getGatewayProcessors(makeConfig())).resolves.toEqual({
      cardProcessorId: 'proc-only',
      achProcessorId: 'proc-only',
    });
  });

  it('falls back per kind — a card-only default still yields an ACH processor', async () => {
    mockGateway([
      { processorId: 'proc-first', isDefaultCard: false, isDefaultAch: false },
      { processorId: 'proc-card', isDefaultCard: true, isDefaultAch: false },
    ]);

    const { getGatewayProcessors } = await import('./iqpro');

    await expect(getGatewayProcessors(makeConfig())).resolves.toEqual({
      cardProcessorId: 'proc-card',
      achProcessorId: 'proc-first',
    });
  });

  it('returns nulls when the gateway has no processors at all', async () => {
    mockGateway([]);

    const { getGatewayProcessors } = await import('./iqpro');

    await expect(getGatewayProcessors(makeConfig())).resolves.toEqual({
      cardProcessorId: null,
      achProcessorId: null,
    });
  });

  it('caches per gatewayId — a second call does not re-fetch', async () => {
    const fetchMock = mockGateway([
      { processorId: 'proc-card', isDefaultCard: true, isDefaultAch: true },
    ]);

    const { getGatewayProcessors } = await import('./iqpro');
    await getGatewayProcessors(makeConfig());
    const callsAfterFirst = fetchMock.mock.calls.length;
    await getGatewayProcessors(makeConfig());

    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
  });
});

describe('match token', () => {
  it('signs and verifies a token round-trip using config.clientSecret', async () => {
    const { signMatchToken, verifyMatchToken } = await import('./iqpro');
    const config = makeConfig();
    const token = signMatchToken(config, {
      customerId: 'cust-1',
      customerPaymentMethodId: 'pm-1',
      paymentMethodType: 'card',
    });
    const payload = verifyMatchToken(config, token);
    expect(payload?.customerId).toBe('cust-1');
    expect(payload?.customerPaymentMethodId).toBe('pm-1');
  });

  it('rejects a token signed with a different clientSecret', async () => {
    const { signMatchToken, verifyMatchToken } = await import('./iqpro');
    const token = signMatchToken(makeConfig({ clientSecret: 'one' }), {
      customerId: 'cust-1',
      customerPaymentMethodId: 'pm-1',
      paymentMethodType: 'card',
    });
    expect(() => verifyMatchToken(makeConfig({ clientSecret: 'two' }), token)).toThrow();
  });

  it('returns null for absent input (not an error)', async () => {
    const { verifyMatchToken } = await import('./iqpro');
    expect(verifyMatchToken(makeConfig(), undefined)).toBeNull();
    expect(verifyMatchToken(makeConfig(), '')).toBeNull();
  });
});

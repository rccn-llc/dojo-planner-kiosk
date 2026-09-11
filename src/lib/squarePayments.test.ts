import { beforeEach, describe, expect, it, vi } from 'vitest';

const squarePost = vi.fn();

vi.mock('./square', async () => {
  const actual = await vi.importActual<typeof import('./square')>('./square');
  return { ...actual, squarePost: (...a: unknown[]) => squarePost(...a) };
});

const config = {
  applicationId: 'sandbox-app',
  locationId: 'L123',
  environment: 'sandbox' as const,
  accessToken: 'test_token_not_real',
};

const fees = {
  baseAmount: 100,
  taxAmount: 0,
  taxPct: 0,
  serviceFeeAmount: 3.75,
  serviceFeePct: 3.75,
  amount: 103.75,
};

/** Minimal drizzle stand-in for the plan-variation cache. */
function makeDb(selectRows: Array<{ planVariationId: string }>, insertRows: Array<{ planVariationId: string }>) {
  const queue = [...selectRows];
  return {
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve(queue.length ? [queue.shift()] : []) }) }) }),
    insert: () => ({
      values: () => ({ onConflictDoNothing: () => ({ returning: () => Promise.resolve(insertRows) }) }),
    }),
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('chargeSquareCard', () => {
  it('charges the SERVER-computed total, not a client figure', async () => {
    squarePost.mockResolvedValueOnce({ payment: { id: 'pay_1', status: 'COMPLETED' } });
    const { chargeSquareCard } = await import('./squarePayments');

    const result = await chargeSquareCard(config, { sourceId: 'cnon:x', fees, note: 'Store purchase' });

    expect(result).toMatchObject({ success: true, status: 'approved', transactionId: 'pay_1' });
    const [, path, body] = squarePost.mock.calls[0] as [unknown, string, Record<string, never>];

    expect(path).toBe('/v2/payments');
    expect(body.amount_money).toEqual({ amount: 10375, currency: 'USD' });
    expect(body.location_id).toBe('L123');
  });

  it('treats an uncaptured APPROVED as in-flight, never as settled', async () => {
    squarePost.mockResolvedValueOnce({ payment: { id: 'pay_2', status: 'APPROVED' } });
    const { chargeSquareCard } = await import('./squarePayments');

    const result = await chargeSquareCard(config, { sourceId: 'cnon:x', fees });

    expect(result.status).toBe('processing');
    expect(result.success).toBe(false);
  });

  it('rETURNS a decline rather than throwing, so the caller can record it', async () => {
    squarePost.mockRejectedValueOnce(new Error('Square /v2/payments failed (402)'));
    const { chargeSquareCard } = await import('./squarePayments');

    await expect(chargeSquareCard(config, { sourceId: 'cnon:x', fees }))
      .resolves
      .toMatchObject({ success: false, status: 'declined' });
  });

  it('generates a FRESH idempotency key per attempt', async () => {
    squarePost
      .mockResolvedValueOnce({ payment: { id: 'p1', status: 'COMPLETED' } })
      .mockResolvedValueOnce({ payment: { id: 'p2', status: 'COMPLETED' } });
    const { chargeSquareCard } = await import('./squarePayments');

    await chargeSquareCard(config, { sourceId: 'cnon:x', fees });
    await chargeSquareCard(config, { sourceId: 'cnon:x', fees });

    const [, , a] = squarePost.mock.calls[0] as [unknown, string, Record<string, string>];
    const [, , b] = squarePost.mock.calls[1] as [unknown, string, Record<string, string>];

    // Two deliberate identical purchases must NOT collapse into one charge.
    expect(a.idempotency_key).not.toBe(b.idempotency_key);
  });
});

describe('toSquareCadence', () => {
  it.each([
    ['Weekly', 'WEEKLY'],
    ['Monthly', 'MONTHLY'],
    ['Semi-Annual', 'EVERY_SIX_MONTHS'],
    ['Annual', 'ANNUAL'],
  ])('maps %s natively', async (input, expected) => {
    const { toSquareCadence } = await import('./squarePayments');

    expect(toSquareCadence(input)).toBe(expected);
  });

  it.each([[null], [undefined], ['None'], ['one-time']])('returns null for %s', async (input) => {
    const { toSquareCadence } = await import('./squarePayments');

    expect(toSquareCadence(input as string | null)).toBeNull();
  });
});

describe('createSquareSubscription', () => {
  const subParams = {
    planVariationId: 'var_1',
    customerId: 'cust_1',
    cardId: 'ccof:card_1',
    amount: 149,
    startDate: new Date('2026-03-04T18:00:00Z'),
  };

  it('aLWAYS sends card_id — omitting it silently invoices the member instead', async () => {
    squarePost.mockResolvedValueOnce({ subscription: { id: 'sub_1' } });
    const { createSquareSubscription } = await import('./squarePayments');

    await createSquareSubscription(config, subParams);

    const [, path, body] = squarePost.mock.calls[0] as [unknown, string, Record<string, never>];

    expect(path).toBe('/v2/subscriptions');
    expect(body.card_id).toBe('ccof:card_1');
    expect(body.price_override_money).toEqual({ amount: 14900, currency: 'USD' });
    expect(body.start_date).toBe('2026-03-04');
  });

  it('refuses rather than creating an invoice-billed subscription', async () => {
    const { createSquareSubscription } = await import('./squarePayments');

    await expect(createSquareSubscription(config, { ...subParams, cardId: '' }))
      .rejects
      .toThrow(/saved card/i);
    expect(squarePost).not.toHaveBeenCalled();
  });
});

describe('ensureSquarePlanVariation', () => {
  it('reuses a cached variation instead of minting a second catalog object', async () => {
    const { ensureSquarePlanVariation } = await import('./squarePayments');
    const db = makeDb([{ planVariationId: 'var_cached' }], []);

    await expect(ensureSquarePlanVariation(config, db, 'org_1', 'MONTHLY')).resolves.toBe('var_cached');
    expect(squarePost).not.toHaveBeenCalled();
  });

  it('creates the catalog object on a miss', async () => {
    squarePost.mockResolvedValueOnce({
      catalog_object: {
        id: 'plan_1',
        subscription_plan_data: { subscription_plan_variations: [{ id: 'var_new' }] },
      },
    });
    const { ensureSquarePlanVariation } = await import('./squarePayments');
    const db = makeDb([], [{ planVariationId: 'var_new' }]);

    await expect(ensureSquarePlanVariation(config, db, 'org_1', 'MONTHLY')).resolves.toBe('var_new');
  });

  it('yields to the winner when two charges race', async () => {
    // The unique index is the real guard; the loser must adopt the winner's
    // variation rather than failing the member's first charge.
    squarePost.mockResolvedValueOnce({
      catalog_object: {
        id: 'plan_1',
        subscription_plan_data: { subscription_plan_variations: [{ id: 'var_mine' }] },
      },
    });
    const { ensureSquarePlanVariation } = await import('./squarePayments');
    const db = makeDb([], []);
    // First select misses, insert conflicts (empty), second select finds theirs.
    let call = 0;
    (db as unknown as { select: () => unknown }).select = () => ({
      from: () => ({
        where: () => ({
          limit: () => {
            call += 1;
            return Promise.resolve(call === 1 ? [] : [{ planVariationId: 'var_theirs' }]);
          },
        }),
      }),
    });

    await expect(ensureSquarePlanVariation(config, db, 'org_1', 'MONTHLY')).resolves.toBe('var_theirs');
  });
});

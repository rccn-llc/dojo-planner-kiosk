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

async function load() {
  const { computeSquareFeeBreakdown } = await import('./squareFees');
  return computeSquareFeeBreakdown;
}

describe('computeSquareFeeBreakdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the amounts SQUARE computed, not locally derived ones', async () => {
    // The sandbox-verified shape: $100 at 8.375% tax + 3.75% service charge.
    // Note 838, not 869 — tax applies to the subtotal only and excludes the
    // service charge. Deriving it locally would get this wrong.
    squarePost.mockResolvedValueOnce({
      order: {
        total_money: { amount: 11213 },
        total_tax_money: { amount: 838 },
        total_service_charge_money: { amount: 375 },
      },
    });

    const compute = await load();
    const result = await compute(config, {
      baseAmount: 100,
      isTaxable: true,
      taxStatePct: 8.375,
      serviceFeePct: 3.75,
    });

    expect(result).toEqual({
      baseAmount: 100,
      taxAmount: 8.38,
      taxPct: 8.375,
      serviceFeeAmount: 3.75,
      serviceFeePct: 3.75,
      amount: 112.13,
    });
  });

  it('omits the tax block entirely for a non-taxable order', async () => {
    squarePost.mockResolvedValueOnce({
      order: { total_money: { amount: 10375 }, total_service_charge_money: { amount: 375 } },
    });

    const compute = await load();
    const result = await compute(config, {
      baseAmount: 100,
      isTaxable: false,
      taxStatePct: 8.375,
      serviceFeePct: 3.75,
    });

    const [, , body] = squarePost.mock.calls[0] as [unknown, string, { order: Record<string, unknown> }];

    expect(body.order).not.toHaveProperty('taxes');
    expect(result.taxAmount).toBe(0);
    expect(result.taxPct).toBe(0);
  });

  it('omits the tax block when the org rate is zero', async () => {
    squarePost.mockResolvedValueOnce({
      order: { total_money: { amount: 10375 }, total_service_charge_money: { amount: 375 } },
    });

    const compute = await load();
    await compute(config, { baseAmount: 100, isTaxable: true, taxStatePct: 0, serviceFeePct: 3.75 });

    const [, , body] = squarePost.mock.calls[0] as [unknown, string, { order: Record<string, unknown> }];

    expect(body.order).not.toHaveProperty('taxes');
  });

  it('prices against the org location and sends the rates, not the money', async () => {
    squarePost.mockResolvedValueOnce({ order: { total_money: { amount: 11213 } } });

    const compute = await load();
    await compute(config, { baseAmount: 100, isTaxable: true, taxStatePct: 8.375, serviceFeePct: 3.75 });

    const [, path, body] = squarePost.mock.calls[0] as [unknown, string, unknown];

    expect(path).toBe('/v2/orders/calculate');
    expect(body).toMatchObject({
      order: {
        location_id: 'L123',
        line_items: [{ base_price_money: { amount: 10000, currency: 'USD' } }],
        taxes: [{ percentage: '8.375' }],
        service_charges: [{ percentage: '3.75' }],
      },
    });
    // Never a precomputed money amount for the fee — Square owns that.
    const charge = (body as { order: { service_charges: Array<Record<string, unknown>> } }).order.service_charges[0];

    expect(charge).not.toHaveProperty('applied_money');
  });

  it('throws rather than inventing a total when Square returns none', async () => {
    squarePost.mockResolvedValueOnce({ order: {} });

    const compute = await load();

    await expect(compute(config, {
      baseAmount: 100,
      isTaxable: true,
      taxStatePct: 8.375,
      serviceFeePct: 3.75,
    })).rejects.toThrow(/no total/i);
  });
});

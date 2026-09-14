import { describe, expect, it } from 'vitest';
import { computeCouponDiscount } from './coupons';

const NO_CAP = { maxDiscountAmount: null };

describe('computeCouponDiscount', () => {
  it('computes a percentage discount', () => {
    // NEWYEAR25: the reported "$NaN" coupon. 25% off $100 is $25.
    expect(computeCouponDiscount({ discountType: 'percentage', discountValue: 25, ...NO_CAP }, 100)).toBe(25);
  });

  it('computes a fixed discount', () => {
    expect(computeCouponDiscount({ discountType: 'fixed', discountValue: 10, ...NO_CAP }, 49.99)).toBe(10);
  });

  it('rounds to whole cents', () => {
    // 33% of 49.99 = 16.4967 — must not leak a fractional cent into the charge.
    expect(computeCouponDiscount({ discountType: 'percentage', discountValue: 33, ...NO_CAP }, 49.99)).toBe(16.5);
  });

  it('respects maxDiscountAmount', () => {
    expect(computeCouponDiscount({ discountType: 'percentage', discountValue: 50, maxDiscountAmount: 15 }, 100)).toBe(15);
  });

  it('never exceeds the subtotal', () => {
    // A $50-off code on a $20 cart discounts $20, not $50 — otherwise the fee
    // base would go negative.
    expect(computeCouponDiscount({ discountType: 'fixed', discountValue: 50, ...NO_CAP }, 20)).toBe(20);
  });

  it('returns 0 for free_days — it is membership time, not money off a store order', () => {
    expect(computeCouponDiscount({ discountType: 'free_days', discountValue: 7, ...NO_CAP }, 100)).toBe(0);
  });

  it('returns 0 for an unknown discount type rather than guessing', () => {
    expect(computeCouponDiscount({ discountType: 'mystery', discountValue: 30, ...NO_CAP }, 100)).toBe(0);
  });

  it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])('returns 0 for a non-positive subtotal (%s)', (subtotal) => {
    expect(computeCouponDiscount({ discountType: 'percentage', discountValue: 25, ...NO_CAP }, subtotal)).toBe(0);
  });

  it('returns 0 for a non-positive discount value', () => {
    expect(computeCouponDiscount({ discountType: 'fixed', discountValue: 0, ...NO_CAP }, 100)).toBe(0);
  });

  it('never returns NaN — the defect this module exists to prevent', () => {
    const cases = [
      { discountType: 'percentage', discountValue: Number.NaN, ...NO_CAP },
      { discountType: 'fixed', discountValue: Number.NaN, ...NO_CAP },
      { discountType: 'percentage', discountValue: 25, maxDiscountAmount: Number.NaN },
    ];
    for (const c of cases) {
      expect(Number.isNaN(computeCouponDiscount(c, 100))).toBe(false);
    }
  });
});

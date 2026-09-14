/**
 * Coupon discount arithmetic, shared by `/api/coupons/validate` and the store
 * payment path so a code is worth exactly the same amount when it is previewed
 * in the cart and when it is charged.
 *
 * dojo-planner owns the coupon rows; `discount_type` is one of
 * `percentage` | `fixed` | `free_days` (see its marketing feature).
 */

interface CouponDiscountInput {
  discountType: string;
  discountValue: number;
  maxDiscountAmount: number | null;
}

/**
 * Money off `subtotal` for this coupon, rounded to whole cents and never more
 * than the subtotal itself.
 *
 * `free_days` returns 0: it grants membership time rather than money off a
 * store order, and silently treating its `discountValue` (a day count) as
 * dollars would take an arbitrary amount off the till.
 */
export function computeCouponDiscount(coupon: CouponDiscountInput, subtotal: number): number {
  if (!Number.isFinite(subtotal) || subtotal <= 0) {
    return 0;
  }
  if (!Number.isFinite(coupon.discountValue) || coupon.discountValue <= 0) {
    return 0;
  }

  let raw: number;
  switch (coupon.discountType) {
    case 'percentage':
      raw = subtotal * (coupon.discountValue / 100);
      break;
    case 'fixed':
      raw = coupon.discountValue;
      break;
    // 'free_days' (and anything dojo-planner adds later) is not a store-order
    // discount. Refuse rather than guess.
    default:
      return 0;
  }

  if (coupon.maxDiscountAmount !== null && Number.isFinite(coupon.maxDiscountAmount)) {
    raw = Math.min(raw, coupon.maxDiscountAmount);
  }

  return Math.round(Math.min(raw, subtotal) * 100) / 100;
}

import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { resolveOrgIdFromRequest } from '@/lib/clerk';
import { computeCouponDiscount } from '@/lib/coupons';
import { coupon } from '@/lib/memberSchema';
import { getDatabaseForOrg } from '@/lib/tenantDirectory';

export async function POST(request: Request) {
  try {
    const orgId = (await resolveOrgIdFromRequest(request)) ?? process.env.ORGANIZATION_ID ?? null;
    if (!orgId) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 400 });
    }

    const body = await request.json() as { code?: string; subtotal?: number };
    const code = body.code?.trim().toUpperCase() ?? '';
    const subtotal = typeof body.subtotal === 'number' && Number.isFinite(body.subtotal) && body.subtotal > 0
      ? body.subtotal
      : 0;

    if (!code) {
      return NextResponse.json({ valid: false, error: 'Please enter a discount code' });
    }

    const db = await getDatabaseForOrg(orgId);

    // Look the code up WITHOUT filtering on status, so an inactive code can be
    // reported as inactive rather than as "invalid". The status check happens
    // below; a code that does not exist at all is the only "Invalid" case.
    const coupons = await db
      .select()
      .from(coupon)
      .where(
        and(
          eq(coupon.organizationId, orgId),
          eq(coupon.code, code),
        ),
      )
      .limit(1);

    const c = coupons[0];
    if (!c) {
      return NextResponse.json({ valid: false, error: 'Invalid discount code' });
    }

    if (c.status !== 'active') {
      return NextResponse.json({ valid: false, error: 'This discount code is no longer active' });
    }

    const now = new Date();
    if (c.validFrom && c.validFrom > now) {
      return NextResponse.json({ valid: false, error: 'This discount code is not active yet' });
    }
    if (c.validUntil && c.validUntil < now) {
      return NextResponse.json({ valid: false, error: 'This discount code has expired' });
    }

    // Check usage limit
    if (c.usageLimit !== null && (c.usageCount ?? 0) >= c.usageLimit) {
      return NextResponse.json({ valid: false, error: 'This discount code has reached its usage limit' });
    }

    if (c.minPurchaseAmount !== null && subtotal < c.minPurchaseAmount) {
      return NextResponse.json({
        valid: false,
        error: `This code requires a minimum purchase of $${c.minPurchaseAmount.toFixed(2)}`,
      });
    }

    // ⚠️ The client CANNOT compute this itself. It used to read a
    // `discountAmount` field that this route never returned, so the cart
    // subtracted `undefined` and rendered "$NaN". The money math belongs here,
    // where the coupon row is, and the response now carries the number the
    // client actually applies.
    const discountAmount = computeCouponDiscount(
      {
        discountType: c.discountType,
        discountValue: c.discountValue,
        maxDiscountAmount: c.maxDiscountAmount,
      },
      subtotal,
    );

    if (discountAmount <= 0) {
      return NextResponse.json({ valid: false, error: 'This discount code does not apply to your cart' });
    }

    return NextResponse.json({
      valid: true,
      discountAmount,
      coupon: {
        id: c.id,
        code: c.code,
        name: c.name,
        discountType: c.discountType,
        discountValue: c.discountValue,
        applicableTo: c.applicableTo,
        minPurchaseAmount: c.minPurchaseAmount,
        maxDiscountAmount: c.maxDiscountAmount,
      },
    });
  }
  catch (error) {
    console.error('[coupons/validate] Error:', error);
    return NextResponse.json({ error: 'Validation failed' }, { status: 500 });
  }
}

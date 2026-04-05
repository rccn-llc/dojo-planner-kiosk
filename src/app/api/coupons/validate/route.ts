import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database';
import { coupon } from '@/lib/memberSchema';

export async function POST(request: Request) {
  try {
    const orgId = process.env.ORGANIZATION_ID;
    if (!orgId) {
      return NextResponse.json({ error: 'Organization context not available' }, { status: 500 });
    }

    const body = await request.json() as { code?: string };
    const code = body.code?.trim().toUpperCase() ?? '';

    if (!code) {
      return NextResponse.json({ valid: false, error: 'Code is required' });
    }

    const db = getDatabase();

    const coupons = await db
      .select()
      .from(coupon)
      .where(
        and(
          eq(coupon.organizationId, orgId),
          eq(coupon.code, code),
          eq(coupon.status, 'active'),
        ),
      )
      .limit(1);

    const c = coupons[0];
    if (!c) {
      return NextResponse.json({ valid: false, error: 'Invalid coupon code' });
    }

    // Check expiry
    if (c.validUntil && c.validUntil < new Date()) {
      return NextResponse.json({ valid: false, error: 'Coupon has expired' });
    }

    // Check usage limit
    if (c.usageLimit !== null && (c.usageCount ?? 0) >= c.usageLimit) {
      return NextResponse.json({ valid: false, error: 'Coupon usage limit reached' });
    }

    return NextResponse.json({
      valid: true,
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

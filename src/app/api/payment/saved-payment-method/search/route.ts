import { and, eq, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database';
import { validateDevice } from '@/lib/deviceAuth';
import { isIQProConfigured, searchCustomersByPhone, signMatchToken } from '@/lib/iqpro';
import { member } from '@/lib/memberSchema';
import { isValidPhoneNumber, sanitizePhoneInput } from '@/lib/utils';

export interface SavedPaymentMethodMatch {
  matchToken: string;
  fullName: string;
}

export interface SavedPaymentMethodSearchResponse {
  matches: SavedPaymentMethodMatch[];
  error?: string;
}

/**
 * GET /api/payment/saved-payment-method/search?phone=...
 *
 * Returns IQPro vaulted customers for whom we can confirm BOTH:
 *   1. They are a member of THIS org in our local DB.
 *   2. They have a vaulted payment method in IQPro.
 *
 * IQPro's customer vault is shared across orgs and may be out of sync with
 * the local member table, so we trust the vault for "has a saved PM" and
 * the local DB for "belongs to this org". The join key is the member's
 * iqproCustomerId column, populated when the member's IQPro customer record
 * was created during signup.
 *
 * The chooser uses the LOCAL member's firstName + lastName (more
 * authoritative than IQPro's `name` field, which can be stale or differ).
 *
 * customerId / paymentMethodId never leave the server — they're packed into
 * a short-lived signed match token the client passes back at charge time.
 */
export async function GET(request: Request) {
  if (!isIQProConfigured()) {
    return NextResponse.json<SavedPaymentMethodSearchResponse>(
      { matches: [], error: 'Payment processing is not configured' },
      { status: 503 },
    );
  }

  const device = await validateDevice(request);
  const orgId = device?.orgId ?? process.env.ORGANIZATION_ID;
  if (!orgId) {
    return NextResponse.json<SavedPaymentMethodSearchResponse>(
      { matches: [], error: 'Organization context not available' },
      { status: 500 },
    );
  }

  const url = new URL(request.url);
  const rawPhone = url.searchParams.get('phone') ?? '';
  const phone = sanitizePhoneInput(rawPhone);

  if (!isValidPhoneNumber(phone)) {
    return NextResponse.json<SavedPaymentMethodSearchResponse>(
      { matches: [], error: 'A valid 10-digit phone number is required' },
      { status: 400 },
    );
  }

  try {
    const vaultMatches = await searchCustomersByPhone(phone);
    if (vaultMatches.length === 0) {
      return NextResponse.json<SavedPaymentMethodSearchResponse>({ matches: [] });
    }

    const customerIds = vaultMatches.map(m => m.customerId);

    const db = getDatabase();
    const localMembers = await db
      .select({
        iqproCustomerId: member.iqproCustomerId,
        firstName: member.firstName,
        lastName: member.lastName,
      })
      .from(member)
      .where(
        and(
          eq(member.organizationId, orgId),
          inArray(member.iqproCustomerId, customerIds),
        ),
      );

    const memberByCustomerId = new Map<string, { firstName: string; lastName: string }>();
    for (const m of localMembers) {
      if (m.iqproCustomerId) {
        memberByCustomerId.set(m.iqproCustomerId, {
          firstName: m.firstName,
          lastName: m.lastName,
        });
      }
    }

    const matches: SavedPaymentMethodMatch[] = [];
    for (const vm of vaultMatches) {
      const local = memberByCustomerId.get(vm.customerId);
      if (!local) {
        continue;
      }
      matches.push({
        matchToken: signMatchToken({
          customerId: vm.customerId,
          customerPaymentMethodId: vm.customerPaymentMethodId,
          paymentMethodType: vm.paymentMethodType,
          cardMaskedNumber: vm.cardMaskedNumber,
        }),
        fullName: `${local.firstName} ${local.lastName}`.trim(),
      });
    }

    return NextResponse.json<SavedPaymentMethodSearchResponse>({ matches });
  }
  catch (err) {
    console.error('[payment/saved-payment-method/search] failed:', err);
    return NextResponse.json<SavedPaymentMethodSearchResponse>(
      { matches: [], error: 'Search failed' },
      { status: 500 },
    );
  }
}

import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { resolveOrgIdFromRequest } from '@/lib/clerk';
import { searchCustomersByPhone } from '@/lib/iqpro';
import { resolveIQProConfig, resolveSquareServerConfig } from '@/lib/iqproConfig';
import { signMatchToken } from '@/lib/matchToken';
import { member, paymentMethod } from '@/lib/memberSchema';
import { phoneDigitsMatch } from '@/lib/phoneQuery';
import { clientIp, rateLimit } from '@/lib/rateLimit';
import { getDatabaseForOrg } from '@/lib/tenantDirectory';
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
 * providerCustomerId column, populated when the member's IQPro customer record
 * was created during signup.
 *
 * The chooser uses the LOCAL member's firstName + lastName (more
 * authoritative than IQPro's `name` field, which can be stale or differ).
 *
 * customerId / paymentMethodId never leave the server — they're packed into
 * a short-lived signed match token the client passes back at charge time.
 */
export async function GET(request: Request) {
  const orgId = await resolveOrgIdFromRequest(request);
  if (!orgId) {
    return NextResponse.json<SavedPaymentMethodSearchResponse>(
      { matches: [], error: 'Organization not found. Pass ?org=<slug>.' },
      { status: 400 },
    );
  }

  // Each call hits IQPro's vault search; throttle per IP to prevent enumeration
  // / cost amplification.
  const allowed = await rateLimit(`saved-pm-search:${clientIp(request)}`, 30, 60 * 1000);
  if (!allowed) {
    return NextResponse.json<SavedPaymentMethodSearchResponse>(
      { matches: [], error: 'Too many requests' },
      { status: 429 },
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

  // ── Square ────────────────────────────────────────────────────────────────
  //
  // No provider search. `member.provider_customer_id` and
  // `payment_method.provider_payment_method_id` are already stored locally and
  // are provider-neutral, so the saved card is found with a join — which is
  // both faster and the reason this branch needs no Square API call at all.
  const squareConfig = await resolveSquareServerConfig(orgId);
  if (squareConfig) {
    try {
      const db = await getDatabaseForOrg(orgId);
      const rows = await db
        .select({
          customerId: member.providerCustomerId,
          paymentMethodId: paymentMethod.providerPaymentMethodId,
          last4: paymentMethod.last4,
          firstName: member.firstName,
          lastName: member.lastName,
        })
        .from(member)
        .innerJoin(paymentMethod, eq(paymentMethod.memberId, member.id))
        .where(and(
          eq(member.organizationId, orgId),
          // Digit-normalized comparison — see [[phoneQuery]]. Enumerating a
          // few historical formats missed every other shape in the table.
          phoneDigitsMatch(member.phone, phone),
          isNotNull(member.providerCustomerId),
          isNotNull(paymentMethod.providerPaymentMethodId),
          // Square is card-only: it cannot store a bank account and charge it
          // later, so an ACH row here could never be charged.
          eq(paymentMethod.type, 'card'),
        ))
        .limit(10);

      const matches: SavedPaymentMethodMatch[] = rows
        .filter(r => r.customerId && r.paymentMethodId)
        .map(r => ({
          matchToken: signMatchToken({
            orgId,
            customerId: r.customerId!,
            customerPaymentMethodId: r.paymentMethodId!,
            paymentMethodType: 'card',
            cardMaskedNumber: r.last4 ?? undefined,
          }),
          fullName: `${r.firstName} ${r.lastName}`.trim(),
        }));

      return NextResponse.json<SavedPaymentMethodSearchResponse>({ matches });
    }
    catch (err) {
      console.error('[payment/saved-payment-method/search] Square lookup failed:', err);
      return NextResponse.json<SavedPaymentMethodSearchResponse>(
        { matches: [], error: 'Search failed' },
        { status: 500 },
      );
    }
  }

  // ── IQPro ─────────────────────────────────────────────────────────────────
  const iqproConfig = await resolveIQProConfig(orgId);
  if (!iqproConfig) {
    return NextResponse.json<SavedPaymentMethodSearchResponse>(
      { matches: [], error: 'Payment processing is not configured' },
      { status: 503 },
    );
  }

  try {
    const vaultMatches = await searchCustomersByPhone(iqproConfig, phone);
    if (vaultMatches.length === 0) {
      return NextResponse.json<SavedPaymentMethodSearchResponse>({ matches: [] });
    }

    const customerIds = vaultMatches.map(m => m.customerId);

    const db = await getDatabaseForOrg(orgId);
    const localMembers = await db
      .select({
        providerCustomerId: member.providerCustomerId,
        firstName: member.firstName,
        lastName: member.lastName,
      })
      .from(member)
      .where(
        and(
          eq(member.organizationId, orgId),
          inArray(member.providerCustomerId, customerIds),
        ),
      );

    const memberByCustomerId = new Map<string, { firstName: string; lastName: string }>();
    for (const m of localMembers) {
      if (m.providerCustomerId) {
        memberByCustomerId.set(m.providerCustomerId, {
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
          orgId,
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

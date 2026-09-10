/**
 * Square charge helpers for the kiosk.
 *
 * Companion to `squareFees.ts`. Together they are the Square half of the
 * kiosk's money path; `iqpro.ts` remains the IQPro half, and the routes branch
 * on which config an org resolves.
 *
 * ⚠️ Card-only, matching the platform-wide rule. Square cannot store a bank
 * account and charge it later, so a Square org's kiosk offers no ACH — the
 * callers reject it before reaching here.
 */

import type { SquareServerConfig } from './iqproConfig';
import type { getDatabaseForOrg } from './tenantDirectory';
import type { FeeBreakdown } from './types';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { squarePlanVariation } from './memberSchema';
import { squarePost, toMinorUnits } from './square';

/** The org-scoped drizzle handle these helpers operate on. */
type KioskDb = Awaited<ReturnType<typeof getDatabaseForOrg>>;

export interface SquareChargeResult {
  success: boolean;
  status: 'approved' | 'declined' | 'processing';
  transactionId?: string;
  error?: string;
}

/**
 * Square payment status → our three-state result.
 *
 * APPROVED means authorised but not captured, which only happens when
 * `autocomplete: false`. We always autocomplete, so treat it as in-flight
 * rather than settled.
 */
function mapPaymentStatus(status: string | undefined): SquareChargeResult['status'] {
  switch (status) {
    case 'COMPLETED':
      return 'approved';
    case 'APPROVED':
    case 'PENDING':
      return 'processing';
    default:
      return 'declined';
  }
}

/**
 * Charge a card nonce from the Web Payments SDK.
 *
 * ⚠️ The amount charged is `fees.amount` — the total Square itself computed in
 * `computeSquareFeeBreakdown`, already re-validated against the server's own
 * catalog pricing by the caller. Never a client-supplied figure.
 *
 * An `idempotency_key` is generated per attempt rather than derived from the
 * params: two deliberate identical purchases (the same member buying the same
 * item twice) must not collapse into one charge.
 */
export async function chargeSquareCard(
  config: SquareServerConfig,
  params: {
    sourceId: string;
    fees: FeeBreakdown;
    note?: string;
    buyerEmail?: string;
  },
): Promise<SquareChargeResult> {
  try {
    const res = await squarePost<{ payment?: { id?: string; status?: string } }>(
      config,
      '/v2/payments',
      {
        idempotency_key: randomUUID(),
        source_id: params.sourceId,
        location_id: config.locationId,
        amount_money: { amount: toMinorUnits(params.fees.amount), currency: 'USD' },
        ...(params.note ? { note: params.note.slice(0, 500) } : {}),
        ...(params.buyerEmail ? { buyer_email_address: params.buyerEmail } : {}),
      },
    );

    const status = mapPaymentStatus(res.payment?.status);
    return {
      success: status === 'approved',
      status,
      transactionId: res.payment?.id,
      ...(status === 'declined'
        ? { error: `Square declined the payment (${res.payment?.status ?? 'unknown'}).` }
        : {}),
    };
  }
  catch (error) {
    console.error('[Square] charge failed', error);
    return {
      success: false,
      status: 'declined',
      error: error instanceof Error ? error.message : 'Square payment failed.',
    };
  }
}

/**
 * Our plan `frequency` vocabulary → Square catalog cadence.
 *
 * All four map natively, including semi-annual — which on IQPro has to be
 * emulated with a yearly billing period and two `monthsOfYear` entries.
 * Returns null for a non-recurring plan (null / 'None' / one-time), which the
 * caller routes to a one-time charge instead.
 */
export function toSquareCadence(frequency: string | null | undefined): string | null {
  switch ((frequency ?? '').toLowerCase()) {
    case 'weekly':
      return 'WEEKLY';
    case 'monthly':
      return 'MONTHLY';
    case 'semi-annual':
      return 'EVERY_SIX_MONTHS';
    case 'annual':
      return 'ANNUAL';
    default:
      return null;
  }
}

/**
 * Resolve this org's Square catalog plan variation for a cadence, creating it
 * on first use.
 *
 * A read-through cache over `square_plan_variation`, bounded at FOUR rows per
 * org — one per cadence, not one per membership plan. That is only viable
 * because `price_override_money` is set per subscription (sandbox-verified: a
 * $50 variation produced a $73.50 subscription), so the variation carries no
 * price anyone depends on and never needs syncing when a plan's price changes.
 */
export async function ensureSquarePlanVariation(
  config: SquareServerConfig,
  db: KioskDb,
  organizationId: string,
  cadence: string,
): Promise<string> {
  const existing = await db
    .select({ planVariationId: squarePlanVariation.planVariationId })
    .from(squarePlanVariation)
    .where(and(
      eq(squarePlanVariation.organizationId, organizationId),
      eq(squarePlanVariation.cadence, cadence),
    ))
    .limit(1);

  const cached = existing[0]?.planVariationId;
  if (cached) {
    return cached;
  }

  // Square requires the plan and its variation to be created together, the
  // variation referencing the plan by a '#'-prefixed temporary id that Square
  // resolves server-side.
  const res = await squarePost<{
    catalog_object?: {
      id?: string;
      subscription_plan_data?: { subscription_plan_variations?: Array<{ id?: string }> };
    };
  }>(config, '/v2/catalog/object', {
    idempotency_key: randomUUID(),
    object: {
      id: '#plan',
      type: 'SUBSCRIPTION_PLAN',
      subscription_plan_data: {
        name: `Dojo Planner membership (${cadence})`,
        subscription_plan_variations: [
          {
            id: '#variation',
            type: 'SUBSCRIPTION_PLAN_VARIATION',
            subscription_plan_variation_data: {
              name: `Dojo Planner ${cadence}`,
              phases: [{ cadence, ordinal: 0 }],
            },
          },
        ],
      },
    },
  });

  const planId = res.catalog_object?.id;
  const planVariationId = res.catalog_object?.subscription_plan_data?.subscription_plan_variations?.[0]?.id;
  if (!planVariationId) {
    throw new Error('Square created a subscription plan but returned no variation id.');
  }

  const inserted = await db
    .insert(squarePlanVariation)
    .values({
      id: randomUUID(),
      organizationId,
      cadence,
      planVariationId,
      planId: planId ?? null,
    })
    .onConflictDoNothing({ target: [squarePlanVariation.organizationId, squarePlanVariation.cadence] })
    .returning({ planVariationId: squarePlanVariation.planVariationId });

  if (inserted[0]?.planVariationId) {
    return inserted[0].planVariationId;
  }

  // Lost a race: another request inserted first. Adopt ITS variation so both
  // agree on one catalog object. The one we just created in Square is orphaned
  // but inert — a plan variation carries no money.
  const winner = await db
    .select({ planVariationId: squarePlanVariation.planVariationId })
    .from(squarePlanVariation)
    .where(and(
      eq(squarePlanVariation.organizationId, organizationId),
      eq(squarePlanVariation.cadence, cadence),
    ))
    .limit(1);

  const raced = winner[0]?.planVariationId;
  if (!raced) {
    throw new Error('Square plan variation insert conflicted but no existing row was found.');
  }
  return raced;
}

/**
 * Create a Square customer and attach a card from the Web Payments SDK nonce.
 *
 * ⚠️ Square rejects a subscription whose customer has no email address
 * (`CUSTOMER_MISSING_EMAIL`), so the email is required here rather than
 * surfacing as a confusing failure one step later.
 */
export async function createSquareCustomerWithCard(
  config: SquareServerConfig,
  params: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    sourceId: string;
    referenceId?: string;
  },
): Promise<{ customerId: string; cardId: string; last4?: string }> {
  const customerBody: Record<string, unknown> = {
    idempotency_key: randomUUID(),
    given_name: params.firstName,
    family_name: params.lastName,
    email_address: params.email,
    ...(params.referenceId ? { reference_id: params.referenceId } : {}),
  };
  if (params.phone) {
    customerBody.phone_number = params.phone;
  }

  let customerRes: { customer?: { id?: string } };
  try {
    customerRes = await squarePost<{ customer?: { id?: string } }>(config, '/v2/customers', customerBody);
  }
  catch (error) {
    // Square validates that a phone number is DIALABLE, not merely well-formed
    // — every format of a 555-prefix number is rejected. A phone is optional
    // contact data, so a typo must not fail the whole charge.
    const isBadPhone = error instanceof Error && /INVALID_PHONE_NUMBER/.test(error.message);
    if (!isBadPhone || !params.phone) {
      throw error;
    }
    delete customerBody.phone_number;
    customerBody.idempotency_key = randomUUID();
    customerRes = await squarePost<{ customer?: { id?: string } }>(config, '/v2/customers', customerBody);
  }

  const customerId = customerRes.customer?.id;
  if (!customerId) {
    throw new Error('Square created a customer but returned no id.');
  }

  const cardRes = await squarePost<{ card?: { id?: string; last_4?: string } }>(config, '/v2/cards', {
    idempotency_key: randomUUID(),
    source_id: params.sourceId,
    card: { customer_id: customerId },
  });

  const cardId = cardRes.card?.id;
  if (!cardId) {
    throw new Error('Square created a card but returned no id.');
  }

  // Square returns last_4 itself; the browser never sees a BIN, which is why
  // the client sends no cardFirstSix/cardLastFour on this path.
  return { customerId, cardId, last4: cardRes.card?.last_4 };
}

/**
 * Create a recurring subscription against a saved card.
 *
 * ⚠️ `card_id` must ALWAYS be sent. Omitting it does not fail — Square
 * silently switches to emailing the member an invoice, so autopay would stop
 * collecting with no error anywhere. This refuses rather than creating an
 * invoice-billed subscription.
 *
 * `price_override_money` is what lets one catalog variation serve every member
 * on a cadence, and `tax_percentage` is applied per subscription so Square
 * computes each cycle's tax itself.
 */
export async function createSquareSubscription(
  config: SquareServerConfig,
  params: {
    planVariationId: string;
    customerId: string;
    cardId: string;
    amount: number;
    startDate: Date;
    taxPct?: number;
  },
): Promise<{ subscriptionId: string }> {
  if (!params.cardId) {
    throw new Error('Square requires a saved card to create a subscription.');
  }

  const res = await squarePost<{ subscription?: { id?: string } }>(config, '/v2/subscriptions', {
    idempotency_key: randomUUID(),
    location_id: config.locationId,
    plan_variation_id: params.planVariationId,
    customer_id: params.customerId,
    card_id: params.cardId,
    start_date: params.startDate.toISOString().slice(0, 10),
    price_override_money: { amount: toMinorUnits(params.amount), currency: 'USD' },
    ...(params.taxPct && params.taxPct > 0 ? { tax_percentage: String(params.taxPct) } : {}),
  });

  const subscriptionId = res.subscription?.id;
  if (!subscriptionId) {
    throw new Error('Square created a subscription but returned no id.');
  }
  return { subscriptionId };
}

import type { Buffer } from 'node:buffer';
import type { FeeBreakdown } from '@/lib/types';
import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { resolveOrgIdFromRequest } from '@/lib/clerk';
import { getDatabase } from '@/lib/database';
import { sendMembershipConfirmation } from '@/lib/email';
import { assertTransactionApproved, buildServiceFeeAdjustment, computeFeeBreakdown, getGatewayProcessors, iqproGet, iqproPost, tokenizeAch } from '@/lib/iqpro';
import { getOrganizationServiceFeePct, resolveIQProConfig } from '@/lib/iqproConfig';
import {
  address,
  member,
  memberMembership,
  membershipPlan,
  membershipWaiver,
  paymentMethod,
  signedWaiver,
  transaction,
  waiverTemplate,
} from '@/lib/memberSchema';
import { generatePdfFilename, generateWaiverPdfBuffer } from '@/lib/waiverPdf';

interface MembershipPaymentBody {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  addressLine2?: string;
  city: string;
  state: string;
  zip: string;
  paymentMethod: 'card' | 'ach';
  cardToken?: string;
  cardFirstSix?: string;
  cardLastFour?: string;
  cardExpiry?: string;
  cardholderName?: string;
  achAccountHolder?: string;
  achRoutingNumber?: string;
  achAccountNumber?: string;
  achAccountType?: 'Checking' | 'Savings';
  country?: string;
  planId: string;
  planName: string;
  planPrice: number;
  planFrequency: string;
  planContractLength?: string;
  billingType: string;
  feeBreakdown: FeeBreakdown | null;
  programName: string;
  dateOfBirth?: string;
  guardianFirstName?: string;
  guardianLastName?: string;
  guardianEmail?: string;
  guardianRelationship?: string;
  waiverSignature: string;
  signedByName: string;
  waiverContent: string;
  organizationName: string;
  organizationId: string;
  couponCode?: string;
  couponDiscount?: number;
  existingMemberId?: string | null;
  convertingTrialMembershipId?: string | null;
}

function sanitizePhone(phone?: string): string | undefined {
  if (!phone) {
    return undefined;
  }
  const digits = phone.replace(/\D/g, '');
  const trimmed = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return trimmed.slice(0, 10) || undefined;
}

function sanitizeForLog(value: unknown): string {
  return String(value).replace(/[\r\n]+/g, '');
}

// What the (side-effect-free) IQPro payment stage produces for the DB stage.
interface PaymentResult {
  iqproCustomerId: string;
  paymentMethodId: string;
  iqproSubscriptionId?: string;
  txId: string;
  achAccountType?: 'Checking' | 'Savings';
  fees: Awaited<ReturnType<typeof computeFeeBreakdown>>;
}

export async function POST(request: Request) {
  try {
    const orgId = await resolveOrgIdFromRequest(request);
    if (!orgId) {
      return NextResponse.json({ success: false, error: 'Organization not found. Pass ?org=<slug>.' }, { status: 400 });
    }

    const iqproConfig = await resolveIQProConfig(orgId);
    // iqproConfig may be null when this org has no IQPro credentials; the
    // payment stage below is gated on it. We continue so the member/waiver
    // records still write for $0 plans / plans without payment.

    const body = await request.json() as MembershipPaymentBody;

    const db = getDatabase();
    const gatewayId = iqproConfig?.gatewayId;
    const now = new Date();

    // Fetch the plan from the database
    const plans = await db
      .select({
        id: membershipPlan.id,
        name: membershipPlan.name,
        price: membershipPlan.price,
        signupFee: membershipPlan.signupFee,
        frequency: membershipPlan.frequency,
        contractLength: membershipPlan.contractLength,
        isTrial: membershipPlan.isTrial,
      })
      .from(membershipPlan)
      .where(and(eq(membershipPlan.id, body.planId), eq(membershipPlan.organizationId, orgId)))
      .limit(1);

    const plan = plans[0];
    if (!plan) {
      return NextResponse.json({ success: false, error: 'Membership plan not found' }, { status: 404 });
    }

    // Validate ACH fields up front (mirrors the card guard inside the payment
    // stage) so a malformed request 400s rather than throwing mid-charge.
    if (plan.price > 0 && iqproConfig && gatewayId && body.paymentMethod === 'ach') {
      if (!body.achAccountNumber || !body.achRoutingNumber) {
        return NextResponse.json({ success: false, error: 'Bank account and routing number are required.' }, { status: 400 });
      }
    }

    const phone = sanitizePhone(body.phone);
    const memberId = body.existingMemberId ?? randomUUID();
    const memberMembershipId = randomUUID();
    const isRecurring = body.billingType === 'autopay';

    // Resolve the waiver template (linked → org default) — reads only.
    const wt = await resolveWaiverTemplate(db, orgId, body.planId);

    // ── Stage 1: payment (NO database writes) ────────────────────────────────
    // Nothing is persisted until the charge is approved, so a decline can never
    // leave a phantom active member/membership/waiver behind.
    let payment: PaymentResult | undefined;

    if (plan.price > 0 && iqproConfig && gatewayId) {
      try {
        payment = await runPayment({
          config: iqproConfig,
          gatewayId,
          body,
          plan,
          phone,
          isRecurring,
          now,
        });
      }
      catch (payErr) {
        console.error('[payment/membership] Payment error:', sanitizeForLog(payErr instanceof Error ? payErr.message : String(payErr)));
        // Generic, non-200 response — never forward the raw IQPro/processor
        // string (it can carry gateway ids / processor bodies) to the client.
        return NextResponse.json(
          { success: false, status: 'declined', error: 'Payment could not be processed. Please try again.' },
          { status: 402 },
        );
      }
    }

    // ── Stage 2: persist everything atomically ───────────────────────────────
    await db.transaction(async (tx) => {
      if (body.existingMemberId) {
        await tx.update(member)
          .set({
            firstName: body.firstName,
            lastName: body.lastName,
            email: body.email,
            phone: phone ?? null,
            dateOfBirth: body.dateOfBirth ? new Date(`${body.dateOfBirth}T12:00:00`) : undefined,
            status: 'active',
            statusChangedAt: now,
            updatedAt: now,
            ...(payment?.iqproCustomerId ? { iqproCustomerId: payment.iqproCustomerId } : {}),
          })
          .where(and(eq(member.id, body.existingMemberId), eq(member.organizationId, orgId)));
      }
      else {
        await tx.insert(member).values({
          id: memberId,
          organizationId: orgId,
          firstName: body.firstName,
          lastName: body.lastName,
          email: body.email,
          phone: phone ?? null,
          memberType: 'individual',
          dateOfBirth: body.dateOfBirth ? new Date(`${body.dateOfBirth}T12:00:00`) : undefined,
          status: 'active',
          statusChangedAt: now,
          ...(payment?.iqproCustomerId ? { iqproCustomerId: payment.iqproCustomerId } : {}),
          createdAt: now,
          updatedAt: now,
        });
      }

      const street = [body.address, body.addressLine2].filter(Boolean).join(' ');
      if (body.existingMemberId) {
        await tx.delete(address).where(
          and(eq(address.memberId, body.existingMemberId), eq(address.isDefault, true)),
        );
      }
      await tx.insert(address).values({
        id: randomUUID(),
        memberId,
        type: 'home',
        street,
        city: body.city,
        state: body.state,
        zipCode: body.zip,
        country: 'US',
        isDefault: true,
      });

      await tx.insert(memberMembership).values({
        id: memberMembershipId,
        memberId,
        membershipPlanId: body.planId,
        status: 'active',
        billingType: body.billingType,
        startDate: now,
        ...(payment?.iqproSubscriptionId ? { iqproSubscriptionId: payment.iqproSubscriptionId } : {}),
        createdAt: now,
        updatedAt: now,
      });

      if (wt) {
        await tx.insert(signedWaiver).values({
          id: randomUUID(),
          organizationId: orgId,
          waiverTemplateId: wt.id,
          waiverTemplateVersion: wt.version,
          memberId,
          memberMembershipId,
          membershipPlanName: plan.name,
          membershipPlanPrice: plan.price,
          membershipPlanFrequency: plan.frequency,
          membershipPlanContractLength: plan.contractLength,
          membershipPlanSignupFee: plan.signupFee,
          membershipPlanIsTrial: plan.isTrial,
          signatureDataUrl: body.waiverSignature,
          signedByName: body.signedByName,
          signedByEmail: body.guardianEmail ?? body.email,
          signedByRelationship: body.guardianRelationship ?? null,
          memberFirstName: body.firstName,
          memberLastName: body.lastName,
          memberEmail: body.email,
          memberDateOfBirth: body.dateOfBirth ? new Date(`${body.dateOfBirth}T12:00:00`) : undefined,
          renderedContent: body.waiverContent,
          signedAt: now,
          createdAt: now,
        });
      }

      if (payment) {
        const achLast4 = body.paymentMethod === 'ach' && body.achAccountNumber
          ? body.achAccountNumber.slice(-4)
          : null;
        await tx.insert(paymentMethod).values({
          id: randomUUID(),
          memberId,
          iqproPaymentMethodId: payment.paymentMethodId || null,
          type: body.paymentMethod,
          firstSix: body.paymentMethod === 'card' ? (body.cardFirstSix ?? null) : null,
          last4: body.paymentMethod === 'card' ? (body.cardLastFour ?? null) : achLast4,
          accountType: body.paymentMethod === 'ach' ? (payment.achAccountType ?? null) : null,
          isDefault: true,
        });

        await tx.insert(transaction).values({
          id: randomUUID(),
          organizationId: orgId,
          memberId,
          memberMembershipId,
          transactionType: 'membership_payment',
          amount: payment.fees.amount,
          status: 'paid',
          paymentMethod: body.paymentMethod,
          description: `${plan.name} membership`,
          iqproTransactionId: payment.txId,
          processedAt: now,
          createdAt: now,
          updatedAt: now,
        });
      }

      // If converting a trial, cancel the trial membership now that payment
      // succeeded — inside the same transaction so it can't half-apply.
      if (body.convertingTrialMembershipId) {
        await tx.update(memberMembership)
          .set({ status: 'cancelled', endDate: now, updatedAt: now })
          .where(eq(memberMembership.id, body.convertingTrialMembershipId));
      }
    });

    // ── Post-commit side effects (confirmation email) ────────────────────────
    const chargedFees = payment?.fees;
    const signedByRelationship = body.guardianRelationship ?? null;

    let pdfBuffer: Buffer | undefined;
    let pdfFilename: string | undefined;
    if (body.waiverSignature && body.waiverContent) {
      try {
        pdfBuffer = await generateWaiverPdfBuffer({
          memberFirstName: body.firstName,
          memberLastName: body.lastName,
          signedByName: body.signedByName,
          signedByRelationship,
          signedAt: now,
          waiverTemplateName: wt?.name ?? 'Membership Waiver',
          renderedContent: body.waiverContent,
          signatureDataUrl: body.waiverSignature,
          planName: plan.name,
          planPrice: plan.price,
          planFrequency: plan.frequency,
        });
        pdfFilename = generatePdfFilename(body.lastName, body.firstName);
      }
      catch (pdfErr) {
        console.error('[payment/membership] PDF generation error:', pdfErr);
      }
    }

    if (body.email) {
      sendMembershipConfirmation({
        toEmail: body.email,
        firstName: body.firstName,
        lastName: body.lastName,
        programName: body.programName,
        planName: plan.name,
        planPrice: plan.price,
        planFrequency: plan.frequency,
        planContractLength: plan.contractLength,
        waiverPdfBuffer: pdfBuffer,
        waiverPdfFilename: pdfFilename,
        feeBreakdown: chargedFees
          ? {
              baseAmount: chargedFees.baseAmount,
              taxAmount: chargedFees.taxAmount,
              taxPct: chargedFees.taxPct,
              serviceFeeAmount: chargedFees.serviceFeeAmount,
              serviceFeePct: chargedFees.serviceFeePct,
              amount: chargedFees.amount,
            }
          : undefined,
        isRecurring,
      }).catch(() => {});
    }

    return NextResponse.json({
      success: true,
      status: 'approved',
      memberId,
      memberMembershipId,
    });
  }
  catch (error) {
    console.error('[payment/membership] Error:', error);
    return NextResponse.json(
      { success: false, status: 'declined', error: 'Membership creation failed. Please try again.' },
      { status: 500 },
    );
  }
}

type DB = ReturnType<typeof getDatabase>;

/** Resolve the plan-linked waiver template, else the org's default active one. */
async function resolveWaiverTemplate(
  db: DB,
  orgId: string,
  planId: string,
): Promise<typeof waiverTemplate.$inferSelect | undefined> {
  const linkedWaivers = await db
    .select({ waiverTemplateId: membershipWaiver.waiverTemplateId })
    .from(membershipWaiver)
    .where(eq(membershipWaiver.membershipPlanId, planId))
    .limit(1);

  if (linkedWaivers[0]) {
    const templates = await db
      .select()
      .from(waiverTemplate)
      .where(and(
        eq(waiverTemplate.id, linkedWaivers[0].waiverTemplateId),
        eq(waiverTemplate.isActive, true),
      ))
      .orderBy(desc(waiverTemplate.version))
      .limit(1);
    if (templates[0]) {
      return templates[0];
    }
  }

  const defaults = await db
    .select()
    .from(waiverTemplate)
    .where(and(
      eq(waiverTemplate.organizationId, orgId),
      eq(waiverTemplate.isActive, true),
    ))
    .orderBy(desc(waiverTemplate.version))
    .limit(1);
  return defaults[0];
}

interface RunPaymentArgs {
  config: NonNullable<Awaited<ReturnType<typeof resolveIQProConfig>>>;
  gatewayId: string;
  body: MembershipPaymentBody;
  plan: { name: string; price: number; frequency: string };
  phone: string | undefined;
  isRecurring: boolean;
  now: Date;
}

/**
 * Runs the full IQPro flow (customer → payment method → charge/subscription)
 * and returns the ids needed to persist. Performs NO database writes and
 * throws on any failure or decline — the caller persists only on success.
 */
async function runPayment(args: RunPaymentArgs): Promise<PaymentResult> {
  const { config, gatewayId, body, plan, phone, isRecurring, now } = args;

  const { cardProcessorId, achProcessorId } = await getGatewayProcessors(config);

  // Create IQPro customer
  const customerRes = await iqproPost<{ data?: Record<string, unknown> }>(
    config,
    `/api/gateway/${gatewayId}/customer`,
    {
      name: `${body.firstName} ${body.lastName}`,
      referenceId: `kiosk_membership_${now.getTime()}`,
      addresses: [
        {
          addressLine1: body.address,
          ...(body.addressLine2 && { addressLine2: body.addressLine2 }),
          city: body.city,
          state: body.state,
          postalCode: body.zip,
          country: 'US',
          firstName: body.firstName,
          lastName: body.lastName,
          email: body.email,
          ...(phone && { phone }),
          isBilling: true,
        },
      ],
    },
  );

  const customerData = (customerRes.data ?? customerRes) as Record<string, unknown>;
  const iqproCustomerId = customerData.customerId as string | undefined;
  if (!iqproCustomerId) {
    throw new Error('IQPro customer creation returned no customerId');
  }

  const customerDetail = await iqproGet<{ data?: Record<string, unknown> }>(
    config,
    `/api/gateway/${gatewayId}/customer/${iqproCustomerId}`,
  );
  const detailData = (customerDetail.data ?? customerDetail) as Record<string, unknown>;
  const addresses = (detailData.addresses ?? []) as Array<Record<string, unknown>>;
  const custBillingAddr = addresses.find(a => a.isBilling) ?? addresses[0];
  const customerBillingAddressId = (custBillingAddr?.customerAddressId ?? custBillingAddr?.id ?? '') as string;

  let paymentMethodId: string;
  let achToken: string | undefined;
  let achAccountType: 'Checking' | 'Savings' | undefined;

  if (body.paymentMethod === 'card') {
    if (!body.cardToken || !body.cardFirstSix || !body.cardLastFour || !body.cardExpiry) {
      throw new Error('Card was not tokenized. Please re-enter your card.');
    }
    const maskedCard = `${body.cardFirstSix}******${body.cardLastFour}`;
    const pmRes = await iqproPost<{ data?: Record<string, unknown> }>(
      config,
      `/api/gateway/${gatewayId}/customer/${iqproCustomerId}/payment`,
      {
        card: { token: body.cardToken, expirationDate: body.cardExpiry, maskedCard },
        isDefault: true,
      },
    );
    const pmData = (pmRes.data ?? pmRes) as Record<string, unknown>;
    paymentMethodId = (pmData.customerPaymentMethodId ?? pmData.paymentMethodId ?? '') as string;
  }
  else {
    achAccountType = body.achAccountType ?? 'Checking';
    const tokenizeResult = await tokenizeAch(config, {
      accountNumber: body.achAccountNumber!,
      routingNumber: body.achRoutingNumber!,
      achAccountType,
    });
    achToken = tokenizeResult.achToken;
    const pmRes = await iqproPost<{ data?: Record<string, unknown> }>(
      config,
      `/api/gateway/${gatewayId}/customer/${iqproCustomerId}/payment`,
      {
        ach: {
          token: tokenizeResult.achToken,
          secCode: 'PPD',
          routingNumber: body.achRoutingNumber,
          accountType: achAccountType,
          checkNumber: null,
          accountHolderAuth: { dlState: null, dlNumber: null },
        },
        isDefault: true,
      },
    );
    const pmData = (pmRes.data ?? pmRes) as Record<string, unknown>;
    paymentMethodId = (pmData.customerPaymentMethodId ?? pmData.paymentMethodId ?? '') as string;
  }

  // Fee calculation — memberships aren't taxed, only the service fee applies.
  const baseAmount = Math.round(plan.price * 100) / 100;
  const discountAmount = body.couponDiscount ? Math.round(body.couponDiscount * 100) / 100 : 0;
  const discountedBase = Math.max(0, Math.round((baseAmount - discountAmount) * 100) / 100);

  const processorId = body.paymentMethod === 'card' ? cardProcessorId : achProcessorId;
  if (!processorId) {
    throw new Error(`No ${body.paymentMethod} processor configured`);
  }
  const serviceFeePct = await getOrganizationServiceFeePct();
  const fees = await computeFeeBreakdown(config, discountedBase, /* isTaxable */ false, /* taxStatePct */ 0, {
    processorId,
    serviceFeePct,
    token: body.paymentMethod === 'card' ? body.cardToken : achToken,
    creditCardBin: body.paymentMethod === 'card' ? body.cardFirstSix : undefined,
  });

  if (body.feeBreakdown && Math.abs(fees.amount - body.feeBreakdown.amount) > 0.01) {
    const safeClientFeeAmount = Number.isFinite(body.feeBreakdown.amount) ? body.feeBreakdown.amount : 'invalid';
    console.error('[payment/membership] Fee mismatch — client:', sanitizeForLog(safeClientFeeAmount), 'server:', fees.amount);
    throw new Error('Fee breakdown has changed — please refresh and try again');
  }

  const paymentAdjustments: Array<Record<string, unknown>> = [buildServiceFeeAdjustment(fees)];
  const amount = fees.amount;
  const country = body.country || 'US';

  const billingAddress = {
    isBilling: true,
    isShipping: false,
    isRemittance: false,
    firstName: body.firstName,
    lastName: body.lastName,
    email: body.email,
    state: body.state,
    country,
    ...(phone && { phone }),
    addressLine1: body.address,
    ...(body.addressLine2 && { addressLine2: body.addressLine2 }),
    city: body.city,
    postalCode: body.zip,
  };
  const remittanceAddress = {
    isBilling: false,
    isShipping: false,
    isRemittance: true,
    firstName: body.firstName,
    lastName: body.lastName,
    email: body.email,
    country,
  };

  const buildTxPaymentMethod = (): Record<string, unknown> => {
    if (body.paymentMethod === 'ach' && achToken && achAccountType) {
      return {
        ach: {
          achToken,
          secCode: 'PPD',
          routingNumber: body.achRoutingNumber,
          accountType: achAccountType,
          checkNumber: null,
          accountHolderAuth: { dlState: null, dlNumber: null },
        },
      };
    }
    return {
      customer: {
        customerId: iqproCustomerId,
        customerPaymentMethodId: paymentMethodId,
        ...(customerBillingAddressId && { customerBillingAddressId }),
      },
    };
  };

  const txRemit = {
    baseAmount: fees.baseAmount,
    taxAmount: fees.taxAmount,
    isTaxExempt: fees.taxAmount <= 0,
    currencyCode: 'USD',
    addTaxToTotal: true,
    ...(paymentAdjustments.length > 0 && { paymentAdjustments }),
  };

  const txAddress = [
    {
      isPhysical: true,
      isBilling: true,
      isShipping: false,
      firstName: body.firstName,
      lastName: body.lastName,
      email: body.email,
      phone: phone || null,
      addressLine1: body.address,
      addressLine2: body.addressLine2 || null,
      city: body.city,
      state: body.state,
      postalCode: body.zip,
      country,
    },
  ];

  const txLineItems = [
    {
      name: plan.name,
      description: `${plan.frequency} membership`,
      quantity: 1,
      unitPrice: baseAmount,
      discount: discountAmount,
      freightAmount: 0,
      unitOfMeasureId: 1,
      localTaxPercent: 0,
      nationalTaxPercent: 0,
    },
  ];

  let iqproSubscriptionId: string | undefined;
  let txId: string | undefined;

  if (isRecurring) {
    const billingPeriodId = plan.frequency === 'Annual' ? 6 : 4;
    const dayOfMonth = now.getDate();
    const schedule: Record<string, number[]> = {
      minutes: [0],
      hours: [0],
      daysOfMonth: [dayOfMonth],
    };
    if (plan.frequency === 'Annual') {
      schedule.monthsOfYear = [now.getMonth() + 1];
    }

    const subRes = await iqproPost<{ data?: Record<string, unknown> }>(
      config,
      `/api/gateway/${gatewayId}/subscription`,
      {
        customerId: iqproCustomerId,
        subscriptionStatusId: 1,
        name: plan.name,
        prefix: 'MBR',
        recurrence: {
          termStartDate: now.toISOString(),
          billingStartDate: now.toISOString(),
          isAutoRenewed: true,
          allowProration: false,
          trialLengthInDays: 0,
          invoiceLengthInDays: 1,
          billingPeriodId,
          schedule,
        },
        paymentMethod: {
          customerPaymentMethodId: paymentMethodId,
          isAutoCharged: true,
          ...(cardProcessorId && { cardProcessorId }),
          ...(achProcessorId && { achProcessorId }),
        },
        addresses: [billingAddress, remittanceAddress],
        lineItems: [
          {
            name: plan.name,
            description: `${plan.frequency} membership payment`,
            quantity: 1,
            unitPrice: baseAmount,
            discount: 0,
            unitOfMeasureId: plan.frequency === 'Annual' ? 4 : 3,
          },
        ],
        ...(paymentAdjustments.length > 0 && { paymentAdjustments }),
      },
    );
    const subData = (subRes.data ?? subRes) as Record<string, unknown>;
    iqproSubscriptionId = (subData.subscriptionId ?? subData.id ?? '') as string;

    // IQPro subscriptions don't auto-charge on creation — process initial Sale.
    if (amount > 0) {
      const initTxRes = await iqproPost<{ data?: Record<string, unknown> }>(
        config,
        `/api/gateway/${gatewayId}/transaction`,
        {
          type: 'Sale',
          remit: txRemit,
          paymentMethod: buildTxPaymentMethod(),
          address: txAddress,
          lineItems: txLineItems,
          caption: `Membership: ${plan.name}`.substring(0, 19),
        },
      );
      const initTxRaw = initTxRes.data ?? initTxRes;
      const initTxData = ((initTxRaw as Record<string, unknown>).transaction ?? initTxRaw) as Record<string, unknown>;
      txId = (initTxData.transactionId ?? initTxData.id ?? '') as string;
      assertTransactionApproved(initTxData);
    }

    txId = txId ?? iqproSubscriptionId;
  }
  else {
    const txRes = await iqproPost<{ data?: Record<string, unknown> }>(
      config,
      `/api/gateway/${gatewayId}/transaction`,
      {
        type: 'Sale',
        remit: txRemit,
        paymentMethod: buildTxPaymentMethod(),
        address: txAddress,
        lineItems: txLineItems,
        caption: `Membership: ${plan.name}`.substring(0, 19),
      },
    );
    const txRaw = txRes.data ?? txRes;
    const txData = ((txRaw as Record<string, unknown>).transaction ?? txRaw) as Record<string, unknown>;
    txId = (txData.transactionId ?? txData.id ?? '') as string;
    assertTransactionApproved(txData);
  }

  return {
    iqproCustomerId,
    paymentMethodId,
    iqproSubscriptionId,
    txId: txId ?? '',
    achAccountType,
    fees,
  };
}

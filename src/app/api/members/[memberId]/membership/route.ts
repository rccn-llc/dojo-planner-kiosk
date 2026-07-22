import type { IQProConfig } from '@/lib/iqproConfig';
import { randomUUID } from 'node:crypto';
import { and, count, eq, gte } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { resolveOrgIdFromRequest } from '@/lib/clerk';
import { getDatabase } from '@/lib/database';
import { validateDevice } from '@/lib/deviceAuth';
import { sendCancellationConfirmation } from '@/lib/email';
import { assertTransactionApproved, buildServiceFeeAdjustment, computeFeeBreakdown, getGatewayProcessors, iqproGet, iqproPost, iqproPut } from '@/lib/iqpro';
import { getOrganizationServiceFeePct, resolveIQProConfig } from '@/lib/iqproConfig';
import { auditEvent, member, memberMembership, membershipPlan, transaction } from '@/lib/memberSchema';

type DB = ReturnType<typeof getDatabase>;

interface LifecycleContext {
  member: {
    id: string;
    organizationId: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
    iqproCustomerId: string | null;
  };
  membership: {
    id: string;
    membershipPlanId: string;
    status: string;
    iqproSubscriptionId: string | null;
    iqproHoldFeeSubscriptionId: string | null;
  };
  plan: {
    id: string;
    name: string;
    cancellationFee: number;
    holdFeeAmount: number;
    holdFeeFrequency: string | null;
    holdLimitPerYear: number | null;
  };
}

interface LifecycleResult {
  success: boolean;
  amountCharged?: number;
  transactionId?: string;
  error?: string;
}

class HoldLimitReachedError extends Error {
  public readonly holdLimitPerYear: number;
  public readonly priorHolds: number;

  constructor(holdLimitPerYear: number, priorHolds: number) {
    super(`Hold limit reached: ${priorHolds} of ${holdLimitPerYear} holds used in the past 12 months.`);
    this.name = 'HoldLimitReachedError';
    this.holdLimitPerYear = holdLimitPerYear;
    this.priorHolds = priorHolds;
  }
}

async function getLifecycleContext(
  db: DB,
  memberId: string,
  memberMembershipId: string,
  organizationId: string,
): Promise<LifecycleContext | null> {
  const rows = await db
    .select({
      memberId: member.id,
      memberOrgId: member.organizationId,
      memberFirstName: member.firstName,
      memberLastName: member.lastName,
      memberEmail: member.email,
      memberPhone: member.phone,
      iqproCustomerId: member.iqproCustomerId,
      membershipId: memberMembership.id,
      membershipPlanId: memberMembership.membershipPlanId,
      membershipStatus: memberMembership.status,
      iqproSubscriptionId: memberMembership.iqproSubscriptionId,
      iqproHoldFeeSubscriptionId: memberMembership.iqproHoldFeeSubscriptionId,
      planId: membershipPlan.id,
      planName: membershipPlan.name,
      cancellationFee: membershipPlan.cancellationFee,
      holdFeeAmount: membershipPlan.holdFeeAmount,
      holdFeeFrequency: membershipPlan.holdFeeFrequency,
      holdLimitPerYear: membershipPlan.holdLimitPerYear,
    })
    .from(memberMembership)
    .innerJoin(member, eq(memberMembership.memberId, member.id))
    .innerJoin(membershipPlan, eq(memberMembership.membershipPlanId, membershipPlan.id))
    .where(and(
      eq(memberMembership.id, memberMembershipId),
      eq(memberMembership.memberId, memberId),
      eq(member.organizationId, organizationId),
    ))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    member: {
      id: row.memberId,
      organizationId: row.memberOrgId,
      firstName: row.memberFirstName,
      lastName: row.memberLastName,
      email: row.memberEmail,
      phone: row.memberPhone,
      iqproCustomerId: row.iqproCustomerId,
    },
    membership: {
      id: row.membershipId,
      membershipPlanId: row.membershipPlanId,
      status: row.membershipStatus,
      iqproSubscriptionId: row.iqproSubscriptionId,
      iqproHoldFeeSubscriptionId: row.iqproHoldFeeSubscriptionId,
    },
    plan: {
      id: row.planId,
      name: row.planName,
      cancellationFee: row.cancellationFee,
      holdFeeAmount: row.holdFeeAmount,
      holdFeeFrequency: row.holdFeeFrequency,
      holdLimitPerYear: row.holdLimitPerYear,
    },
  };
}

async function writeAuditEvent(
  db: DB,
  args: {
    organizationId: string;
    action: string;
    entityType: string;
    entityId: string;
    status: 'success' | 'failure';
    error?: string;
    changes?: unknown;
  },
): Promise<void> {
  try {
    await db.insert(auditEvent).values({
      id: randomUUID(),
      organizationId: args.organizationId,
      userId: 'kiosk',
      action: args.action,
      entityType: args.entityType,
      entityId: args.entityId,
      role: 'kiosk',
      status: args.status,
      error: args.error ?? null,
      changes: args.changes === undefined ? null : JSON.stringify(args.changes),
      timestamp: new Date(),
    });
  }
  catch (err) {
    console.error('[membership] Failed to write audit_event', err);
  }
}

async function countRecentHolds(db: DB, memberMembershipId: string, organizationId: string): Promise<number> {
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);

  const rows = await db
    .select({ value: count() })
    .from(auditEvent)
    .where(and(
      eq(auditEvent.organizationId, organizationId),
      eq(auditEvent.action, 'memberMembership.hold'),
      eq(auditEvent.entityId, memberMembershipId),
      eq(auditEvent.status, 'success'),
      gte(auditEvent.timestamp, twelveMonthsAgo),
    ));

  return rows[0]?.value ?? 0;
}

async function chargeOneTimeFee(args: {
  config: IQProConfig;
  iqproSubscriptionId: string;
  iqproCustomerId: string;
  orgId: string;
  memberId: string;
  memberMembershipId: string;
  amount: number;
  transactionType: 'cancellation_fee' | 'hold_fee';
  description: string;
  caption: string;
  db: DB;
}): Promise<LifecycleResult> {
  const { config, iqproSubscriptionId, iqproCustomerId, orgId, memberId, memberMembershipId, amount, transactionType, description, caption, db } = args;
  const gatewayId = config.gatewayId;
  const baseAmount = Math.round(amount * 100) / 100;

  if (baseAmount <= 0) {
    return { success: true, amountCharged: 0 };
  }

  try {
    const subRes = await iqproGet<{ data?: Record<string, unknown> }>(
      config,
      `/api/gateway/${gatewayId}/subscription/${iqproSubscriptionId}`,
    );
    const sub = (subRes.data ?? subRes) as Record<string, unknown>;
    const subPM = sub.paymentMethod as Record<string, unknown> | undefined;
    const custPM = subPM?.customerPaymentMethod as Record<string, unknown> | undefined;
    const customerId = ((sub.customer as Record<string, unknown> | undefined)?.customerId ?? iqproCustomerId) as string;
    const pmId = (custPM?.paymentMethodId ?? '') as string;

    if (!pmId) {
      return { success: false, error: 'No saved payment method on the existing subscription. Cannot charge fee.' };
    }

    const paymentMethodName: 'card' | 'ach' = custPM?.card ? 'card' : 'ach';

    const { cardProcessorId, achProcessorId } = await getGatewayProcessors(config);
    const processorId = paymentMethodName === 'card' ? cardProcessorId : achProcessorId;
    if (!processorId) {
      return { success: false, error: `No ${paymentMethodName} processor configured` };
    }
    const cardInfo = custPM?.card as Record<string, unknown> | undefined;
    const maskedNumber = (cardInfo?.maskedNumber ?? cardInfo?.maskedCard ?? '') as string;
    const bin = maskedNumber && maskedNumber.length >= 6 ? maskedNumber.slice(0, 6) : '400000';

    // Cancellation / hold fees are NOT taxable (per Basys guidance on non-store charges).
    const serviceFeePct = await getOrganizationServiceFeePct(orgId);
    const serverFees = await computeFeeBreakdown(config, baseAmount, false, 0, {
      processorId,
      serviceFeePct,
      creditCardBin: paymentMethodName === 'card' ? bin : undefined,
    });
    const paymentAdjustments: Array<Record<string, unknown>> = [buildServiceFeeAdjustment(serverFees)];

    const feeTxPayload = {
      type: 'Sale',
      remit: {
        baseAmount: serverFees.baseAmount,
        taxAmount: serverFees.taxAmount,
        isTaxExempt: serverFees.taxAmount <= 0,
        currencyCode: 'USD',
        addTaxToTotal: true,
        paymentAdjustments,
      },
      paymentMethod: {
        customer: {
          customerId,
          customerPaymentMethodId: pmId,
        },
      },
      lineItems: [
        {
          name: caption,
          description,
          quantity: 1,
          unitPrice: baseAmount,
          discount: 0,
          freightAmount: 0,
          unitOfMeasureId: 1,
          localTaxPercent: 0,
          nationalTaxPercent: 0,
        },
      ],
      caption,
    };

    const txRes = await iqproPost<{ data?: Record<string, unknown> }>(
      config,
      `/api/gateway/${gatewayId}/transaction`,
      feeTxPayload,
    );
    const txRaw = txRes.data ?? txRes;
    const txData = ((txRaw as Record<string, unknown>).transaction ?? txRaw) as Record<string, unknown>;
    assertTransactionApproved(txData);

    const txId = (txData.transactionId ?? txData.id ?? '') as string;
    const now = new Date();

    await db.insert(transaction).values({
      id: randomUUID(),
      organizationId: orgId,
      memberId,
      memberMembershipId,
      transactionType,
      amount: serverFees.amount,
      status: 'paid',
      paymentMethod: paymentMethodName,
      description,
      iqproTransactionId: txId,
      processedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    return { success: true, amountCharged: serverFees.amount, transactionId: txId };
  }
  catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[membership] One-time fee charge failed', { transactionType, error: message });
    return { success: false, error: message };
  }
}

async function cancelIQProSubscription(
  config: IQProConfig,
  iqproSubscriptionId: string,
): Promise<{ success: boolean; error?: string }> {
  const gatewayId = config.gatewayId;
  try {
    await iqproPost(
      config,
      `/api/gateway/${gatewayId}/subscription/${iqproSubscriptionId}/cancel`,
      { cancel: { now: true, endOfBillingPeriod: false } },
    );
    return { success: true };
  }
  catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[membership] IQPro subscription cancel failed', { iqproSubscriptionId, error: message });
    return { success: false, error: message };
  }
}

async function setSubscriptionAutoRenewal(
  config: IQProConfig,
  iqproSubscriptionId: string,
  isAutoRenewed: boolean,
): Promise<{ success: boolean; error?: string }> {
  const gatewayId = config.gatewayId;
  const subPath = `/api/gateway/${gatewayId}/subscription/${iqproSubscriptionId}`;
  try {
    const subRes = await iqproGet<{ data?: Record<string, unknown> }>(config, subPath);
    const sub = (subRes.data ?? subRes) as Record<string, unknown>;
    const recurrence = sub.recurrence as Record<string, unknown> | undefined;

    const putPayload: Record<string, unknown> = {
      name: sub.name,
      prefix: sub.prefix,
    };
    if (recurrence) {
      putPayload.recurrence = {
        termStartDate: recurrence.termStartDate,
        billingStartDate: recurrence.billingStartDate,
        isAutoRenewed,
        allowProration: recurrence.allowProration,
        trialLengthInDays: recurrence.trialLengthInDays,
        invoiceLengthInDays: recurrence.invoiceLengthInDays,
        billingPeriodId: (recurrence.billingPeriod as Record<string, unknown> | undefined)?.billingPeriodId,
        schedule: recurrence.schedule,
      };
    }

    await iqproPut(config, subPath, putPayload);
    return { success: true };
  }
  catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[membership] IQPro subscription update failed', { iqproSubscriptionId, isAutoRenewed, error: message });
    return { success: false, error: message };
  }
}

// Build the IQPro recurrence schedule for a given hold-fee cadence.
// Mirrors dojo-planner's IQProPaymentService.createSubscription mapping so the
// two apps produce the same subscription shape.
function holdFeeRecurrence(frequency: string, startDate: Date): { billingPeriodId: number; schedule: Record<string, number[]> } | null {
  const dayOfMonth = startDate.getDate();
  const startMonth = startDate.getMonth() + 1;
  const schedule: Record<string, number[]> = {
    minutes: [0],
    hours: [0],
    daysOfMonth: [dayOfMonth],
  };
  switch (frequency) {
    case 'Weekly':
      delete (schedule as Record<string, unknown>).daysOfMonth;
      schedule.daysOfWeek = [startDate.getDay()];
      return { billingPeriodId: 2, schedule };
    case 'Monthly':
      return { billingPeriodId: 4, schedule };
    case 'Semi-Annual': {
      const secondMonth = ((startMonth - 1 + 6) % 12) + 1;
      schedule.monthsOfYear = [startMonth, secondMonth].sort((a, b) => a - b);
      return { billingPeriodId: 6, schedule };
    }
    case 'Annual':
      schedule.monthsOfYear = [startMonth];
      return { billingPeriodId: 6, schedule };
    default:
      return null;
  }
}

async function createHoldFeeSubscription(
  config: IQProConfig,
  ctx: LifecycleContext,
  feeAmount: number,
  frequency: string,
): Promise<{ success: boolean; subscriptionId?: string; error?: string }> {
  const gatewayId = config.gatewayId;
  try {
    // Pull customerId + paymentMethodId from the existing membership subscription.
    if (!ctx.membership.iqproSubscriptionId) {
      return { success: false, error: 'No existing membership subscription to copy payment method from.' };
    }
    const subRes = await iqproGet<{ data?: Record<string, unknown> }>(
      config,
      `/api/gateway/${gatewayId}/subscription/${ctx.membership.iqproSubscriptionId}`,
    );
    const sub = (subRes.data ?? subRes) as Record<string, unknown>;
    const subPM = sub.paymentMethod as Record<string, unknown> | undefined;
    const custPM = subPM?.customerPaymentMethod as Record<string, unknown> | undefined;
    const pmId = (custPM?.paymentMethodId ?? '') as string;
    const customerId = ((sub.customer as Record<string, unknown> | undefined)?.customerId ?? ctx.member.iqproCustomerId ?? '') as string;

    if (!pmId || !customerId) {
      return { success: false, error: 'No saved payment method on the existing subscription. Cannot create recurring hold-fee sub.' };
    }

    // IQPro requires the addresses array on subscription POST. Reuse the
    // billing/remittance addresses from the existing membership sub so we
    // don't need to re-collect them. Strip server-assigned IDs.
    const subAddresses = (sub.addresses as Array<Record<string, unknown>> | undefined) ?? [];
    const addresses = subAddresses.map((a) => {
      const copy = { ...a };
      delete copy.subscriptionAddressId;
      return copy;
    });
    if (addresses.length === 0) {
      return { success: false, error: 'Existing membership subscription has no addresses to reuse for hold-fee sub.' };
    }

    const now = new Date();
    const recurrence = holdFeeRecurrence(frequency, now);
    if (!recurrence) {
      return { success: false, error: `Unsupported hold-fee frequency: ${frequency}` };
    }

    const { cardProcessorId, achProcessorId } = await getGatewayProcessors(config);

    const holdSubRes = await iqproPost<{ data?: Record<string, unknown> }>(
      config,
      `/api/gateway/${gatewayId}/subscription`,
      {
        customerId,
        subscriptionStatusId: 1,
        name: `Hold fee — ${ctx.plan.name}`,
        prefix: 'HOLD',
        recurrence: {
          termStartDate: now.toISOString(),
          billingStartDate: now.toISOString(),
          isAutoRenewed: true,
          allowProration: false,
          trialLengthInDays: 0,
          invoiceLengthInDays: 1,
          billingPeriodId: recurrence.billingPeriodId,
          schedule: recurrence.schedule,
        },
        paymentMethod: {
          customerPaymentMethodId: pmId,
          isAutoCharged: true,
          ...(cardProcessorId && { cardProcessorId }),
          ...(achProcessorId && { achProcessorId }),
        },
        addresses,
        lineItems: [
          {
            name: 'Hold fee',
            description: `Hold fee — ${ctx.plan.name}`,
            quantity: 1,
            unitPrice: feeAmount,
            discount: 0,
            unitOfMeasureId: frequency === 'Weekly' ? 6 : frequency === 'Annual' ? 4 : 3,
          },
        ],
      },
    );
    const subData = (holdSubRes.data ?? holdSubRes) as Record<string, unknown>;
    const subscriptionId = (subData.subscriptionId ?? subData.id ?? '') as string;
    if (!subscriptionId) {
      return { success: false, error: 'IQPro did not return a subscription id for the hold-fee sub.' };
    }
    return { success: true, subscriptionId };
  }
  catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[membership] Hold-fee subscription create failed', { error: message });
    return { success: false, error: message };
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ memberId: string }> },
) {
  try {
    // Prefer URL-derived org slug; fall back to device cert when the slug
    // isn't present (older clients).
    let orgId = await resolveOrgIdFromRequest(request);
    if (!orgId) {
      const device = await validateDevice(request);
      orgId = device?.orgId ?? process.env.ORGANIZATION_ID ?? null;
    }
    if (!orgId) {
      return NextResponse.json({ error: 'Organization context not available' }, { status: 400 });
    }

    const iqproConfig = await resolveIQProConfig(orgId);

    const { memberId } = await params;
    const body = await request.json() as {
      memberMembershipId: string;
      action: 'cancel' | 'hold' | 'reactivate';
      waiveFee?: boolean;
    };

    if (!body.memberMembershipId || !body.action) {
      return NextResponse.json({ error: 'memberMembershipId and action are required' }, { status: 400 });
    }

    const db = getDatabase();
    const ctx = await getLifecycleContext(db, memberId, body.memberMembershipId, orgId);
    if (!ctx) {
      return NextResponse.json({ error: 'Membership not found' }, { status: 404 });
    }

    const now = new Date();

    if (body.action === 'cancel') {
      const waiveFee = body.waiveFee === true;
      const feeAmount = waiveFee ? 0 : (ctx.plan.cancellationFee ?? 0);

      let cancellationFeeCharged = 0;
      let cancellationTransactionId: string | undefined;
      let feeChargeError: string | undefined;

      if (iqproConfig && feeAmount > 0 && ctx.member.iqproCustomerId && ctx.membership.iqproSubscriptionId) {
        const feeResult = await chargeOneTimeFee({
          config: iqproConfig,
          iqproSubscriptionId: ctx.membership.iqproSubscriptionId,
          iqproCustomerId: ctx.member.iqproCustomerId,
          orgId,
          memberId,
          memberMembershipId: body.memberMembershipId,
          amount: feeAmount,
          transactionType: 'cancellation_fee',
          description: `Cancellation fee — ${ctx.plan.name}`,
          caption: 'Cancellation fee',
          db,
        });
        if (feeResult.success) {
          cancellationFeeCharged = feeResult.amountCharged ?? 0;
          cancellationTransactionId = feeResult.transactionId;
          if (cancellationTransactionId && cancellationFeeCharged > 0) {
            await writeAuditEvent(db, {
              organizationId: orgId,
              action: 'cancellationFee.charge',
              entityType: 'transaction',
              entityId: cancellationTransactionId,
              status: 'success',
              changes: { amount: cancellationFeeCharged, memberMembershipId: body.memberMembershipId },
            });
          }
        }
        else {
          feeChargeError = feeResult.error;
          await writeAuditEvent(db, {
            organizationId: orgId,
            action: 'cancellationFee.charge',
            entityType: 'memberMembership',
            entityId: body.memberMembershipId,
            status: 'failure',
            error: feeChargeError,
          });
        }
      }

      if (iqproConfig && ctx.membership.iqproSubscriptionId) {
        await cancelIQProSubscription(iqproConfig, ctx.membership.iqproSubscriptionId);
      }
      if (iqproConfig && ctx.membership.iqproHoldFeeSubscriptionId) {
        await cancelIQProSubscription(iqproConfig, ctx.membership.iqproHoldFeeSubscriptionId);
      }

      await db.update(memberMembership)
        .set({
          status: 'cancelled',
          endDate: now,
          iqproHoldFeeSubscriptionId: null,
          updatedAt: now,
        })
        .where(eq(memberMembership.id, body.memberMembershipId));

      await db.update(member)
        .set({ status: 'inactive', statusChangedAt: now, updatedAt: now })
        .where(eq(member.id, memberId));

      await writeAuditEvent(db, {
        organizationId: orgId,
        action: 'memberMembership.cancel',
        entityType: 'memberMembership',
        entityId: body.memberMembershipId,
        status: 'success',
        changes: { waiveFee, cancellationFeeCharged },
      });

      if (ctx.member.email) {
        sendCancellationConfirmation({
          toEmail: ctx.member.email,
          firstName: ctx.member.firstName,
          lastName: ctx.member.lastName,
          planName: ctx.plan.name,
          cancelledAt: now,
          cancellationFee: cancellationFeeCharged > 0 ? cancellationFeeCharged : undefined,
          cancellationTxId: cancellationTransactionId,
        }).catch(() => {});
      }

      return NextResponse.json({
        success: true,
        status: 'cancelled',
        cancellationFeeCharged,
        cancellationTransactionId,
        feeChargeError,
      });
    }

    if (body.action === 'hold') {
      const limit = ctx.plan.holdLimitPerYear;
      if (limit != null && limit > 0) {
        const priorHolds = await countRecentHolds(db, body.memberMembershipId, orgId);
        if (priorHolds >= limit) {
          await writeAuditEvent(db, {
            organizationId: orgId,
            action: 'memberMembership.hold',
            entityType: 'memberMembership',
            entityId: body.memberMembershipId,
            status: 'failure',
            error: `Hold limit reached: ${priorHolds} of ${limit}`,
          });
          throw new HoldLimitReachedError(limit, priorHolds);
        }
      }

      let holdFeeCharged = 0;
      let holdFeeTransactionId: string | undefined;
      let holdFeeSubscriptionId: string | undefined;
      let feeChargeError: string | undefined;

      const feeAmount = ctx.plan.holdFeeAmount ?? 0;
      const feeFrequency = ctx.plan.holdFeeFrequency;

      if (
        iqproConfig
        && feeAmount > 0
        && ctx.member.iqproCustomerId
        && ctx.membership.iqproSubscriptionId
        && feeFrequency
      ) {
        if (feeFrequency === 'one-time') {
          const result = await chargeOneTimeFee({
            config: iqproConfig,
            iqproSubscriptionId: ctx.membership.iqproSubscriptionId,
            iqproCustomerId: ctx.member.iqproCustomerId,
            orgId,
            memberId,
            memberMembershipId: body.memberMembershipId,
            amount: feeAmount,
            transactionType: 'hold_fee',
            description: `Hold fee — ${ctx.plan.name}`,
            caption: 'Hold fee',
            db,
          });
          if (result.success) {
            holdFeeCharged = result.amountCharged ?? 0;
            holdFeeTransactionId = result.transactionId;
            if (holdFeeTransactionId && holdFeeCharged > 0) {
              await writeAuditEvent(db, {
                organizationId: orgId,
                action: 'holdFee.charge',
                entityType: 'transaction',
                entityId: holdFeeTransactionId,
                status: 'success',
                changes: { amount: holdFeeCharged, memberMembershipId: body.memberMembershipId },
              });
            }
          }
          else {
            feeChargeError = result.error;
            await writeAuditEvent(db, {
              organizationId: orgId,
              action: 'holdFee.charge',
              entityType: 'memberMembership',
              entityId: body.memberMembershipId,
              status: 'failure',
              error: feeChargeError,
            });
          }
        }
        else {
          const result = await createHoldFeeSubscription(iqproConfig, ctx, feeAmount, feeFrequency);
          if (result.success && result.subscriptionId) {
            holdFeeSubscriptionId = result.subscriptionId;
            await writeAuditEvent(db, {
              organizationId: orgId,
              action: 'holdFee.charge',
              entityType: 'subscription',
              entityId: holdFeeSubscriptionId,
              status: 'success',
              changes: { recurring: true, amount: feeAmount, frequency: feeFrequency, memberMembershipId: body.memberMembershipId },
            });
          }
          else {
            feeChargeError = result.error;
            await writeAuditEvent(db, {
              organizationId: orgId,
              action: 'holdFee.charge',
              entityType: 'memberMembership',
              entityId: body.memberMembershipId,
              status: 'failure',
              error: feeChargeError,
            });
          }
        }
      }

      if (iqproConfig && ctx.membership.iqproSubscriptionId) {
        await setSubscriptionAutoRenewal(iqproConfig, ctx.membership.iqproSubscriptionId, false);
      }

      await db.update(memberMembership)
        .set({
          status: 'hold',
          ...(holdFeeSubscriptionId ? { iqproHoldFeeSubscriptionId: holdFeeSubscriptionId } : {}),
          updatedAt: now,
        })
        .where(eq(memberMembership.id, body.memberMembershipId));

      await db.update(member)
        .set({ status: 'hold', statusChangedAt: now, updatedAt: now })
        .where(eq(member.id, memberId));

      // The success audit row is what countRecentHolds() reads to enforce the
      // limit — it must be written for the cross-app counter to stay correct.
      await writeAuditEvent(db, {
        organizationId: orgId,
        action: 'memberMembership.hold',
        entityType: 'memberMembership',
        entityId: body.memberMembershipId,
        status: 'success',
        changes: { holdFeeCharged, holdFeeSubscriptionId },
      });

      return NextResponse.json({
        success: true,
        status: 'hold',
        holdFeeCharged,
        holdFeeTransactionId,
        holdFeeSubscriptionId,
        feeChargeError,
      });
    }

    // reactivate
    if (iqproConfig && ctx.membership.iqproHoldFeeSubscriptionId) {
      await cancelIQProSubscription(iqproConfig, ctx.membership.iqproHoldFeeSubscriptionId);
    }
    if (iqproConfig && ctx.membership.iqproSubscriptionId) {
      await setSubscriptionAutoRenewal(iqproConfig, ctx.membership.iqproSubscriptionId, true);
    }

    await db.update(memberMembership)
      .set({
        status: 'active',
        iqproHoldFeeSubscriptionId: null,
        updatedAt: now,
      })
      .where(eq(memberMembership.id, body.memberMembershipId));

    await db.update(member)
      .set({ status: 'active', statusChangedAt: now, updatedAt: now })
      .where(eq(member.id, memberId));

    await writeAuditEvent(db, {
      organizationId: orgId,
      action: 'memberMembership.reactivate',
      entityType: 'memberMembership',
      entityId: body.memberMembershipId,
      status: 'success',
    });

    return NextResponse.json({ success: true, status: 'active' });
  }
  catch (error) {
    if (error instanceof HoldLimitReachedError) {
      return NextResponse.json(
        {
          error: 'Hold limit reached',
          holdLimitPerYear: error.holdLimitPerYear,
          priorHolds: error.priorHolds,
        },
        { status: 409 },
      );
    }
    console.error('[members/[memberId]/membership] PATCH Error:', error);
    return NextResponse.json({ error: 'Failed to update membership' }, { status: 500 });
  }
}

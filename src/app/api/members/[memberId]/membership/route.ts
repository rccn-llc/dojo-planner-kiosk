import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database';
import { validateDevice } from '@/lib/deviceAuth';
import { sendCancellationConfirmation } from '@/lib/email';
import { assertTransactionApproved, buildServiceFeeAdjustment, computeFeeBreakdown, getGatewayProcessors, iqproGet, iqproPost, iqproPut, isIQProConfigured } from '@/lib/iqpro';
import { member, memberMembership, membershipPlan, transaction } from '@/lib/memberSchema';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ memberId: string }> },
) {
  try {
    const device = await validateDevice(request);
    const orgId = device?.orgId ?? process.env.ORGANIZATION_ID;
    if (!orgId) {
      return NextResponse.json({ error: 'Organization context not available' }, { status: 500 });
    }

    const { memberId } = await params;
    const body = await request.json() as {
      memberMembershipId: string;
      action: 'cancel' | 'hold' | 'reactivate';
    };

    if (!body.memberMembershipId || !body.action) {
      return NextResponse.json({ error: 'memberMembershipId and action are required' }, { status: 400 });
    }

    const db = getDatabase();
    const now = new Date();

    // Fetch the member (verify org + get details for email/IQPro)
    const members = await db
      .select()
      .from(member)
      .where(and(eq(member.id, memberId), eq(member.organizationId, orgId)))
      .limit(1);

    const m = members[0];
    if (!m) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    // Fetch the membership record
    const memberships = await db
      .select()
      .from(memberMembership)
      .where(
        and(
          eq(memberMembership.id, body.memberMembershipId),
          eq(memberMembership.memberId, memberId),
        ),
      )
      .limit(1);

    const membership = memberships[0];
    if (!membership) {
      return NextResponse.json({ error: 'Membership not found' }, { status: 404 });
    }

    // Fetch the plan to check for cancellation fee
    let plan: { name: string; cancellationFee: number } | undefined;
    try {
      const plans = await db
        .select({
          name: membershipPlan.name,
          cancellationFee: membershipPlan.cancellationFee,
        })
        .from(membershipPlan)
        .where(eq(membershipPlan.id, membership.membershipPlanId))
        .limit(1);
      plan = plans[0];
    }
    catch {
      const plans = await db
        .select({ name: membershipPlan.name })
        .from(membershipPlan)
        .where(eq(membershipPlan.id, membership.membershipPlanId))
        .limit(1);
      plan = plans[0] ? { name: plans[0].name, cancellationFee: 0 } : undefined;
    }

    const gatewayId = process.env.IQPRO_GATEWAY_ID;

    // ── IQPro operations ─────────────────────────────────────────────────────
    let cancellationFeeCharged = 0;
    let cancellationTxId: string | undefined;

    if (membership.iqproSubscriptionId && isIQProConfigured() && gatewayId) {
      // 1. GET the subscription
      const subPath = `/api/gateway/${gatewayId}/subscription/${membership.iqproSubscriptionId}`;
      const subRes = await iqproGet<{ data?: Record<string, unknown> }>(subPath);
      const sub = (subRes.data ?? subRes) as Record<string, unknown>;
      const recurrence = sub.recurrence as Record<string, unknown> | undefined;

      // 2. Charge cancellation fee if applicable
      if (body.action === 'cancel' && plan && plan.cancellationFee > 0 && m.iqproCustomerId) {
        const subPM = sub.paymentMethod as Record<string, unknown> | undefined;
        const custPM = subPM?.customerPaymentMethod as Record<string, unknown> | undefined;
        const customerId = ((sub.customer as Record<string, unknown> | undefined)?.customerId ?? m.iqproCustomerId) as string;
        const pmId = (custPM?.paymentMethodId ?? '') as string;
        const baseAmount = Math.round(plan.cancellationFee * 100) / 100;
        const paymentMethodName: 'card' | 'ach' = custPM?.card ? 'card' : 'ach';

        if (pmId) {
          try {
            // Cancellation fees are NOT taxable (per Basys guidance on non-store charges).
            // Need processorId + BIN for IQPro /calculatefees. The vaulted card
            // exposes its masked number, so we can pull a BIN from there.
            const { cardProcessorId, achProcessorId } = await getGatewayProcessors();
            const processorId = paymentMethodName === 'card' ? cardProcessorId : achProcessorId;
            if (!processorId) {
              throw new Error(`No ${paymentMethodName} processor configured`);
            }
            const cardInfo = custPM?.card as Record<string, unknown> | undefined;
            const maskedNumber = (cardInfo?.maskedNumber ?? cardInfo?.maskedCard ?? '') as string;
            const bin = maskedNumber && maskedNumber.length >= 6 ? maskedNumber.slice(0, 6) : '400000';

            const serverFees = await computeFeeBreakdown(baseAmount, /* isTaxable */ false, {
              processorId,
              creditCardBin: paymentMethodName === 'card' ? bin : undefined,
            });
            const paymentAdjustments: Array<Record<string, unknown>> = [buildServiceFeeAdjustment(serverFees)];

            const feeTxPayload = {
              type: 'Sale',
              remit: {
                baseAmount: serverFees.baseAmount,
                taxAmount: serverFees.taxAmount,
                // IQPro requires isTaxExempt=true when calculated tax is 0.
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
                  name: 'Cancellation fee',
                  description: `Cancellation fee — ${plan.name}`,
                  quantity: 1,
                  unitPrice: baseAmount,
                  discount: 0,
                  freightAmount: 0,
                  unitOfMeasureId: 1,
                  localTaxPercent: 0,
                  nationalTaxPercent: 0,
                },
              ],
              caption: 'Cancellation fee',
            };

            const txRes = await iqproPost<{ data?: Record<string, unknown> }>(
              `/api/gateway/${gatewayId}/transaction`,
              feeTxPayload,
            );
            const txRaw = txRes.data ?? txRes;
            const txData = ((txRaw as Record<string, unknown>).transaction ?? txRaw) as Record<string, unknown>;
            // Throws if IQPro did not approve. The outer catch logs + swallows
            // so the cancellation itself still proceeds, but the fee amount
            // stays 0 and no "paid" DB row / email line is written.
            assertTransactionApproved(txData);
            cancellationTxId = (txData.transactionId ?? txData.id ?? '') as string;
            cancellationFeeCharged = serverFees.amount;

            await db.insert(transaction).values({
              id: randomUUID(),
              organizationId: orgId,
              memberId,
              memberMembershipId: body.memberMembershipId,
              transactionType: 'cancellation_fee',
              amount: serverFees.amount,
              status: 'paid',
              paymentMethod: paymentMethodName,
              description: `Cancellation fee — ${plan.name}`,
              iqproTransactionId: cancellationTxId,
              processedAt: now,
              createdAt: now,
              updatedAt: now,
            });
          }
          catch (feeErr) {
            console.error('[membership] Cancellation fee charge failed:', feeErr);
          }
        }
      }

      // 3. Update the subscription in IQPro
      const isHoldAction = body.action === 'hold';
      const isReactivate = body.action === 'reactivate';
      const isCancel = body.action === 'cancel';

      if (isCancel) {
        // Use the dedicated cancel endpoint: POST /subscription/{id}/cancel
        try {
          await iqproPost(
            `${subPath}/cancel`,
            {
              cancel: {
                now: true,
                endOfBillingPeriod: false,
              },
            },
          );
        }
        catch (cancelErr) {
          console.error('[membership] IQPro subscription cancel failed:', cancelErr);
        }
      }
      else {
        // Hold or reactivate: update recurrence via PUT
        const putPayload: Record<string, unknown> = {
          name: sub.name,
          prefix: sub.prefix,
        };

        if (recurrence) {
          putPayload.recurrence = {
            termStartDate: recurrence.termStartDate,
            billingStartDate: recurrence.billingStartDate,
            isAutoRenewed: isHoldAction ? false : isReactivate ? true : recurrence.isAutoRenewed,
            allowProration: recurrence.allowProration,
            trialLengthInDays: recurrence.trialLengthInDays,
            invoiceLengthInDays: recurrence.invoiceLengthInDays,
            billingPeriodId: (recurrence.billingPeriod as Record<string, unknown> | undefined)?.billingPeriodId,
            schedule: recurrence.schedule,
          };
        }

        try {
          await iqproPut<Record<string, unknown>>(subPath, putPayload);
        }
        catch (putErr) {
          console.error('[membership] IQPro subscription update failed:', putErr);
        }
      }
    }

    // ── Update local records ─────────────────────────────────────────────────
    let newStatus: string;
    if (body.action === 'cancel') {
      newStatus = 'cancelled';
    }
    else if (body.action === 'hold') {
      newStatus = 'hold';
    }
    else {
      newStatus = 'active';
    }

    const updateFields: Record<string, unknown> = {
      status: newStatus,
      updatedAt: now,
    };

    if (body.action === 'cancel') {
      updateFields.endDate = now;
    }

    await db.update(memberMembership)
      .set(updateFields)
      .where(eq(memberMembership.id, body.memberMembershipId));

    let memberStatus: string;
    if (body.action === 'cancel') {
      memberStatus = 'inactive';
    }
    else if (body.action === 'hold') {
      memberStatus = 'hold';
    }
    else {
      memberStatus = 'active';
    }

    await db.update(member)
      .set({ status: memberStatus, statusChangedAt: now, updatedAt: now })
      .where(eq(member.id, memberId));

    // ── Send cancellation email ──────────────────────────────────────────────
    if (body.action === 'cancel' && m.email) {
      sendCancellationConfirmation({
        toEmail: m.email,
        firstName: m.firstName,
        lastName: m.lastName,
        planName: plan?.name ?? 'Membership',
        cancelledAt: now,
        cancellationFee: cancellationFeeCharged > 0 ? cancellationFeeCharged : undefined,
        cancellationTxId,
      }).catch(() => {});
    }

    return NextResponse.json({
      success: true,
      status: newStatus,
      cancellationFeeCharged,
    });
  }
  catch (error) {
    console.error('[members/[memberId]/membership] PATCH Error:', error);
    return NextResponse.json({ error: 'Failed to update membership' }, { status: 500 });
  }
}

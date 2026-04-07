import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database';
import { validateDevice } from '@/lib/deviceAuth';
import { iqproGet, iqproPut, isIQProConfigured } from '@/lib/iqpro';
import { member, memberMembership } from '@/lib/memberSchema';

// IQPro subscription status IDs
const IQPRO_STATUS_ACTIVE = 1;
const IQPRO_STATUS_CANCELLED = 3;
// Note: IQPRO_STATUS_SUSPENDED (2) exists but IQPro won't accept it for
// Draft/Scheduled subscriptions. Hold is implemented via isAutoCharged=false.

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

    // Verify the member belongs to this org
    const members = await db
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.id, memberId), eq(member.organizationId, orgId)))
      .limit(1);

    if (!members[0]) {
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

    const gatewayId = process.env.IQPRO_GATEWAY_ID;

    // Update IQPro subscription if one exists
    if (membership.iqproSubscriptionId && isIQProConfigured() && gatewayId) {
      try {
        // Fetch full existing subscription so we can echo back all required
        // fields — IQPro's PUT replaces the entire resource and returns 400/500
        // if required fields are missing.
        const subPath = `/api/gateway/${gatewayId}/subscription/${membership.iqproSubscriptionId}`;
        const subRes = await iqproGet<{ data?: Record<string, unknown> }>(subPath);
        const existing = (subRes.data ?? subRes) as Record<string, unknown>;

        // Build a minimal update payload with only the writable fields.
        const sub = existing as Record<string, unknown>;
        const recurrence = sub.recurrence as Record<string, unknown> | undefined;

        // IQPro won't let you suspend a Draft/Scheduled subscription.
        // For hold: disable auto-renewal to stop payments.
        // For reactivate: re-enable auto-renewal.
        // For cancel: set status Cancelled.
        // We omit paymentMethod entirely — IQPro preserves the existing one.
        const isHoldAction = body.action === 'hold';
        const isReactivate = body.action === 'reactivate';

        await iqproPut(subPath, {
          subscriptionStatusId: body.action === 'cancel'
            ? IQPRO_STATUS_CANCELLED
            : (sub.status as Record<string, unknown>)?.subscriptionStatusId ?? IQPRO_STATUS_ACTIVE,
          name: sub.name,
          prefix: sub.prefix,
          recurrence: recurrence
            ? {
                termStartDate: recurrence.termStartDate,
                billingStartDate: recurrence.billingStartDate,
                isAutoRenewed: isHoldAction ? false : isReactivate ? true : recurrence.isAutoRenewed,
                allowProration: recurrence.allowProration,
                trialLengthInDays: recurrence.trialLengthInDays,
                invoiceLengthInDays: recurrence.invoiceLengthInDays,
                billingPeriodId: (recurrence.billingPeriod as Record<string, unknown> | undefined)?.billingPeriodId,
                schedule: recurrence.schedule,
              }
            : undefined,
        });
      }
      catch (iqErr) {
        console.error('[membership] IQPro subscription update failed:', iqErr);
        // Continue with local update even if IQPro fails
      }
    }

    // Update local membership record
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

    // Update the member's status to reflect the membership change
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

    return NextResponse.json({
      success: true,
      status: newStatus,
    });
  }
  catch (error) {
    console.error('[members/[memberId]/membership] PATCH Error:', error);
    return NextResponse.json({ error: 'Failed to update membership' }, { status: 500 });
  }
}

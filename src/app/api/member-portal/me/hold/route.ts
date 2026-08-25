import { randomUUID } from 'node:crypto';
import { and, count, eq, gte } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { auditEvent, member, memberMembership, membershipPlan } from '@/lib/memberSchema';
import { getSessionFromCookie } from '@/lib/memberSession';
import { getDatabaseForOrg } from '@/lib/tenantDirectory';

type DB = Awaited<ReturnType<typeof getDatabaseForOrg>>;

// Count successful holds for a membership in the trailing 12 months. Reads the
// SAME audit action the staff lifecycle route writes, so the per-year limit is
// enforced consistently no matter which surface performed the hold.
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

export async function POST(request: Request) {
  try {
    const session = await getSessionFromCookie(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json() as { action: 'hold' | 'resume' };
    const action = body.action;

    if (action !== 'hold' && action !== 'resume') {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    const db = await getDatabaseForOrg(session.orgId);
    const now = new Date();
    const fromStatus = action === 'hold' ? 'active' : 'hold';
    const toStatus = action === 'hold' ? 'hold' : 'active';

    // Load the member's memberships in the source state, with their plan's
    // per-year hold limit.
    const rows = await db
      .select({
        membershipId: memberMembership.id,
        holdLimitPerYear: membershipPlan.holdLimitPerYear,
      })
      .from(memberMembership)
      .innerJoin(member, eq(memberMembership.memberId, member.id))
      .innerJoin(membershipPlan, eq(memberMembership.membershipPlanId, membershipPlan.id))
      .where(and(
        eq(memberMembership.memberId, session.memberId),
        eq(member.organizationId, session.orgId),
        eq(memberMembership.status, fromStatus),
      ));

    if (rows.length === 0) {
      return NextResponse.json(
        { error: action === 'hold' ? 'No active membership to hold' : 'No held membership to resume' },
        { status: 409 },
      );
    }

    // Enforce the per-year hold limit before making any change (holds only).
    if (action === 'hold') {
      for (const row of rows) {
        const limit = row.holdLimitPerYear;
        if (limit != null && limit > 0) {
          const priorHolds = await countRecentHolds(db, row.membershipId, session.orgId);
          if (priorHolds >= limit) {
            return NextResponse.json(
              { error: `You've reached the hold limit of ${limit} for this membership this year. Please contact the front desk.` },
              { status: 409 },
            );
          }
        }
      }
    }

    await db.transaction(async (tx) => {
      for (const row of rows) {
        await tx.update(memberMembership)
          .set({ status: toStatus, updatedAt: now })
          .where(eq(memberMembership.id, row.membershipId));

        // On a hold, write the success audit row that countRecentHolds reads —
        // keeping the cross-surface hold counter accurate.
        if (action === 'hold') {
          await tx.insert(auditEvent).values({
            id: randomUUID(),
            organizationId: session.orgId,
            userId: session.actingStaffEmail ?? 'member',
            action: 'memberMembership.hold',
            entityType: 'memberMembership',
            entityId: row.membershipId,
            role: session.actingStaffEmail ? 'staff' : 'member',
            status: 'success',
            changes: JSON.stringify({ via: 'member-portal', selfService: true }),
            timestamp: now,
          });
        }
      }

      await tx.update(member)
        .set({ status: toStatus, statusChangedAt: now, updatedAt: now })
        .where(and(eq(member.id, session.memberId), eq(member.organizationId, session.orgId)));
    });

    return NextResponse.json({ success: true, status: toStatus });
  }
  catch (error) {
    console.error('[member-portal/me/hold] Error:', error);
    return NextResponse.json({ error: 'Failed to update membership' }, { status: 500 });
  }
}

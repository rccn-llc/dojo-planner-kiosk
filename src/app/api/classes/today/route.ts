import type { NextRequest } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database';
import { validateDevice } from '@/lib/deviceAuth';
import {
  classScheduleInstance,
  dojoClass,
  member,
  memberMembership,
} from '@/lib/memberSchema';

export async function GET(request: NextRequest) {
  try {
    const device = await validateDevice(request);
    const orgId = device?.orgId ?? process.env.ORGANIZATION_ID;

    if (!orgId) {
      return NextResponse.json({ error: 'Organization context not available' }, { status: 500 });
    }

    const memberId = request.nextUrl.searchParams.get('memberId');
    if (!memberId) {
      return NextResponse.json({ error: 'memberId is required' }, { status: 400 });
    }

    const db = getDatabase();

    // Check if member has an active membership
    const activeMemberships = await db
      .select({ id: memberMembership.id, status: memberMembership.status })
      .from(memberMembership)
      .where(
        and(
          eq(memberMembership.memberId, memberId),
          eq(memberMembership.status, 'active'),
        ),
      )
      .limit(1);

    if (activeMemberships.length === 0) {
      // Also check member status
      const memberRows = await db
        .select({ status: member.status })
        .from(member)
        .where(eq(member.id, memberId))
        .limit(1);

      const memberStatus = memberRows[0]?.status;
      if (!memberStatus || memberStatus === 'cancelled' || memberStatus === 'past_due') {
        return NextResponse.json({
          membershipStatus: 'no_membership',
          message: 'No active membership found. Please sign up for a membership to check in.',
          classes: [],
        });
      }

      // Member has trial/active status but no membership record — allow access
      if (memberStatus !== 'active' && memberStatus !== 'trial') {
        return NextResponse.json({
          membershipStatus: 'inactive',
          message: 'Your membership is not currently active.',
          classes: [],
        });
      }
    }

    // Get today's day of week (0 = Sunday)
    const today = new Date();
    const dayOfWeek = today.getDay();

    // Fetch today's class schedule instances for this org
    const schedules = await db
      .select({
        scheduleId: classScheduleInstance.id,
        classId: classScheduleInstance.classId,
        startTime: classScheduleInstance.startTime,
        endTime: classScheduleInstance.endTime,
        room: classScheduleInstance.room,
        className: dojoClass.name,
      })
      .from(classScheduleInstance)
      .innerJoin(dojoClass, eq(classScheduleInstance.classId, dojoClass.id))
      .where(
        and(
          eq(dojoClass.organizationId, orgId),
          eq(classScheduleInstance.dayOfWeek, dayOfWeek),
          eq(classScheduleInstance.isActive, true),
          eq(dojoClass.isActive, true),
        ),
      );

    return NextResponse.json({
      membershipStatus: 'active',
      classes: schedules.map(s => ({
        scheduleId: s.scheduleId,
        classId: s.classId,
        className: s.className,
        startTime: s.startTime,
        endTime: s.endTime,
        room: s.room,
      })),
    });
  }
  catch (error) {
    console.error('[classes/today] Error:', error);
    return NextResponse.json({ error: 'Failed to load classes' }, { status: 500 });
  }
}

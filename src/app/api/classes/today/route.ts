import type { NextRequest } from 'next/server';
import { and, eq, gte, inArray, lt } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database';
import { validateDevice } from '@/lib/deviceAuth';
import {
  attendance,
  classScheduleInstance,
  dojoClass,
  member,
  memberMembership,
  membershipPlan,
  program,
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
      .select({
        id: memberMembership.id,
        status: memberMembership.status,
        membershipPlanId: memberMembership.membershipPlanId,
      })
      .from(memberMembership)
      .where(
        and(
          eq(memberMembership.memberId, memberId),
          eq(memberMembership.status, 'active'),
        ),
      );

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

      // Member has trial/active status but no membership record -- allow access
      if (memberStatus !== 'active' && memberStatus !== 'trial') {
        return NextResponse.json({
          membershipStatus: 'inactive',
          message: 'Your membership is not currently active.',
          classes: [],
        });
      }
    }

    // Determine allowed program IDs based on membership plans
    let accessLevel = 'limited';
    const allowedProgramIds: string[] = [];

    if (activeMemberships.length > 0) {
      const planIds = activeMemberships.map(m => m.membershipPlanId);

      const plans = await db
        .select({
          programId: membershipPlan.programId,
          accessLevel: membershipPlan.accessLevel,
        })
        .from(membershipPlan)
        .where(inArray(membershipPlan.id, planIds));

      for (const p of plans) {
        if (p.accessLevel === 'Unlimited') {
          accessLevel = 'Unlimited';
        }
        if (p.programId) {
          allowedProgramIds.push(p.programId);
        }
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
        programId: dojoClass.programId,
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

    // Filter by allowed programs unless member has Unlimited access
    const filteredSchedules = accessLevel === 'Unlimited'
      ? schedules
      : schedules.filter((s) => {
          // Classes without a program are open to everyone
          if (!s.programId) {
            return true;
          }
          return allowedProgramIds.includes(s.programId);
        });

    // Exclude classes the member has already checked into today
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);

    const scheduleIds = filteredSchedules.map(s => s.scheduleId);
    const checkedInScheduleIds = new Set<string>();

    if (scheduleIds.length > 0) {
      const existingCheckins = await db
        .select({ classScheduleInstanceId: attendance.classScheduleInstanceId })
        .from(attendance)
        .where(
          and(
            eq(attendance.memberId, memberId),
            inArray(attendance.classScheduleInstanceId, scheduleIds),
            gte(attendance.attendanceDate, todayStart),
            lt(attendance.attendanceDate, tomorrowStart),
          ),
        );

      for (const row of existingCheckins) {
        if (row.classScheduleInstanceId) {
          checkedInScheduleIds.add(row.classScheduleInstanceId);
        }
      }
    }

    const availableSchedules = filteredSchedules.filter(s => !checkedInScheduleIds.has(s.scheduleId));

    // Verify program names for display
    const programIds = [...new Set(availableSchedules.map(s => s.programId).filter(Boolean) as string[])];
    const programMap = new Map<string, string>();

    if (programIds.length > 0) {
      const programs = await db
        .select({ id: program.id, name: program.name })
        .from(program)
        .where(inArray(program.id, programIds));

      for (const p of programs) {
        programMap.set(p.id, p.name);
      }
    }

    return NextResponse.json({
      membershipStatus: 'active',
      accessLevel,
      classes: availableSchedules.map(s => ({
        scheduleId: s.scheduleId,
        classId: s.classId,
        className: s.className,
        startTime: s.startTime,
        endTime: s.endTime,
        room: s.room,
        programName: s.programId ? programMap.get(s.programId) : undefined,
      })),
    });
  }
  catch (error) {
    console.error('[classes/today] Error:', error);
    return NextResponse.json({ error: 'Failed to load classes' }, { status: 500 });
  }
}

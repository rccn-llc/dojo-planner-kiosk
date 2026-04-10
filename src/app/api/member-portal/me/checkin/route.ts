import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database';
import {
  attendance,
  classScheduleInstance,
  dojoClass,
  member,
  memberMembership,
} from '@/lib/memberSchema';
import { getSessionFromCookie } from '@/lib/memberSession';

export async function POST(request: Request) {
  try {
    const session = await getSessionFromCookie(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json() as { classScheduleInstanceId?: string };
    const scheduleId = body.classScheduleInstanceId;

    if (!scheduleId) {
      return NextResponse.json({ error: 'classScheduleInstanceId is required' }, { status: 400 });
    }

    const db = getDatabase();
    const now = new Date();

    // Verify active membership
    const activeMemberships = await db
      .select({ id: memberMembership.id })
      .from(memberMembership)
      .where(
        and(
          eq(memberMembership.memberId, session.memberId),
          eq(memberMembership.status, 'active'),
        ),
      )
      .limit(1);

    if (activeMemberships.length === 0) {
      // Also check trial status
      const memberRows = await db
        .select({ status: member.status })
        .from(member)
        .where(eq(member.id, session.memberId))
        .limit(1);

      const memberStatus = memberRows[0]?.status;
      if (memberStatus !== 'active' && memberStatus !== 'trial') {
        return NextResponse.json({ error: 'No active membership' }, { status: 403 });
      }
    }

    await db.insert(attendance).values({
      id: randomUUID(),
      organizationId: session.orgId,
      memberId: session.memberId,
      classScheduleInstanceId: scheduleId,
      attendanceDate: now,
      checkInTime: now,
      checkInMethod: 'app',
    });

    return NextResponse.json({ success: true });
  }
  catch (error) {
    console.error('[member-portal/me/checkin] Error:', error);
    return NextResponse.json({ error: 'Check-in failed' }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const session = await getSessionFromCookie(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = getDatabase();
    const today = new Date();
    const dayOfWeek = today.getDay();

    // Fetch today's classes for the member's org
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
          eq(dojoClass.organizationId, session.orgId),
          eq(classScheduleInstance.dayOfWeek, dayOfWeek),
          eq(classScheduleInstance.isActive, true),
          eq(dojoClass.isActive, true),
        ),
      );

    return NextResponse.json({
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
    console.error('[member-portal/me/checkin] GET Error:', error);
    return NextResponse.json({ error: 'Failed to load classes' }, { status: 500 });
  }
}

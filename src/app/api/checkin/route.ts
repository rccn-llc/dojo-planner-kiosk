import { randomUUID } from 'node:crypto';
import { and, eq, gte, lt } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { resolveOrgIdFromRequest } from '@/lib/clerk';
import { withRetry } from '@/lib/database';
import { validateDevice } from '@/lib/deviceAuth';
import { attendance, classScheduleInstance, dojoClass } from '@/lib/memberSchema';

export async function POST(request: Request) {
  try {
    let orgId = await resolveOrgIdFromRequest(request);
    if (!orgId) {
      const device = await validateDevice(request);
      orgId = device?.orgId ?? process.env.ORGANIZATION_ID ?? null;
    }
    if (!orgId) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 400 });
    }

    const body = await request.json() as {
      memberId: string;
      classScheduleInstanceId: string;
    };

    if (!body.memberId || !body.classScheduleInstanceId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);

    const result = await withRetry(async (db) => {
      // Defense in depth: the class list already hides walk-in-disabled classes,
      // but reject here too in case a stale client posts one. Only an explicit
      // 'No' blocks; 'Yes' and legacy NULL rows are allowed.
      const [scheduledClass] = await db
        .select({ allowWalkIns: dojoClass.allowWalkIns })
        .from(classScheduleInstance)
        .innerJoin(dojoClass, eq(classScheduleInstance.classId, dojoClass.id))
        .where(eq(classScheduleInstance.id, body.classScheduleInstanceId))
        .limit(1);

      if (scheduledClass?.allowWalkIns === 'No') {
        return { walkInsDisabled: true } as const;
      }

      // Check for existing check-in to this class today
      const [existing] = await db
        .select({ id: attendance.id })
        .from(attendance)
        .where(
          and(
            eq(attendance.memberId, body.memberId),
            eq(attendance.classScheduleInstanceId, body.classScheduleInstanceId),
            gte(attendance.attendanceDate, todayStart),
            lt(attendance.attendanceDate, tomorrowStart),
          ),
        )
        .limit(1);

      if (existing) {
        return { alreadyCheckedIn: true } as const;
      }

      await db.insert(attendance).values({
        id: randomUUID(),
        organizationId: orgId,
        memberId: body.memberId,
        classScheduleInstanceId: body.classScheduleInstanceId,
        attendanceDate: now,
        checkInTime: now,
        checkInMethod: 'kiosk',
      });

      return { alreadyCheckedIn: false } as const;
    });

    if ('walkInsDisabled' in result) {
      return NextResponse.json({
        success: false,
        error: 'This class does not accept walk-in check-ins. Please see the front desk.',
      });
    }

    if (result.alreadyCheckedIn) {
      return NextResponse.json({
        success: false,
        error: 'You are already checked in to this class today.',
        alreadyCheckedIn: true,
      });
    }

    return NextResponse.json({ success: true });
  }
  catch (error) {
    console.error('[checkin] Error:', error);
    return NextResponse.json({ success: false, error: 'Check-in failed' }, { status: 500 });
  }
}

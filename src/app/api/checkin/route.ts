import { randomUUID } from 'node:crypto';
import { and, eq, gte, lt } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { withRetry } from '@/lib/database';
import { validateDevice } from '@/lib/deviceAuth';
import { attendance } from '@/lib/memberSchema';

export async function POST(request: Request) {
  try {
    const device = await validateDevice(request);
    const orgId = device?.orgId ?? process.env.ORGANIZATION_ID;

    if (!orgId) {
      return NextResponse.json({ error: 'Organization context not available' }, { status: 500 });
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
        return { alreadyCheckedIn: true };
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

      return { alreadyCheckedIn: false };
    });

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

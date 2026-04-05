import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database';
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

    const db = getDatabase();
    const now = new Date();

    await db.insert(attendance).values({
      id: randomUUID(),
      organizationId: orgId,
      memberId: body.memberId,
      classScheduleInstanceId: body.classScheduleInstanceId,
      attendanceDate: now,
      checkInTime: now,
      checkInMethod: 'kiosk',
    });

    return NextResponse.json({ success: true });
  }
  catch (error) {
    console.error('[checkin] Error:', error);
    return NextResponse.json({ success: false, error: 'Check-in failed' }, { status: 500 });
  }
}

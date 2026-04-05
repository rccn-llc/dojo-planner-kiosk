import { desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database';
import { signedWaiver } from '@/lib/memberSchema';
import { getSessionFromCookie } from '@/lib/memberSession';

export async function GET(request: Request) {
  try {
    const session = await getSessionFromCookie(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = getDatabase();

    const waivers = await db
      .select({
        id: signedWaiver.id,
        membershipPlanName: signedWaiver.membershipPlanName,
        signedByName: signedWaiver.signedByName,
        signedAt: signedWaiver.signedAt,
      })
      .from(signedWaiver)
      .where(eq(signedWaiver.memberId, session.memberId))
      .orderBy(desc(signedWaiver.signedAt));

    return NextResponse.json({
      waivers: waivers.map(w => ({
        id: w.id,
        membershipPlanName: w.membershipPlanName,
        signedByName: w.signedByName,
        signedAt: w.signedAt?.toISOString() ?? null,
      })),
    });
  }
  catch (error) {
    console.error('[member-portal/me/waivers] Error:', error);
    return NextResponse.json({ error: 'Failed to load waivers' }, { status: 500 });
  }
}

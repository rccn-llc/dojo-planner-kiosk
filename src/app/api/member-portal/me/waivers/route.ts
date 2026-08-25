import { and, desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { signedWaiver } from '@/lib/memberSchema';
import { getSessionFromCookie } from '@/lib/memberSession';
import { getDatabaseForOrg } from '@/lib/tenantDirectory';

export async function GET(request: Request) {
  try {
    const session = await getSessionFromCookie(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = await getDatabaseForOrg(session.orgId);

    const waivers = await db
      .select({
        id: signedWaiver.id,
        membershipPlanName: signedWaiver.membershipPlanName,
        signedByName: signedWaiver.signedByName,
        signedAt: signedWaiver.signedAt,
      })
      .from(signedWaiver)
      .where(and(
        eq(signedWaiver.memberId, session.memberId),
        eq(signedWaiver.organizationId, session.orgId),
      ))
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

import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database';
import { member } from '@/lib/memberSchema';
import { createMemberSession, setSessionCookie } from '@/lib/memberSession';
import { verifyOTP } from '@/lib/otp';

const SESSION_DURATION_SECONDS = 24 * 60 * 60; // 24 hours

export async function POST(request: Request) {
  try {
    const body = await request.json() as { memberId?: string; code?: string; orgId?: string };
    const memberId = body.memberId?.trim() ?? '';
    const code = body.code?.trim() ?? '';
    const orgId = body.orgId?.trim() ?? '';

    if (!memberId || !code) {
      return NextResponse.json({ verified: false, error: 'Missing required fields' }, { status: 400 });
    }

    const result = await verifyOTP(memberId, code);
    if (!result.verified) {
      return NextResponse.json({
        verified: false,
        reason: result.reason,
        attemptsRemaining: result.attemptsRemaining,
      });
    }

    // Fetch member details for session
    const db = getDatabase();
    const members = await db
      .select({
        id: member.id,
        firstName: member.firstName,
        lastName: member.lastName,
        email: member.email,
        organizationId: member.organizationId,
      })
      .from(member)
      .where(eq(member.id, memberId))
      .limit(1);

    const m = members[0];
    if (!m) {
      return NextResponse.json({ verified: false, error: 'Member not found' }, { status: 404 });
    }

    const sessionOrgId = orgId || m.organizationId;

    // Create session token
    const token = await createMemberSession(
      {
        memberId: m.id,
        orgId: sessionOrgId,
        firstName: m.firstName,
        lastName: m.lastName,
        email: m.email,
      },
      SESSION_DURATION_SECONDS,
    );

    const response = NextResponse.json({
      verified: true,
      token,
      member: {
        id: m.id,
        firstName: m.firstName,
        lastName: m.lastName,
        email: m.email,
      },
    });

    setSessionCookie(response, token, SESSION_DURATION_SECONDS);
    return response;
  }
  catch (error) {
    console.error('[member-portal/verify-otp] Error:', error);
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 });
  }
}

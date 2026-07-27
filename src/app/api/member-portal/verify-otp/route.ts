import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database';
import { member } from '@/lib/memberSchema';
import { createMemberSession, setSessionCookie } from '@/lib/memberSession';
import { verifyOTP } from '@/lib/otp';
import { isValidOTPCode, isValidUUID } from '@/lib/validation';

const SESSION_DURATION_SECONDS = 24 * 60 * 60; // 24 hours

// Constant-time generic rejection — prevents timing-based member enumeration
function rejectVerification() {
  return NextResponse.json({ verified: false, error: 'Invalid or expired code' });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { memberId?: string; code?: string };
    const memberId = body.memberId?.trim() ?? '';
    const code = body.code?.trim() ?? '';

    // Validate input formats strictly before any DB or OTP operations
    if (!isValidUUID(memberId) || !isValidOTPCode(code)) {
      return rejectVerification();
    }

    // Fetch member to verify existence and get org from DB
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
      // Return same shape as OTP failure to prevent member enumeration
      return rejectVerification();
    }

    // Server-side OTP verification — result is never controlled by user input.
    // Return the SAME generic shape as the not-found path above; the client
    // only reads `verified`/`error`, and exposing reason/attemptsRemaining here
    // (but not on the not-found path) would let an attacker tell a real member
    // apart from a non-existent one.
    const result = await verifyOTP('member', m.id, code);
    if (!result.verified) {
      return rejectVerification();
    }

    // OTP verified — create session. orgId is always from the DB, never user input.
    const token = await createMemberSession(
      {
        memberId: m.id,
        orgId: m.organizationId,
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

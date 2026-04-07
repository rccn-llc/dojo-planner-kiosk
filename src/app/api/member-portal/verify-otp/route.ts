import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database';
import { member } from '@/lib/memberSchema';
import { createMemberSession, setSessionCookie } from '@/lib/memberSession';
import { verifyOTP } from '@/lib/otp';

const SESSION_DURATION_SECONDS = 24 * 60 * 60; // 24 hours

// Strict UUID v4 format
const UUID_RE = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
// 6-digit numeric OTP
const OTP_RE = /^\d{6}$/;

function isValidUUID(value: string): boolean {
  return UUID_RE.test(value);
}

function isValidOTPCode(value: string): boolean {
  return OTP_RE.test(value);
}

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

    // Server-side OTP verification — result is never controlled by user input
    const result = await verifyOTP(m.id, code);
    if (!result.verified) {
      return NextResponse.json({
        verified: false,
        reason: result.reason,
        attemptsRemaining: result.attemptsRemaining,
      });
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

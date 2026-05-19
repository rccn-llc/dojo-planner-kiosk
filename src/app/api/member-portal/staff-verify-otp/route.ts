import { createClerkClient } from '@clerk/backend';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database';
import { member } from '@/lib/memberSchema';
import { createMemberSession, setSessionCookie } from '@/lib/memberSession';
import { verifyOTP } from '@/lib/otp';

const ELIGIBLE_ROLES = new Set(['org:admin', 'org:academy_owner', 'org:front_desk']);
const SESSION_DURATION_SECONDS = 24 * 60 * 60; // 24 hours

const UUID_RE = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
const OTP_RE = /^\d{6}$/;
const CLERK_USER_ID_RE = /^user_[A-Za-z0-9]{8,}$/;

function rejectVerification() {
  return NextResponse.json({ verified: false, error: 'Invalid or expired code' });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      memberId?: string;
      staffClerkUserId?: string;
      code?: string;
    };
    const memberId = body.memberId?.trim() ?? '';
    const staffClerkUserId = body.staffClerkUserId?.trim() ?? '';
    const code = body.code?.trim() ?? '';

    if (!UUID_RE.test(memberId) || !CLERK_USER_ID_RE.test(staffClerkUserId) || !OTP_RE.test(code)) {
      return rejectVerification();
    }

    // Fetch member from DB — we need their org + identity to mint the session
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
      return rejectVerification();
    }

    // Confirm the staff is still in this org with an eligible role and resolve
    // their primary email for the audit claim.
    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) {
      return rejectVerification();
    }

    const clerk = createClerkClient({ secretKey });
    const memberships = await clerk.users.getOrganizationMembershipList({ userId: staffClerkUserId });
    const orgMembership = memberships.data.find(om => om.organization.id === m.organizationId);
    if (!orgMembership || !ELIGIBLE_ROLES.has(orgMembership.role)) {
      return rejectVerification();
    }

    const staffUser = await clerk.users.getUser(staffClerkUserId);
    const primary = staffUser.emailAddresses.find(e => e.id === staffUser.primaryEmailAddressId)
      ?? staffUser.emailAddresses[0];
    const staffEmail = primary?.emailAddress;
    if (!staffEmail) {
      return rejectVerification();
    }

    // Verify the staff OTP
    const result = await verifyOTP('staff', staffClerkUserId, code);
    if (!result.verified) {
      return NextResponse.json({
        verified: false,
        reason: result.reason,
        attemptsRemaining: result.attemptsRemaining,
      });
    }

    // Mint session impersonating the member, tagged with the acting staff email.
    const token = await createMemberSession(
      {
        memberId: m.id,
        orgId: m.organizationId,
        firstName: m.firstName,
        lastName: m.lastName,
        email: m.email,
        actingStaffEmail: staffEmail,
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
    console.error('[member-portal/staff-verify-otp] Error:', error);
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 });
  }
}

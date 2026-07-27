import { createClerkClient } from '@clerk/backend';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database';
import { member } from '@/lib/memberSchema';
import { createMemberSession, setSessionCookie } from '@/lib/memberSession';
import { verifyOTP } from '@/lib/otp';
import { isValidClerkUserId, isValidOTPCode, isValidUUID } from '@/lib/validation';

const ELIGIBLE_ROLES = new Set(['org:admin', 'org:academy_owner', 'org:front_desk']);
// Staff-impersonation sessions are short-lived: a staff member unlocks a
// member's portal to help in person, so the session should not outlive that
// interaction (vs. the 24h TTL for a member's own self-login).
const SESSION_DURATION_SECONDS = 45 * 60; // 45 minutes

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

    if (!isValidUUID(memberId) || !isValidClerkUserId(staffClerkUserId) || !isValidOTPCode(code)) {
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

    // Verify the staff OTP. Return the SAME generic shape as every other
    // rejection above so a wrong code can't be told apart from an invalid
    // staff id / member (the client only reads verified/error).
    const result = await verifyOTP('staff', staffClerkUserId, code);
    if (!result.verified) {
      return rejectVerification();
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

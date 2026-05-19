import { createClerkClient } from '@clerk/backend';
import { NextResponse } from 'next/server';
import { resolveOrgBySlug } from '@/lib/clerk';
import { generateOTP, storeOTP } from '@/lib/otp';

const ELIGIBLE_ROLES = new Set(['org:admin', 'org:academy_owner', 'org:front_desk']);

// Strict Clerk user ID format (e.g. user_2abc...). Reject anything else
// before doing any Clerk API work to keep the response shape uniform.
const CLERK_USER_ID_RE = /^user_[A-Za-z0-9]{8,}$/;
const UUID_RE = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!user || !domain) {
    return email;
  }
  const maskedUser = user.length > 2
    ? `${user[0]}${'*'.repeat(user.length - 2)}${user[user.length - 1]}`
    : user;
  return `${maskedUser}@${domain}`;
}

// Generic "sent" response — returned even when the staff doesn't exist or
// isn't eligible, so we don't leak which Clerk user IDs are valid staff.
function fakeSent() {
  return NextResponse.json({ sent: true, maskedEmail: '' });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      memberId?: string;
      staffClerkUserId?: string;
      orgSlug?: string;
    };
    const memberId = body.memberId?.trim() ?? '';
    const staffClerkUserId = body.staffClerkUserId?.trim() ?? '';
    const orgSlug = body.orgSlug?.trim() ?? '';

    if (!UUID_RE.test(memberId) || !CLERK_USER_ID_RE.test(staffClerkUserId) || !orgSlug) {
      return fakeSent();
    }

    // Resolve org
    let orgId: string;
    if (orgSlug === '_kiosk') {
      const envOrgId = process.env.ORGANIZATION_ID;
      if (!envOrgId) {
        return fakeSent();
      }
      orgId = envOrgId;
    }
    else {
      const org = await resolveOrgBySlug(orgSlug);
      if (!org) {
        return fakeSent();
      }
      orgId = org.orgId;
    }

    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) {
      return fakeSent();
    }

    const clerk = createClerkClient({ secretKey });

    // Verify the staff is in this org with an eligible role.
    const memberships = await clerk.users.getOrganizationMembershipList({ userId: staffClerkUserId });
    const orgMembership = memberships.data.find(m => m.organization.id === orgId);
    if (!orgMembership || !ELIGIBLE_ROLES.has(orgMembership.role)) {
      return fakeSent();
    }

    // Fetch staff user to get their primary verified email
    const user = await clerk.users.getUser(staffClerkUserId);
    const primary = user.emailAddresses.find(e => e.id === user.primaryEmailAddressId)
      ?? user.emailAddresses[0];
    const staffEmail = primary?.emailAddress;
    if (!staffEmail) {
      return fakeSent();
    }

    // Rate-limit + store the OTP
    const code = generateOTP();
    const stored = await storeOTP('staff', staffClerkUserId, code);
    if (!stored) {
      return NextResponse.json(
        { error: 'Too many requests. Please wait a few minutes.' },
        { status: 429 },
      );
    }

    // Send via Resend
    const resendApiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.RESEND_FROM_EMAIL || 'noreply@dojoplanner.com';

    const greetingName = user.firstName || 'there';

    if (resendApiKey) {
      const { Resend } = await import('resend');
      const resend = new Resend(resendApiKey);

      await resend.emails.send({
        from: fromEmail,
        to: staffEmail,
        subject: 'Member portal access code',
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 400px; margin: 0 auto; padding: 40px 20px;">
            <h1 style="font-size: 24px; color: #111827; margin-bottom: 8px;">Member Portal Access</h1>
            <p style="color: #6b7280; margin-bottom: 24px;">Hi ${greetingName}, use this code to unlock a member's portal at the kiosk:</p>
            <div style="background: #f3f4f6; border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 24px;">
              <span style="font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #111827;">${code}</span>
            </div>
            <p style="color: #9ca3af; font-size: 14px;">This code expires in 5 minutes. If you didn't request it, you can ignore this email.</p>
          </div>
        `,
      });
    }
    else {
      // Development: log OTP to console (strip CR/LF to prevent log injection)
      const safeEmail = String(staffEmail).replace(/[\r\n]+/g, '');
      console.warn(`[staff OTP] Code for ${safeEmail}: ${code}`);
    }

    return NextResponse.json({ sent: true, maskedEmail: maskEmail(staffEmail) });
  }
  catch (error) {
    console.error('[member-portal/staff-send-otp] Error:', error);
    // Still return the generic success shape so failures don't enumerate.
    return fakeSent();
  }
}

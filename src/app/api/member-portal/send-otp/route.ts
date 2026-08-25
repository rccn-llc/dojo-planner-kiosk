import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { resolveOrgIdFromRequestOrBody } from '@/lib/clerk';
import { member } from '@/lib/memberSchema';
import { generateOTP, storeOTP } from '@/lib/otp';
import { clientIp, rateLimit } from '@/lib/rateLimit';
import { getDatabaseForOrg } from '@/lib/tenantDirectory';
import { escapeHtml, maskEmail } from '@/lib/utils';
import { isValidUUID } from '@/lib/validation';

// Generic "sent" response — returned even when the member doesn't exist, is
// invalid, or is rate-limited, so this endpoint can't be used as a
// member-existence oracle. Mirrors staff-send-otp's fakeSent().
function fakeSent() {
  return NextResponse.json({ sent: true, maskedEmail: '' });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { memberId?: string; orgSlug?: string };
    const memberId = body.memberId?.trim() ?? '';

    if (!isValidUUID(memberId)) {
      return fakeSent();
    }

    // The member lookup below was previously UNSCOPED — a member UUID from any
    // organization resolved and got an OTP emailed. Scoping it also picks the
    // right database once organizations are split apart.
    const orgId = await resolveOrgIdFromRequestOrBody(request, body);
    if (!orgId) {
      return fakeSent();
    }

    // Per-IP rate limit on top of the per-member send cap inside storeOTP, so
    // an attacker can't email-bomb across many member ids from one host.
    const allowed = await rateLimit(`send-otp:${clientIp(request)}`, 10, 10 * 60 * 1000);
    if (!allowed) {
      return fakeSent();
    }

    const db = await getDatabaseForOrg(orgId);

    // Fetch member email
    const members = await db
      .select({ email: member.email, firstName: member.firstName })
      .from(member)
      .where(and(eq(member.id, memberId), eq(member.organizationId, orgId)))
      .limit(1);

    const m = members[0];
    if (!m || !m.email) {
      // Same generic shape as a real send — no 404, so existent and
      // non-existent members are indistinguishable.
      return fakeSent();
    }

    // Generate and store OTP. On the per-member send cap, return the SAME
    // generic shape (a distinct 429 would only fire for real members).
    const code = generateOTP();
    const stored = await storeOTP('member', memberId, code);
    if (!stored) {
      return fakeSent();
    }

    // Send OTP via email
    const resendApiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.RESEND_FROM_EMAIL || 'noreply@dojoplanner.com';

    if (resendApiKey) {
      const { Resend } = await import('resend');
      const resend = new Resend(resendApiKey);

      await resend.emails.send({
        from: fromEmail,
        to: m.email,
        subject: 'Your verification code',
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 400px; margin: 0 auto; padding: 40px 20px;">
            <h1 style="font-size: 24px; color: #111827; margin-bottom: 8px;">Your Verification Code</h1>
            <p style="color: #6b7280; margin-bottom: 24px;">Hi ${escapeHtml(m.firstName)}, use this code to sign in:</p>
            <div style="background: #f3f4f6; border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 24px;">
              <span style="font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #111827;">${code}</span>
            </div>
            <p style="color: #9ca3af; font-size: 14px;">This code expires in 5 minutes. Do not share it with anyone.</p>
          </div>
        `,
      });
    }
    else {
      // Development: log OTP to console (strip CR/LF to prevent log injection)
      const safeEmail = String(m.email).replace(/[\r\n]+/g, '');
      console.warn(`[OTP] Code for ${safeEmail}: ${code}`);
    }

    return NextResponse.json({ sent: true, maskedEmail: maskEmail(m.email) });
  }
  catch (error) {
    console.error('[member-portal/send-otp] Error:', error);
    // Still return the generic success shape so failures don't enumerate.
    return fakeSent();
  }
}

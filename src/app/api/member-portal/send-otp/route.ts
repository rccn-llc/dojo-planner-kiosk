import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database';
import { member } from '@/lib/memberSchema';
import { generateOTP, storeOTP } from '@/lib/otp';

export async function POST(request: Request) {
  try {
    const body = await request.json() as { memberId?: string };
    const memberId = body.memberId?.trim() ?? '';

    if (!memberId) {
      return NextResponse.json({ error: 'memberId is required' }, { status: 400 });
    }

    const db = getDatabase();

    // Fetch member email
    const members = await db
      .select({ email: member.email, firstName: member.firstName })
      .from(member)
      .where(eq(member.id, memberId))
      .limit(1);

    const m = members[0];
    if (!m || !m.email) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    // Generate and store OTP
    const code = generateOTP();
    const stored = await storeOTP(memberId, code);

    if (!stored) {
      return NextResponse.json({ error: 'Too many requests. Please wait a few minutes.' }, { status: 429 });
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
            <p style="color: #6b7280; margin-bottom: 24px;">Hi ${m.firstName}, use this code to sign in:</p>
            <div style="background: #f3f4f6; border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 24px;">
              <span style="font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #111827;">${code}</span>
            </div>
            <p style="color: #9ca3af; font-size: 14px;">This code expires in 5 minutes. Do not share it with anyone.</p>
          </div>
        `,
      });
    }
    else {
      // Development: log OTP to console
      console.warn(`[OTP] Code for ${m.email}: ${code}`);
    }

    // Mask email for response
    const [user, domain] = m.email.split('@');
    const maskedUser = user && user.length > 2
      ? `${user[0]}${'*'.repeat(user.length - 2)}${user[user.length - 1]}`
      : user;
    const maskedEmail = `${maskedUser}@${domain}`;

    return NextResponse.json({ sent: true, maskedEmail });
  }
  catch (error) {
    console.error('[member-portal/send-otp] Error:', error);
    return NextResponse.json({ error: 'Failed to send OTP' }, { status: 500 });
  }
}

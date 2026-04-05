import { NextResponse } from 'next/server';
import { validateDevice } from '@/lib/deviceAuth';
import { isStaffTOTPConfigured, verifyStaffTOTP } from '@/lib/totp';

export async function POST(request: Request) {
  try {
    const device = await validateDevice(request);
    const orgId = device?.orgId ?? process.env.ORGANIZATION_ID;

    if (!orgId) {
      return NextResponse.json({ error: 'Organization context not available' }, { status: 500 });
    }

    // Check if TOTP is configured for this org
    const configured = await isStaffTOTPConfigured(orgId);
    if (!configured) {
      return NextResponse.json(
        { verified: false, error: 'Staff TOTP not configured' },
        { status: 503 },
      );
    }

    const body = await request.json() as { code?: string };
    const code = body.code?.trim() ?? '';

    if (!code || code.length !== 6) {
      return NextResponse.json({ verified: false, error: 'Invalid code' });
    }

    const verified = await verifyStaffTOTP(code, orgId);
    return NextResponse.json({ verified });
  }
  catch (error) {
    console.error('[staff/verify-totp] Error:', error);
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 });
  }
}

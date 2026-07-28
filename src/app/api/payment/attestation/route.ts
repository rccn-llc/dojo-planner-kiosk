import { NextResponse } from 'next/server';
import { resolveOrgIdFromRequest } from '@/lib/clerk';
import { signAttestationToken } from '@/lib/kioskAttestation';
import { clientIp, rateLimit } from '@/lib/rateLimit';

/**
 * GET /api/payment/attestation?org=<slug>
 *
 * Mints a short-lived signed kiosk attestation token that the payment routes
 * require before charging. The kiosk checkout page fetches one when the payment
 * step loads and passes it back on the charge request. Rate-limited per IP so
 * it can't be used as an unbounded token oracle.
 */
export async function GET(request: Request) {
  const orgId = await resolveOrgIdFromRequest(request);
  if (!orgId) {
    return NextResponse.json(
      { error: 'Organization not found. Pass ?org=<slug>.' },
      { status: 400 },
    );
  }

  const allowed = await rateLimit(`attestation:${clientIp(request)}`, 60, 60 * 1000);
  if (!allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  return NextResponse.json({ token: signAttestationToken(orgId) });
}

import { and, eq, or } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { resolveOrgBySlug, resolveOrgIdFromRequest } from '@/lib/clerk';
import { getDatabase } from '@/lib/database';
import { member } from '@/lib/memberSchema';
import { clientIp, rateLimit } from '@/lib/rateLimit';

// Unauthenticated public route — throttle by IP to blunt phone-number
// enumeration (30 lookups / 10 min per IP).
const LOOKUP_LIMIT = 30;
const LOOKUP_WINDOW_MS = 10 * 60 * 1000;

export async function POST(request: Request) {
  try {
    const allowed = await rateLimit(`mp-lookup:${clientIp(request)}`, LOOKUP_LIMIT, LOOKUP_WINDOW_MS);
    if (!allowed) {
      return NextResponse.json({ found: false, error: 'Too many attempts. Please wait a few minutes.' }, { status: 429 });
    }

    const body = await request.json() as { phone?: string; orgSlug?: string };
    const rawPhone = body.phone?.replace(/\D/g, '') ?? '';
    const orgSlug = body.orgSlug?.trim() ?? '';

    if (!rawPhone || rawPhone.length !== 10) {
      return NextResponse.json({ found: false, error: 'Valid 10-digit phone number is required' });
    }

    // Resolve org: URL ?org=<slug-or-id> takes precedence; then body.orgSlug
    // (including the legacy "_kiosk" sentinel → env); else error.
    let orgId: string | null = await resolveOrgIdFromRequest(request);
    if (!orgId) {
      if (orgSlug === '_kiosk') {
        orgId = process.env.ORGANIZATION_ID ?? null;
      }
      else if (orgSlug) {
        const org = await resolveOrgBySlug(orgSlug);
        orgId = org?.orgId ?? null;
      }
    }
    if (!orgId) {
      return NextResponse.json({ found: false, error: 'Organization not found' });
    }

    const db = getDatabase();
    const phoneWithCountry = `+1${rawPhone}`;
    const phoneFormatted = rawPhone.length === 10
      ? `(${rawPhone.slice(0, 3)}) ${rawPhone.slice(3, 6)}-${rawPhone.slice(6)}`
      : rawPhone;

    // This route is UNAUTHENTICATED (it precedes OTP verification), so it must
    // not return PII. It returns only opaque member ids — enough to drive the
    // send-OTP step, which masks the destination email itself. The caller must
    // never receive names/emails/status before proving control of the phone.
    const members = await db
      .select({ id: member.id })
      .from(member)
      .where(
        and(
          eq(member.organizationId, orgId),
          or(
            eq(member.phone, rawPhone),
            eq(member.phone, phoneWithCountry),
            eq(member.phone, phoneFormatted),
          ),
        ),
      )
      .limit(5);

    if (members.length === 0) {
      return NextResponse.json({ found: false, error: 'No member found with this phone number' });
    }

    return NextResponse.json({
      found: true,
      members: members.map(m => ({ id: m.id })),
      orgId,
    });
  }
  catch (error) {
    console.error('[member-portal/lookup] Error:', error);
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }
}

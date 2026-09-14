import { createClerkClient } from '@clerk/backend';
import { NextResponse } from 'next/server';
import { resolveOrgBySlug, resolveOrgIdFromRequest } from '@/lib/clerk';
import { verifyAttestationToken } from '@/lib/kioskAttestation';
import { clientIp, rateLimit } from '@/lib/rateLimit';
import { maskEmail } from '@/lib/utils';

// Org roles whose holders may unlock a member's portal via the admin override.
const ELIGIBLE_ROLES = new Set(['org:admin', 'org:academy_owner', 'org:front_desk']);

// Sized for a whole dojo sharing one terminal, not for one person. The list is
// masked names + Clerk user ids and is only reachable with a valid kiosk
// attestation token, so this is an anti-scraping ceiling rather than a quota.
const STAFF_LIST_LIMIT = 300;
const STAFF_LIST_WINDOW_MS = 10 * 60 * 1000;

export async function POST(request: Request) {
  try {
    const body = await request.json() as { orgSlug?: string; kioskAttestationToken?: string };
    const orgSlug = body.orgSlug?.trim() ?? '';

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
      return NextResponse.json({ staff: [], error: 'Organization not found.' }, { status: 400 });
    }

    // The staff roster (names + Clerk user ids) enables the staff-override OTP
    // path, so don't hand it out to any anonymous caller. Require a valid kiosk
    // attestation token bound to this org, and rate-limit per IP.
    if (!verifyAttestationToken(body.kioskAttestationToken, orgId)) {
      return NextResponse.json({ staff: [], error: 'This kiosk is not authorized to load the staff list.' }, { status: 403 });
    }

    // ⚠️ EVERY person at a dojo shares one kiosk, and therefore one client IP.
    // The old 30-per-10-minutes budget was a per-person figure applied to a
    // per-terminal bucket, so a front-desk shift that used Staff Override a
    // handful of times drained it and the roster silently vanished for the rest
    // of the window — the reported "staff disappear, then come back five
    // minutes later". The roster is the same non-secret list of names on every
    // call, so the limit only needs to blunt scraping, not ration normal use.
    const allowed = await rateLimit(`staff-list:${orgId}:${clientIp(request)}`, STAFF_LIST_LIMIT, STAFF_LIST_WINDOW_MS);
    if (!allowed) {
      // Must NOT be an empty list: `{ staff: [] }` is indistinguishable from
      // "this dojo has no eligible staff", which is what made the failure look
      // like data loss instead of throttling.
      return NextResponse.json(
        { staff: [], error: 'Too many staff lookups from this kiosk. Please wait a moment and try again.' },
        { status: 429 },
      );
    }

    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) {
      return NextResponse.json({ staff: [], error: 'Staff directory is not configured.' }, { status: 503 });
    }

    const clerk = createClerkClient({ secretKey });
    const memberships = await clerk.organizations.getOrganizationMembershipList({
      organizationId: orgId,
      limit: 100,
    });

    const staff = memberships.data
      .filter(m => ELIGIBLE_ROLES.has(m.role) && m.publicUserData)
      .map((m) => {
        const data = m.publicUserData!;
        const fullName = [data.firstName, data.lastName].filter(Boolean).join(' ').trim()
          || data.identifier
          || 'Staff';
        return {
          id: data.userId,
          fullName,
          maskedEmail: maskEmail(data.identifier),
        };
      })
      .sort((a, b) => a.fullName.localeCompare(b.fullName));

    return NextResponse.json({ staff });
  }
  catch (error) {
    console.error('[member-portal/staff-list] Error:', error);
    // Same reasoning as the 429 above: report the failure rather than passing
    // an empty roster off as the truth.
    return NextResponse.json(
      { staff: [], error: 'Could not load the staff list. Please try again.' },
      { status: 502 },
    );
  }
}

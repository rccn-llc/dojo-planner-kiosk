import { createClerkClient } from '@clerk/backend';
import { NextResponse } from 'next/server';
import { resolveOrgBySlug, resolveOrgIdFromRequest } from '@/lib/clerk';
import { verifyAttestationToken } from '@/lib/kioskAttestation';
import { clientIp, rateLimit } from '@/lib/rateLimit';
import { maskEmail } from '@/lib/utils';

// Org roles whose holders may unlock a member's portal via the admin override.
const ELIGIBLE_ROLES = new Set(['org:admin', 'org:academy_owner', 'org:front_desk']);

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
      return NextResponse.json({ staff: [] });
    }

    // The staff roster (names + Clerk user ids) enables the staff-override OTP
    // path, so don't hand it out to any anonymous caller. Require a valid kiosk
    // attestation token bound to this org, and rate-limit per IP.
    if (!verifyAttestationToken(body.kioskAttestationToken, orgId)) {
      return NextResponse.json({ staff: [] }, { status: 403 });
    }
    const allowed = await rateLimit(`staff-list:${clientIp(request)}`, 30, 10 * 60 * 1000);
    if (!allowed) {
      return NextResponse.json({ staff: [] }, { status: 429 });
    }

    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) {
      return NextResponse.json({ staff: [] });
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
    return NextResponse.json({ staff: [] });
  }
}

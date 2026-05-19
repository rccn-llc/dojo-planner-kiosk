import { createClerkClient } from '@clerk/backend';
import { NextResponse } from 'next/server';
import { resolveOrgBySlug } from '@/lib/clerk';

// Org roles whose holders may unlock a member's portal via the admin override.
const ELIGIBLE_ROLES = new Set(['org:admin', 'org:academy_owner', 'org:front_desk']);

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

export async function POST(request: Request) {
  try {
    const body = await request.json() as { orgSlug?: string };
    const orgSlug = body.orgSlug?.trim() ?? '';

    if (!orgSlug) {
      return NextResponse.json({ staff: [] });
    }

    let orgId: string;
    if (orgSlug === '_kiosk') {
      const envOrgId = process.env.ORGANIZATION_ID;
      if (!envOrgId) {
        return NextResponse.json({ staff: [] });
      }
      orgId = envOrgId;
    }
    else {
      const org = await resolveOrgBySlug(orgSlug);
      if (!org) {
        return NextResponse.json({ staff: [] });
      }
      orgId = org.orgId;
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

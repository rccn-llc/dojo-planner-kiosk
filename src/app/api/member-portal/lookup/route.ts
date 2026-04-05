import { and, eq, or } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { resolveOrgBySlug } from '@/lib/clerk';
import { getDatabase } from '@/lib/database';
import { member } from '@/lib/memberSchema';

export async function POST(request: Request) {
  try {
    const body = await request.json() as { phone?: string; orgSlug?: string };
    const rawPhone = body.phone?.replace(/\D/g, '') ?? '';
    const orgSlug = body.orgSlug?.trim() ?? '';

    if (!rawPhone || rawPhone.length !== 10) {
      return NextResponse.json({ found: false, error: 'Valid 10-digit phone number is required' });
    }

    if (!orgSlug) {
      return NextResponse.json({ found: false, error: 'Organization slug is required' });
    }

    // Resolve org by slug
    const org = await resolveOrgBySlug(orgSlug);
    if (!org) {
      return NextResponse.json({ found: false, error: 'Organization not found' });
    }

    const db = getDatabase();
    const phoneWithCountry = `+1${rawPhone}`;

    const members = await db
      .select({
        id: member.id,
        firstName: member.firstName,
        lastName: member.lastName,
        email: member.email,
        status: member.status,
      })
      .from(member)
      .where(
        and(
          eq(member.organizationId, org.orgId),
          or(
            eq(member.phone, rawPhone),
            eq(member.phone, phoneWithCountry),
          ),
        ),
      )
      .limit(5);

    if (members.length === 0) {
      return NextResponse.json({ found: false, error: 'No member found with this phone number' });
    }

    return NextResponse.json({
      found: true,
      members: members.map(m => ({
        id: m.id,
        firstName: m.firstName,
        lastName: m.lastName,
        email: m.email,
        status: m.status,
      })),
      orgId: org.orgId,
      orgName: org.orgName,
    });
  }
  catch (error) {
    console.error('[member-portal/lookup] Error:', error);
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }
}

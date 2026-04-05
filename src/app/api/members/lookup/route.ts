import { and, eq, or } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database';
import { validateDevice } from '@/lib/deviceAuth';
import { member } from '@/lib/memberSchema';

export async function POST(request: Request) {
  try {
    const device = await validateDevice(request);
    const orgId = device?.orgId ?? process.env.ORGANIZATION_ID;

    if (!orgId) {
      return NextResponse.json({ error: 'Organization context not available' }, { status: 500 });
    }

    const body = await request.json() as { phone?: string };
    const rawPhone = body.phone?.replace(/\D/g, '') ?? '';

    if (!rawPhone || rawPhone.length !== 10) {
      return NextResponse.json({ found: false, members: [] });
    }

    const db = getDatabase();

    // Search both bare digits and +1 prefixed formats
    const phoneWithCountry = `+1${rawPhone}`;

    const members = await db
      .select({
        memberId: member.id,
        firstName: member.firstName,
        lastName: member.lastName,
        status: member.status,
        memberType: member.memberType,
      })
      .from(member)
      .where(
        and(
          eq(member.organizationId, orgId),
          or(
            eq(member.phone, rawPhone),
            eq(member.phone, phoneWithCountry),
          ),
        ),
      );

    return NextResponse.json({
      found: members.length > 0,
      members: members.map(m => ({
        memberId: m.memberId,
        firstName: m.firstName,
        lastName: m.lastName,
        status: m.status,
        memberType: m.memberType ?? 'individual',
      })),
    });
  }
  catch (error) {
    console.error('[members/lookup] Error:', error);
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }
}

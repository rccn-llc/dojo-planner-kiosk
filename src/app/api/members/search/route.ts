import { and, eq, ilike, inArray, or } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database';
import { validateDevice } from '@/lib/deviceAuth';
import { member, memberMembership } from '@/lib/memberSchema';

export async function POST(request: Request) {
  try {
    const device = await validateDevice(request);
    const orgId = device?.orgId ?? process.env.ORGANIZATION_ID;

    if (!orgId) {
      return NextResponse.json({ error: 'Organization context not available' }, { status: 500 });
    }

    const body = await request.json() as { name?: string };
    const name = body.name?.trim() ?? '';

    if (name.length < 2) {
      return NextResponse.json({ found: false, members: [] });
    }

    const db = getDatabase();
    const pattern = `%${name}%`;

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
            ilike(member.firstName, pattern),
            ilike(member.lastName, pattern),
            ilike(member.email, pattern),
          ),
        ),
      )
      .limit(50);

    const memberIds = members.map(m => m.memberId);
    const withDirectMembership = new Set<string>();
    if (memberIds.length > 0) {
      const directMemberships = await db
        .select({ memberId: memberMembership.memberId })
        .from(memberMembership)
        .where(inArray(memberMembership.memberId, memberIds));
      for (const row of directMemberships) {
        withDirectMembership.add(row.memberId);
      }
    }

    return NextResponse.json({
      found: members.length > 0,
      members: members.map(m => ({
        memberId: m.memberId,
        firstName: m.firstName,
        lastName: m.lastName,
        status: m.status,
        memberType: m.memberType ?? 'individual',
        hasDirectMembership: withDirectMembership.has(m.memberId),
      })),
    });
  }
  catch (error) {
    console.error('[members/search] Error:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}

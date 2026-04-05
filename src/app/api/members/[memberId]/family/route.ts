import { eq, or } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database';
import { validateDevice } from '@/lib/deviceAuth';
import { familyMember, member } from '@/lib/memberSchema';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ memberId: string }> },
) {
  try {
    const device = await validateDevice(request);
    const orgId = device?.orgId ?? process.env.ORGANIZATION_ID;
    if (!orgId) {
      return NextResponse.json({ error: 'Organization context not available' }, { status: 500 });
    }

    const { memberId } = await params;
    const db = getDatabase();

    // Find all family links where this member is on either side
    const familyLinks = await db
      .select()
      .from(familyMember)
      .where(
        or(
          eq(familyMember.memberId, memberId),
          eq(familyMember.relatedMemberId, memberId),
        ),
      );

    // Gather all related member IDs
    const relatedIds = new Set<string>();
    for (const link of familyLinks) {
      if (link.memberId !== memberId) {
        relatedIds.add(link.memberId);
      }
      if (link.relatedMemberId !== memberId) {
        relatedIds.add(link.relatedMemberId);
      }
    }

    if (relatedIds.size === 0) {
      return NextResponse.json({ familyMembers: [] });
    }

    // Fetch member details for all related members
    const familyMembers = [];
    for (const relId of relatedIds) {
      const rows = await db
        .select({
          id: member.id,
          firstName: member.firstName,
          lastName: member.lastName,
          status: member.status,
          memberType: member.memberType,
        })
        .from(member)
        .where(eq(member.id, relId))
        .limit(1);

      const m = rows[0];
      if (!m) {
        continue;
      }

      // Find the relationship from the link
      const link = familyLinks.find(
        l => (l.memberId === memberId && l.relatedMemberId === relId)
          || (l.relatedMemberId === memberId && l.memberId === relId),
      );

      familyMembers.push({
        id: m.id,
        firstName: m.firstName,
        lastName: m.lastName,
        status: m.status,
        memberType: m.memberType ?? 'individual',
        relationship: link?.relationship ?? 'related',
        isHOH: m.memberType === 'head-of-household',
      });
    }

    return NextResponse.json({ familyMembers });
  }
  catch (error) {
    console.error('[members/[memberId]/family] Error:', error);
    return NextResponse.json({ error: 'Failed to load family members' }, { status: 500 });
  }
}

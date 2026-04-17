import { eq, inArray, or } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database';
import { validateDevice } from '@/lib/deviceAuth';
import { familyMember, member, memberMembership } from '@/lib/memberSchema';

// Maps a relationship to its inverse.
// The link stores: relatedMemberId is <relationship> of memberId.
// e.g. (parent, child, 'child') → the child is a "child" of the parent.
// When viewing from the child's profile, we invert to show "parent".
const RELATIONSHIP_INVERSES: Record<string, string> = {
  parent: 'child',
  child: 'parent',
  guardian: 'ward',
  ward: 'guardian',
  legal_guardian: 'ward',
  spouse: 'spouse',
  sibling: 'sibling',
};

function invertRelationship(relationship: string): string {
  return RELATIONSHIP_INVERSES[relationship] ?? relationship;
}

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

    // Look up which related members hold any membership of their own
    const relatedIdArr = [...relatedIds];
    const directMemberships = await db
      .select({ memberId: memberMembership.memberId })
      .from(memberMembership)
      .where(inArray(memberMembership.memberId, relatedIdArr));
    const withDirectMembership = new Set(directMemberships.map(r => r.memberId));

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

      // Find the relationship from the link.
      // The link stores: memberId is <relationship> of relatedMemberId.
      // e.g. (parent, child, 'parent') → parent is a "parent" of child.
      //
      // When we view from the parent's profile and list the child,
      // we need to invert: the child is "child" of the parent.
      // When we view from the child's profile and list the parent,
      // the relationship 'parent' is already correct.
      const link = familyLinks.find(
        l => (l.memberId === memberId && l.relatedMemberId === relId)
          || (l.relatedMemberId === memberId && l.memberId === relId),
      );

      let relationship = link?.relationship ?? 'related';
      // The link stores: memberId selected <relationship> when adding relatedMemberId.
      // e.g. user viewing their profile picks "Child" to add a child →
      // stored as (currentUser, child, 'child').
      // From currentUser's perspective, the relationship is already correct:
      // the listed person IS their child.
      // From the child's perspective, we need to invert: the listed person
      // (the parent) is their "parent", not their "child".
      if (link && link.relatedMemberId === memberId) {
        relationship = invertRelationship(relationship);
      }

      familyMembers.push({
        id: m.id,
        firstName: m.firstName,
        lastName: m.lastName,
        status: m.status,
        memberType: m.memberType ?? 'individual',
        hasDirectMembership: withDirectMembership.has(m.id),
        relationship,
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

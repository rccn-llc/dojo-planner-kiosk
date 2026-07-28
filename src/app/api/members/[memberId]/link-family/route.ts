import { and, eq, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database';
import { familyMember, member } from '@/lib/memberSchema';
import { requireMemberAuth } from '@/lib/requireMemberAuth';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ memberId: string }> },
) {
  try {
    const { memberId } = await params;
    const auth = await requireMemberAuth(request, memberId);
    if (!auth.ok) {
      return auth.response;
    }
    const { orgId } = auth;

    const body = await request.json() as { relatedMemberId: string; relationship: string };

    if (!body.relatedMemberId || !body.relationship) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (body.relatedMemberId === memberId) {
      return NextResponse.json({ error: 'Cannot link a member to themselves' }, { status: 400 });
    }

    const db = getDatabase();

    // Both members must exist and belong to the resolved org before we link
    // them — otherwise any caller who knows two member ids could create
    // cross-org family links.
    const found = await db
      .select({ id: member.id })
      .from(member)
      .where(and(
        inArray(member.id, [memberId, body.relatedMemberId]),
        eq(member.organizationId, orgId),
      ));
    if (found.length !== 2) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    // Idempotent: the (member_id, related_member_id) composite PK makes a repeat
    // link a no-op rather than a 500.
    await db.insert(familyMember)
      .values({
        memberId,
        relatedMemberId: body.relatedMemberId,
        relationship: body.relationship,
      })
      .onConflictDoNothing();

    return NextResponse.json({ success: true });
  }
  catch (error) {
    console.error('[members/[memberId]/link-family] Error:', error);
    return NextResponse.json({ error: 'Failed to link family member' }, { status: 500 });
  }
}

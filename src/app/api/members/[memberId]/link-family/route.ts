import { NextResponse } from 'next/server';
import { resolveOrgIdFromRequest } from '@/lib/clerk';
import { getDatabase } from '@/lib/database';
import { validateDevice } from '@/lib/deviceAuth';
import { familyMember } from '@/lib/memberSchema';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ memberId: string }> },
) {
  try {
    let orgId = await resolveOrgIdFromRequest(request);
    if (!orgId) {
      const device = await validateDevice(request);
      orgId = device?.orgId ?? process.env.ORGANIZATION_ID ?? null;
    }
    if (!orgId) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 400 });
    }

    const { memberId } = await params;
    const body = await request.json() as { relatedMemberId: string; relationship: string };

    if (!body.relatedMemberId || !body.relationship) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (body.relatedMemberId === memberId) {
      return NextResponse.json({ error: 'Cannot link a member to themselves' }, { status: 400 });
    }

    const db = getDatabase();

    await db.insert(familyMember).values({
      memberId,
      relatedMemberId: body.relatedMemberId,
      relationship: body.relationship,
    });

    return NextResponse.json({ success: true });
  }
  catch (error) {
    console.error('[members/[memberId]/link-family] Error:', error);
    return NextResponse.json({ error: 'Failed to link family member' }, { status: 500 });
  }
}

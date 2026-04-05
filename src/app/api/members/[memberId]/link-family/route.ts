import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database';
import { validateDevice } from '@/lib/deviceAuth';
import { familyMember } from '@/lib/memberSchema';

export async function POST(
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

import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database';
import { validateDevice } from '@/lib/deviceAuth';
import { familyMember, member } from '@/lib/memberSchema';

interface CreateFamilyBody {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  dateOfBirth?: string;
  relationship: string;
  setCurrentAsHOH?: boolean;
}

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
    const body = await request.json() as CreateFamilyBody;

    if (!body.firstName?.trim() || !body.lastName?.trim() || !body.email?.trim() || !body.relationship?.trim()) {
      return NextResponse.json({ error: 'First name, last name, email, and relationship are required' }, { status: 400 });
    }

    const db = getDatabase();
    const now = new Date();

    // Verify the current member exists
    const currentMembers = await db
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.id, memberId), eq(member.organizationId, orgId)))
      .limit(1);

    if (!currentMembers[0]) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    const newMemberId = randomUUID();
    const phone = body.phone?.replace(/\D/g, '') || null;

    // Create the new family member
    await db.insert(member).values({
      id: newMemberId,
      organizationId: orgId,
      firstName: body.firstName.trim(),
      lastName: body.lastName.trim(),
      email: body.email.trim(),
      phone,
      memberType: 'family-member',
      dateOfBirth: body.dateOfBirth ? new Date(`${body.dateOfBirth}T12:00:00`) : undefined,
      status: 'active',
      statusChangedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    // Link them as family.
    // The relationship describes what the NEW member is to the CURRENT member.
    // e.g. if relationship is 'child', the new member is a child of the current member.
    await db.insert(familyMember).values({
      memberId,
      relatedMemberId: newMemberId,
      relationship: body.relationship,
    });

    // Optionally set the current member as head of household
    if (body.setCurrentAsHOH) {
      await db.update(member)
        .set({ memberType: 'head-of-household', updatedAt: now })
        .where(eq(member.id, memberId));
    }

    return NextResponse.json({
      success: true,
      newMemberId,
    });
  }
  catch (error) {
    console.error('[members/[memberId]/create-family] Error:', error);
    return NextResponse.json({ error: 'Failed to create family member' }, { status: 500 });
  }
}

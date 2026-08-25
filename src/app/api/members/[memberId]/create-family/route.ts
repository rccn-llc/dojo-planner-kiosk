import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { familyMember, member } from '@/lib/memberSchema';
import { requireMemberAuth } from '@/lib/requireMemberAuth';
import { getDatabaseForOrg } from '@/lib/tenantDirectory';
import { isValidEmail } from '@/lib/utils';

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
    const { memberId } = await params;
    const auth = await requireMemberAuth(request, memberId);
    if (!auth.ok) {
      return auth.response;
    }
    const { orgId } = auth;

    const body = await request.json() as CreateFamilyBody;

    if (!body.firstName?.trim() || !body.lastName?.trim() || !body.email?.trim() || !body.relationship?.trim()) {
      return NextResponse.json({ error: 'First name, last name, email, and relationship are required' }, { status: 400 });
    }
    if (!isValidEmail(body.email)) {
      return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
    }
    if (body.phone) {
      const digits = body.phone.replace(/\D/g, '');
      if (digits.length > 0 && digits.length !== 10) {
        return NextResponse.json({ error: 'A valid 10-digit phone number is required' }, { status: 400 });
      }
    }
    if (body.dateOfBirth) {
      const dob = new Date(`${body.dateOfBirth}T12:00:00`);
      if (Number.isNaN(dob.getTime()) || dob > new Date()) {
        return NextResponse.json({ error: 'A valid date of birth is required' }, { status: 400 });
      }
    }

    const db = await getDatabaseForOrg(auth.orgId);
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
        .where(and(eq(member.id, memberId), eq(member.organizationId, orgId)));
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

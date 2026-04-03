import type { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database';
import {
  addressTrialSchema,
  familyMemberTrialSchema,
  memberMembershipTrialSchema,
  membershipPlanTrialSchema,
  memberTrialSchema,
  signedWaiverTrialSchema,
} from '@/lib/trialSchema';

interface MemberInfo {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  addressLine2?: string;
  city: string;
  state: string;
  zip: string;
}

interface ChildInfo {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
}

interface WaiverInfo {
  templateId: string;
  templateVersion: number;
  renderedContent: string;
  signature: string;
}

interface SubmitTrialRequest {
  ageGroup: 'adult' | 'youth';
  member: MemberInfo;
  children?: ChildInfo[];
  waiver: WaiverInfo;
  membershipPlanId: string;
}

function calcAge(dob: Date, now: Date): number {
  return Math.floor((now.getTime() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as SubmitTrialRequest;
    const orgId = process.env.ORGANIZATION_ID;

    if (!orgId) {
      return NextResponse.json({ error: 'ORGANIZATION_ID is not configured' }, { status: 500 });
    }

    const { ageGroup, member, children, waiver, membershipPlanId } = body;

    if (!ageGroup || !member || !waiver || !membershipPlanId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const db = getDatabase();

    // Fetch membership plan for snapshot data
    const plans = await db
      .select()
      .from(membershipPlanTrialSchema)
      .where(eq(membershipPlanTrialSchema.id, membershipPlanId))
      .limit(1);

    const plan = plans[0];
    if (!plan) {
      return NextResponse.json({ error: 'Membership plan not found' }, { status: 404 });
    }

    const now = new Date();
    const ipAddress = request.headers.get('x-forwarded-for')
      ?? request.headers.get('x-real-ip')
      ?? undefined;
    const userAgent = request.headers.get('user-agent') ?? undefined;

    const street = [member.address, member.addressLine2].filter(Boolean).join(' ');

    if (ageGroup === 'adult') {
      // ── Adult flow: 1 member, 1 address, 1 membership, 1 signed waiver ──
      const memberId = randomUUID();
      const memberMembershipId = randomUUID();

      await db.transaction(async (tx) => {
        await tx.insert(memberTrialSchema).values({
          id: memberId,
          organizationId: orgId,
          firstName: member.firstName,
          lastName: member.lastName,
          email: member.email,
          memberType: 'individual',
          phone: member.phone,
          status: 'trial',
          statusChangedAt: now,
          createdAt: now,
          updatedAt: now,
        });

        await tx.insert(addressTrialSchema).values({
          id: randomUUID(),
          memberId,
          type: 'home',
          street,
          city: member.city,
          state: member.state,
          zipCode: member.zip,
          country: 'US',
          isDefault: true,
        });

        await tx.insert(memberMembershipTrialSchema).values({
          id: memberMembershipId,
          memberId,
          membershipPlanId,
          status: 'active',
          billingType: 'one-time',
          startDate: now,
          createdAt: now,
          updatedAt: now,
        });

        await tx.insert(signedWaiverTrialSchema).values({
          id: randomUUID(),
          organizationId: orgId,
          waiverTemplateId: waiver.templateId,
          waiverTemplateVersion: waiver.templateVersion,
          memberId,
          memberMembershipId,
          membershipPlanName: plan.name,
          membershipPlanPrice: plan.price,
          membershipPlanFrequency: plan.frequency,
          membershipPlanContractLength: plan.contractLength,
          membershipPlanIsTrial: plan.isTrial ?? true,
          signatureDataUrl: waiver.signature,
          signedByName: `${member.firstName} ${member.lastName}`,
          signedByEmail: member.email,
          signedByRelationship: null,
          memberFirstName: member.firstName,
          memberLastName: member.lastName,
          memberEmail: member.email,
          renderedContent: waiver.renderedContent,
          ipAddress: ipAddress ?? null,
          userAgent: userAgent ?? null,
          signedAt: now,
          createdAt: now,
        });
      });

      return NextResponse.json({ memberId });
    }
    else {
      // ── Youth flow: parent (head-of-household) + one member_membership per child ──
      if (!children || children.length === 0) {
        return NextResponse.json(
          { error: 'Youth trial requires at least one child' },
          { status: 400 },
        );
      }

      const parentMemberId = randomUUID();
      const childResults: Array<{ memberId: string; memberMembershipId: string }> = [];

      await db.transaction(async (tx) => {
        // 1. Parent member (head-of-household, no membership)
        await tx.insert(memberTrialSchema).values({
          id: parentMemberId,
          organizationId: orgId,
          firstName: member.firstName,
          lastName: member.lastName,
          email: member.email,
          memberType: 'head-of-household',
          phone: member.phone,
          status: 'trial',
          statusChangedAt: now,
          createdAt: now,
          updatedAt: now,
        });

        await tx.insert(addressTrialSchema).values({
          id: randomUUID(),
          memberId: parentMemberId,
          type: 'home',
          street,
          city: member.city,
          state: member.state,
          zipCode: member.zip,
          country: 'US',
          isDefault: true,
        });

        // 2. One child member + membership + family link + signed waiver per child
        for (const child of children) {
          const childMemberId = randomUUID();
          const childMembershipId = randomUUID();
          const dob = child.dateOfBirth ? new Date(child.dateOfBirth) : null;
          const ageAtSigning = dob ? calcAge(dob, now) : null;

          await tx.insert(memberTrialSchema).values({
            id: childMemberId,
            organizationId: orgId,
            firstName: child.firstName,
            lastName: child.lastName,
            email: member.email, // use parent email for child records
            memberType: 'family-member',
            dateOfBirth: dob ?? undefined,
            status: 'trial',
            statusChangedAt: now,
            createdAt: now,
            updatedAt: now,
          });

          await tx.insert(memberMembershipTrialSchema).values({
            id: childMembershipId,
            memberId: childMemberId,
            membershipPlanId,
            status: 'active',
            billingType: 'one-time',
            startDate: now,
            createdAt: now,
            updatedAt: now,
          });

          await tx.insert(familyMemberTrialSchema).values({
            memberId: parentMemberId,
            relatedMemberId: childMemberId,
            relationship: 'parent',
          });

          await tx.insert(signedWaiverTrialSchema).values({
            id: randomUUID(),
            organizationId: orgId,
            waiverTemplateId: waiver.templateId,
            waiverTemplateVersion: waiver.templateVersion,
            memberId: childMemberId,
            memberMembershipId: childMembershipId,
            membershipPlanName: plan.name,
            membershipPlanPrice: plan.price,
            membershipPlanFrequency: plan.frequency,
            membershipPlanContractLength: plan.contractLength,
            membershipPlanIsTrial: plan.isTrial ?? true,
            signatureDataUrl: waiver.signature,
            signedByName: `${member.firstName} ${member.lastName}`,
            signedByEmail: member.email,
            signedByRelationship: 'parent',
            memberFirstName: child.firstName,
            memberLastName: child.lastName,
            memberEmail: member.email,
            memberDateOfBirth: dob ?? undefined,
            memberAgeAtSigning: ageAtSigning ?? undefined,
            renderedContent: waiver.renderedContent,
            ipAddress: ipAddress ?? null,
            userAgent: userAgent ?? null,
            signedAt: now,
            createdAt: now,
          });

          childResults.push({ memberId: childMemberId, memberMembershipId: childMembershipId });
        }
      });

      return NextResponse.json({ memberId: parentMemberId, children: childResults });
    }
  }
  catch (error) {
    console.error('POST /api/trial/submit error:', error);
    return NextResponse.json({ error: 'Failed to create trial' }, { status: 500 });
  }
}

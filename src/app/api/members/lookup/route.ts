import { and, desc, eq, inArray, or } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database';
import { validateDevice } from '@/lib/deviceAuth';
import { address, member, memberMembership, membershipPlan, signedWaiver } from '@/lib/memberSchema';

export async function POST(request: Request) {
  try {
    const device = await validateDevice(request);
    const orgId = device?.orgId ?? process.env.ORGANIZATION_ID;

    if (!orgId) {
      return NextResponse.json({ error: 'Organization context not available' }, { status: 500 });
    }

    const body = await request.json() as {
      phone?: string;
      selectedPlanId?: string;
      convertOnly?: boolean;
    };
    const rawPhone = body.phone?.replace(/\D/g, '') ?? '';
    const selectedPlanId = body.selectedPlanId;
    const convertOnly = !!body.convertOnly;

    if (!rawPhone || rawPhone.length !== 10) {
      return NextResponse.json({ found: false, members: [] });
    }

    const db = getDatabase();

    // Search all common phone storage formats
    const phoneWithCountry = `+1${rawPhone}`;
    const phoneFormatted = rawPhone.length === 10
      ? `(${rawPhone.slice(0, 3)}) ${rawPhone.slice(3, 6)}-${rawPhone.slice(6)}`
      : rawPhone;

    const members = await db
      .select({
        memberId: member.id,
        firstName: member.firstName,
        lastName: member.lastName,
        email: member.email,
        phone: member.phone,
        dateOfBirth: member.dateOfBirth,
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
            eq(member.phone, phoneFormatted),
          ),
        ),
      );

    const memberIds = members.map(m => m.memberId);

    // Fetch active memberships joined with plan info for all members
    interface MemberMembershipInfo {
      memberMembershipId: string;
      memberId: string;
      planId: string;
      membershipStatus: string;
      isTrial: boolean | null;
    }
    const membershipsByMember = new Map<string, MemberMembershipInfo[]>();

    if (memberIds.length > 0) {
      const memberships = await db
        .select({
          memberMembershipId: memberMembership.id,
          memberId: memberMembership.memberId,
          planId: memberMembership.membershipPlanId,
          membershipStatus: memberMembership.status,
          isTrial: membershipPlan.isTrial,
        })
        .from(memberMembership)
        .innerJoin(membershipPlan, eq(memberMembership.membershipPlanId, membershipPlan.id))
        .where(
          and(
            inArray(memberMembership.memberId, memberIds),
            inArray(memberMembership.status, ['active', 'on_hold', 'canceled']),
          ),
        );

      for (const m of memberships) {
        const arr = membershipsByMember.get(m.memberId) ?? [];
        arr.push(m);
        membershipsByMember.set(m.memberId, arr);
      }
    }

    // Fetch default addresses for these members
    const addressMap = new Map<string, typeof address.$inferSelect>();

    if (memberIds.length > 0) {
      const addrs = await db
        .select()
        .from(address)
        .where(
          and(
            inArray(address.memberId, memberIds),
            eq(address.isDefault, true),
          ),
        );

      for (const a of addrs) {
        addressMap.set(a.memberId, a);
      }
    }

    // Fetch the most recent signed waiver signature for each member
    const signatureMap = new Map<string, string>();

    if (memberIds.length > 0) {
      for (const mId of memberIds) {
        const waivers = await db
          .select({ signatureDataUrl: signedWaiver.signatureDataUrl })
          .from(signedWaiver)
          .where(eq(signedWaiver.memberId, mId))
          .orderBy(desc(signedWaiver.signedAt))
          .limit(1);

        const w = waivers[0];
        if (w?.signatureDataUrl) {
          signatureMap.set(mId, w.signatureDataUrl);
        }
      }
    }

    // Filter members based on plan matching and trial rules
    const filteredMembers = members.filter((m) => {
      const memberships = membershipsByMember.get(m.memberId) ?? [];

      // If they already have an active non-trial membership for the selected plan, exclude
      if (selectedPlanId) {
        const hasActiveNonTrial = memberships.some(
          ms => ms.planId === selectedPlanId && !ms.isTrial && ms.membershipStatus === 'active',
        );
        if (hasActiveNonTrial) {
          return false;
        }
      }

      // If convertOnly, only include members who have an active trial
      if (convertOnly) {
        const hasTrial = memberships.some(ms => ms.isTrial && ms.membershipStatus === 'active');
        if (!hasTrial) {
          return false;
        }
      }

      return true;
    });

    return NextResponse.json({
      found: filteredMembers.length > 0,
      members: filteredMembers.map((m) => {
        const addr = addressMap.get(m.memberId);
        const memberships = membershipsByMember.get(m.memberId) ?? [];
        const trialMembership = memberships.find(ms => ms.isTrial && ms.membershipStatus === 'active');

        return {
          memberId: m.memberId,
          firstName: m.firstName,
          lastName: m.lastName,
          email: m.email,
          phone: m.phone,
          dateOfBirth: m.dateOfBirth ? m.dateOfBirth.toISOString().split('T')[0] : null,
          status: m.status,
          memberType: m.memberType ?? 'individual',
          address: addr?.street ?? null,
          addressLine2: null,
          city: addr?.city ?? null,
          state: addr?.state ?? null,
          zip: addr?.zipCode ?? null,
          trialMembershipId: trialMembership?.memberMembershipId ?? null,
          existingSignature: signatureMap.get(m.memberId) ?? null,
        };
      }),
    });
  }
  catch (error) {
    console.error('[members/lookup] Error:', error);
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }
}

import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database';
import {
  address,
  attendance,
  classScheduleInstance,
  dojoClass,
  familyMember,
  member,
  memberMembership,
  membershipPlan,
  signedWaiver,
  transaction,
} from '@/lib/memberSchema';
import { requireMemberAuth } from '@/lib/requireMemberAuth';
import { isValidEmail } from '@/lib/utils';

export async function GET(
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

    const db = getDatabase();

    // Fetch member
    const members = await db
      .select()
      .from(member)
      .where(and(eq(member.id, memberId), eq(member.organizationId, orgId)))
      .limit(1);

    const m = members[0];
    if (!m) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    // Fetch related data sequentially (pglite-server single connection)
    const addresses = await db.select().from(address).where(eq(address.memberId, memberId));

    const memberships = await db
      .select({
        id: memberMembership.id,
        status: memberMembership.status,
        billingType: memberMembership.billingType,
        startDate: memberMembership.startDate,
        nextPaymentDate: memberMembership.nextPaymentDate,
        planName: membershipPlan.name,
        planCategory: membershipPlan.category,
        planPrice: membershipPlan.price,
        planFrequency: membershipPlan.frequency,
        planContractLength: membershipPlan.contractLength,
        isTrial: membershipPlan.isTrial,
        cancellationFee: membershipPlan.cancellationFee,
        holdFeeAmount: membershipPlan.holdFeeAmount,
        holdFeeFrequency: membershipPlan.holdFeeFrequency,
        holdLimitPerYear: membershipPlan.holdLimitPerYear,
      })
      .from(memberMembership)
      .innerJoin(membershipPlan, eq(memberMembership.membershipPlanId, membershipPlan.id))
      .where(eq(memberMembership.memberId, memberId));

    const waivers = await db
      .select({
        id: signedWaiver.id,
        membershipPlanName: signedWaiver.membershipPlanName,
        signedByName: signedWaiver.signedByName,
        signedAt: signedWaiver.signedAt,
      })
      .from(signedWaiver)
      .where(eq(signedWaiver.memberId, memberId))
      .orderBy(desc(signedWaiver.signedAt));

    // For HOH members, also include family members' transactions
    const isHOH = m.memberType === 'head-of-household';
    const familyMemberIds: string[] = [];
    const familyNameMap = new Map<string, string>();

    if (isHOH) {
      const links = await db
        .select()
        .from(familyMember)
        .where(
          or(
            eq(familyMember.memberId, memberId),
            eq(familyMember.relatedMemberId, memberId),
          ),
        );

      const relatedIds = new Set<string>();
      for (const link of links) {
        if (link.memberId !== memberId) {
          relatedIds.add(link.memberId);
        }
        if (link.relatedMemberId !== memberId) {
          relatedIds.add(link.relatedMemberId);
        }
      }

      if (relatedIds.size > 0) {
        const relatedIdArr = [...relatedIds];
        // Single batched fetch instead of one query per family member.
        // Org-scoped so a stale cross-org family link can't leak another org's
        // member names / transactions into this HOH's view.
        const fmRows = await db
          .select({ id: member.id, firstName: member.firstName, lastName: member.lastName })
          .from(member)
          .where(and(inArray(member.id, relatedIdArr), eq(member.organizationId, orgId)));
        for (const fm of fmRows) {
          familyMemberIds.push(fm.id);
          familyNameMap.set(fm.id, `${fm.firstName} ${fm.lastName}`);
        }
      }
    }

    const allTransactionMemberIds = [memberId, ...familyMemberIds];
    const transactions = await db
      .select()
      .from(transaction)
      .where(and(
        eq(transaction.organizationId, orgId),
        allTransactionMemberIds.length > 1
          ? inArray(transaction.memberId, allTransactionMemberIds)
          : eq(transaction.memberId, memberId),
      ))
      .orderBy(desc(transaction.createdAt))
      .limit(50);

    const attendanceRecords = await db
      .select({
        id: attendance.id,
        attendanceDate: attendance.attendanceDate,
        checkInTime: attendance.checkInTime,
        checkInMethod: attendance.checkInMethod,
        className: dojoClass.name,
        startTime: classScheduleInstance.startTime,
        endTime: classScheduleInstance.endTime,
        room: classScheduleInstance.room,
      })
      .from(attendance)
      .leftJoin(classScheduleInstance, eq(attendance.classScheduleInstanceId, classScheduleInstance.id))
      .leftJoin(dojoClass, eq(classScheduleInstance.classId, dojoClass.id))
      .where(eq(attendance.memberId, memberId))
      .orderBy(desc(attendance.attendanceDate))
      .limit(50);

    return NextResponse.json({
      member: {
        id: m.id,
        firstName: m.firstName,
        lastName: m.lastName,
        email: m.email,
        phone: m.phone,
        status: m.status,
        memberType: m.memberType ?? 'individual',
        dateOfBirth: m.dateOfBirth?.toISOString() ?? null,
        createdAt: m.createdAt?.toISOString() ?? null,
      },
      addresses: addresses.map(a => ({
        id: a.id,
        type: a.type,
        street: a.street,
        city: a.city,
        state: a.state,
        zipCode: a.zipCode,
        country: a.country,
        isDefault: a.isDefault,
      })),
      memberships: memberships.map(ms => ({
        id: ms.id,
        status: ms.status,
        billingType: ms.billingType,
        startDate: ms.startDate?.toISOString() ?? null,
        nextPaymentDate: ms.nextPaymentDate?.toISOString() ?? null,
        planName: ms.planName,
        planCategory: ms.planCategory,
        planPrice: ms.planPrice,
        planFrequency: ms.planFrequency,
        planContractLength: ms.planContractLength,
        isTrial: ms.isTrial ?? false,
        cancellationFee: ms.cancellationFee,
        holdFeeAmount: ms.holdFeeAmount,
        holdFeeFrequency: ms.holdFeeFrequency,
        holdLimitPerYear: ms.holdLimitPerYear,
      })),
      waivers: waivers.map(w => ({
        id: w.id,
        membershipPlanName: w.membershipPlanName,
        signedByName: w.signedByName,
        signedAt: w.signedAt?.toISOString() ?? null,
      })),
      transactions: transactions.map(t => ({
        id: t.id,
        transactionType: t.transactionType,
        amount: t.amount,
        status: t.status,
        paymentMethod: t.paymentMethod,
        description: t.description,
        processedAt: t.processedAt?.toISOString() ?? null,
        createdAt: t.createdAt?.toISOString() ?? null,
        memberName: t.memberId && t.memberId !== memberId
          ? familyNameMap.get(t.memberId) ?? null
          : null,
      })),
      attendance: attendanceRecords.map(a => ({
        id: a.id,
        attendanceDate: a.attendanceDate?.toISOString() ?? null,
        checkInTime: a.checkInTime?.toISOString() ?? null,
        checkInMethod: a.checkInMethod,
        className: a.className,
        startTime: a.startTime,
        endTime: a.endTime,
        room: a.room,
      })),
    });
  }
  catch (error) {
    console.error('[members/[memberId]] GET Error:', error);
    return NextResponse.json({ error: 'Failed to load member' }, { status: 500 });
  }
}

export async function PATCH(
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

    const body = await request.json() as {
      firstName?: string;
      lastName?: string;
      email?: string;
      phone?: string;
      dateOfBirth?: string;
      address?: {
        street?: string;
        city?: string;
        state?: string;
        zipCode?: string;
        country?: string;
      };
    };

    const db = getDatabase();

    // Update member fields — validate each before accepting it so a client
    // can't write an empty name, a malformed email, a partial phone, a
    // non-date, or a future DOB.
    const memberUpdate: Record<string, unknown> = {};
    if (body.firstName !== undefined) {
      if (!body.firstName.trim()) {
        return NextResponse.json({ error: 'First name is required' }, { status: 400 });
      }
      memberUpdate.firstName = body.firstName.trim();
    }
    if (body.lastName !== undefined) {
      if (!body.lastName.trim()) {
        return NextResponse.json({ error: 'Last name is required' }, { status: 400 });
      }
      memberUpdate.lastName = body.lastName.trim();
    }
    if (body.email !== undefined) {
      if (!isValidEmail(body.email)) {
        return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
      }
      memberUpdate.email = body.email.trim();
    }
    if (body.phone !== undefined) {
      const digits = body.phone.replace(/\D/g, '');
      if (digits.length > 0 && digits.length !== 10) {
        return NextResponse.json({ error: 'A valid 10-digit phone number is required' }, { status: 400 });
      }
      memberUpdate.phone = digits || null;
    }
    if (body.dateOfBirth !== undefined) {
      if (body.dateOfBirth) {
        const dob = new Date(`${body.dateOfBirth}T12:00:00`);
        if (Number.isNaN(dob.getTime())) {
          return NextResponse.json({ error: 'A valid date of birth is required' }, { status: 400 });
        }
        if (dob > new Date()) {
          return NextResponse.json({ error: 'Date of birth cannot be in the future' }, { status: 400 });
        }
        memberUpdate.dateOfBirth = dob;
      }
      else {
        memberUpdate.dateOfBirth = null;
      }
    }

    if (Object.keys(memberUpdate).length > 0) {
      memberUpdate.updatedAt = new Date();
      await db.update(member).set(memberUpdate).where(
        and(eq(member.id, memberId), eq(member.organizationId, orgId)),
      );
    }

    // Update or create address
    if (body.address) {
      const existingAddresses = await db
        .select()
        .from(address)
        .where(eq(address.memberId, memberId));

      const defaultAddr = existingAddresses.find(a => a.isDefault) ?? existingAddresses[0];

      const addrValues = {
        street: body.address.street ?? '',
        city: body.address.city ?? '',
        state: body.address.state ?? '',
        zipCode: body.address.zipCode ?? '',
        country: body.address.country ?? 'US',
      };

      if (defaultAddr) {
        await db.update(address).set(addrValues).where(eq(address.id, defaultAddr.id));
      }
      else {
        await db.insert(address).values({
          id: randomUUID(),
          memberId,
          type: 'home',
          ...addrValues,
          isDefault: true,
        });
      }
    }

    return NextResponse.json({ success: true });
  }
  catch (error) {
    console.error('[members/[memberId]] PATCH Error:', error);
    return NextResponse.json({ error: 'Failed to update member' }, { status: 500 });
  }
}

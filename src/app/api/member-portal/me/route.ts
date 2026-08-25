import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { address, member } from '@/lib/memberSchema';
import { getSessionFromCookie } from '@/lib/memberSession';
import { getDatabaseForOrg } from '@/lib/tenantDirectory';
import { isValidEmail } from '@/lib/utils';

export async function GET(request: Request) {
  try {
    const session = await getSessionFromCookie(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = await getDatabaseForOrg(session.orgId);

    const members = await db
      .select()
      .from(member)
      .where(eq(member.id, session.memberId))
      .limit(1);

    const m = members[0];
    if (!m) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    const addresses = await db
      .select()
      .from(address)
      .where(eq(address.memberId, session.memberId));

    const defaultAddr = addresses.find(a => a.isDefault) ?? addresses[0];

    return NextResponse.json({
      member: {
        id: m.id,
        firstName: m.firstName,
        lastName: m.lastName,
        email: m.email,
        phone: m.phone,
        dateOfBirth: m.dateOfBirth?.toISOString() ?? null,
        status: m.status,
        memberType: m.memberType ?? 'individual',
        createdAt: m.createdAt?.toISOString() ?? null,
      },
      address: defaultAddr
        ? {
            street: defaultAddr.street,
            city: defaultAddr.city,
            state: defaultAddr.state,
            zipCode: defaultAddr.zipCode,
            country: defaultAddr.country,
          }
        : null,
    });
  }
  catch (error) {
    console.error('[member-portal/me] GET Error:', error);
    return NextResponse.json({ error: 'Failed to load profile' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await getSessionFromCookie(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json() as {
      firstName?: string;
      lastName?: string;
      email?: string;
      phone?: string;
      dateOfBirth?: string;
    };

    // Server-side validation — client checks are UX only, never a control.
    const db = await getDatabaseForOrg(session.orgId);
    const updates: Record<string, unknown> = {};

    if (body.firstName !== undefined) {
      const v = body.firstName.trim();
      if (!v) {
        return NextResponse.json({ error: 'First name is required' }, { status: 400 });
      }
      updates.firstName = v;
    }
    if (body.lastName !== undefined) {
      const v = body.lastName.trim();
      if (!v) {
        return NextResponse.json({ error: 'Last name is required' }, { status: 400 });
      }
      updates.lastName = v;
    }
    if (body.email !== undefined) {
      const v = body.email.trim();
      if (!v || !isValidEmail(v)) {
        return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
      }
      updates.email = v;
    }
    if (body.phone !== undefined) {
      const digits = body.phone.replace(/\D/g, '');
      if (digits.length > 0 && digits.length !== 10) {
        return NextResponse.json({ error: 'Please enter a valid 10-digit phone number' }, { status: 400 });
      }
      updates.phone = digits || null;
    }
    if (body.dateOfBirth !== undefined) {
      if (body.dateOfBirth) {
        const dob = new Date(body.dateOfBirth);
        if (Number.isNaN(dob.getTime()) || dob > new Date()) {
          return NextResponse.json({ error: 'Please enter a valid date of birth' }, { status: 400 });
        }
        updates.dateOfBirth = dob;
      }
      else {
        updates.dateOfBirth = null;
      }
    }

    if (Object.keys(updates).length > 0) {
      updates.updatedAt = new Date();
      await db.update(member).set(updates).where(
        and(eq(member.id, session.memberId), eq(member.organizationId, session.orgId)),
      );
    }

    return NextResponse.json({ success: true });
  }
  catch (error) {
    console.error('[member-portal/me] PATCH Error:', error);
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 });
  }
}

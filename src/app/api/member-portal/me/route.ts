import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database';
import { address, member } from '@/lib/memberSchema';
import { getSessionFromCookie } from '@/lib/memberSession';

export async function GET(request: Request) {
  try {
    const session = await getSessionFromCookie(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = getDatabase();

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

    const db = getDatabase();
    const updates: Record<string, unknown> = {};

    if (body.firstName !== undefined) {
      updates.firstName = body.firstName;
    }
    if (body.lastName !== undefined) {
      updates.lastName = body.lastName;
    }
    if (body.email !== undefined) {
      updates.email = body.email;
    }
    if (body.phone !== undefined) {
      updates.phone = body.phone.replace(/\D/g, '') || null;
    }
    if (body.dateOfBirth !== undefined) {
      updates.dateOfBirth = body.dateOfBirth ? new Date(body.dateOfBirth) : null;
    }

    if (Object.keys(updates).length > 0) {
      updates.updatedAt = new Date();
      await db.update(member).set(updates).where(eq(member.id, session.memberId));
    }

    return NextResponse.json({ success: true });
  }
  catch (error) {
    console.error('[member-portal/me] PATCH Error:', error);
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 });
  }
}

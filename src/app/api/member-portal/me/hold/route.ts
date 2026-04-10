import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database';
import { member, memberMembership } from '@/lib/memberSchema';
import { getSessionFromCookie } from '@/lib/memberSession';

export async function POST(request: Request) {
  try {
    const session = await getSessionFromCookie(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json() as { action: 'hold' | 'resume' };
    const action = body.action;

    if (action !== 'hold' && action !== 'resume') {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    const db = getDatabase();
    const now = new Date();

    if (action === 'hold') {
      // Put membership on hold
      await db.update(member)
        .set({ status: 'hold', statusChangedAt: now, updatedAt: now })
        .where(eq(member.id, session.memberId));

      await db.update(memberMembership)
        .set({ status: 'hold', updatedAt: now })
        .where(
          and(
            eq(memberMembership.memberId, session.memberId),
            eq(memberMembership.status, 'active'),
          ),
        );
    }
    else {
      // Resume membership
      await db.update(member)
        .set({ status: 'active', statusChangedAt: now, updatedAt: now })
        .where(eq(member.id, session.memberId));

      await db.update(memberMembership)
        .set({ status: 'active', updatedAt: now })
        .where(
          and(
            eq(memberMembership.memberId, session.memberId),
            eq(memberMembership.status, 'hold'),
          ),
        );
    }

    return NextResponse.json({ success: true, status: action === 'hold' ? 'hold' : 'active' });
  }
  catch (error) {
    console.error('[member-portal/me/hold] Error:', error);
    return NextResponse.json({ error: 'Failed to update membership' }, { status: 500 });
  }
}

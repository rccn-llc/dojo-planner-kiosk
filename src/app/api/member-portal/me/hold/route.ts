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

    // Only transition memberships currently in the expected source state, and
    // only flip the member row when a membership actually changed — so a repeat
    // request (or a request against the wrong state) is a no-op rather than
    // silently forcing member.status out of sync with their memberships.
    const fromStatus = action === 'hold' ? 'active' : 'hold';
    const toStatus = action === 'hold' ? 'hold' : 'active';

    const updated = await db.update(memberMembership)
      .set({ status: toStatus, updatedAt: now })
      .where(
        and(
          eq(memberMembership.memberId, session.memberId),
          eq(memberMembership.status, fromStatus),
        ),
      )
      .returning({ id: memberMembership.id });

    if (updated.length === 0) {
      return NextResponse.json(
        { error: action === 'hold' ? 'No active membership to hold' : 'No held membership to resume' },
        { status: 409 },
      );
    }

    await db.update(member)
      .set({ status: toStatus, statusChangedAt: now, updatedAt: now })
      .where(and(eq(member.id, session.memberId), eq(member.organizationId, session.orgId)));

    return NextResponse.json({ success: true, status: toStatus });
  }
  catch (error) {
    console.error('[member-portal/me/hold] Error:', error);
    return NextResponse.json({ error: 'Failed to update membership' }, { status: 500 });
  }
}

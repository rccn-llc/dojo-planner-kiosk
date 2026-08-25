import { and, desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { transaction } from '@/lib/memberSchema';
import { getSessionFromCookie } from '@/lib/memberSession';
import { getDatabaseForOrg } from '@/lib/tenantDirectory';

export async function GET(request: Request) {
  try {
    const session = await getSessionFromCookie(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = await getDatabaseForOrg(session.orgId);

    const transactions = await db
      .select()
      .from(transaction)
      .where(and(
        eq(transaction.memberId, session.memberId),
        eq(transaction.organizationId, session.orgId),
      ))
      .orderBy(desc(transaction.createdAt))
      .limit(100);

    return NextResponse.json({
      transactions: transactions.map(t => ({
        id: t.id,
        transactionType: t.transactionType,
        amount: t.amount,
        status: t.status,
        paymentMethod: t.paymentMethod,
        description: t.description,
        processedAt: t.processedAt?.toISOString() ?? null,
        createdAt: t.createdAt?.toISOString() ?? null,
      })),
    });
  }
  catch (error) {
    console.error('[member-portal/me/billing] Error:', error);
    return NextResponse.json({ error: 'Failed to load billing' }, { status: 500 });
  }
}

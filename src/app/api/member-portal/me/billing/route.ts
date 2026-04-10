import { desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database';
import { transaction } from '@/lib/memberSchema';
import { getSessionFromCookie } from '@/lib/memberSession';

export async function GET(request: Request) {
  try {
    const session = await getSessionFromCookie(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = getDatabase();

    const transactions = await db
      .select()
      .from(transaction)
      .where(eq(transaction.memberId, session.memberId))
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

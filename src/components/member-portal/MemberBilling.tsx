'use client';

import { use, useEffect, useState } from 'react';
import { OrgContext } from '@/lib/useOrgContext';
import { MemberNav } from './MemberNav';

interface TransactionData {
  id: string;
  transactionType: string | null;
  amount: number;
  status: string;
  paymentMethod: string | null;
  description: string | null;
  processedAt: string | null;
  createdAt: string | null;
}

export function MemberBilling() {
  const org = use(OrgContext);
  const [transactions, setTransactions] = useState<TransactionData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/member-portal/me/billing')
      .then(r => r.json())
      .then((data) => {
        setTransactions(data.transactions ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) {
      return '—';
    }
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="bg-black p-6">
        <h1 className="text-center text-2xl font-bold text-white">{org?.orgName ?? 'Billing'}</h1>
      </header>
      <MemberNav />
      <main className="mx-auto w-full max-w-2xl flex-1 p-6">
        <h2 className="mb-6 text-xl font-bold text-black">Billing History</h2>

        {loading
          ? <p className="py-16 text-center text-gray-500">Loading...</p>
          : transactions.length === 0
            ? <p className="py-16 text-center text-gray-400">No transactions found.</p>
            : (
                <div className="space-y-3">
                  {transactions.map(t => (
                    <div key={t.id} className="flex items-center justify-between rounded-xl border border-gray-200 px-5 py-4">
                      <div>
                        <p className="font-semibold text-black">{t.description ?? t.transactionType ?? 'Payment'}</p>
                        <p className="text-sm text-gray-500">{formatDate(t.processedAt ?? t.createdAt)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold text-black">
                          $
                          {t.amount.toFixed(2)}
                        </p>
                        <p className={`text-xs font-semibold capitalize ${
                          t.status === 'paid' ? 'text-green-600' : 'text-gray-500'
                        }`}
                        >
                          {t.status}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
      </main>
    </div>
  );
}

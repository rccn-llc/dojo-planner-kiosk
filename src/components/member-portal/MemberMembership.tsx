'use client';

import { use, useEffect, useState } from 'react';
import { OrgContext } from '@/lib/useOrgContext';
import { MemberNav } from './MemberNav';

interface MembershipData {
  id: string;
  status: string;
  billingType: string | null;
  startDate: string | null;
  nextPaymentDate: string | null;
  planName: string;
  planPrice: number;
  planFrequency: string | null;
}

export function MemberMembership() {
  const org = use(OrgContext);
  const [memberships, setMemberships] = useState<MembershipData[]>([]);
  const [memberStatus, setMemberStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [holdLoading, setHoldLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/member-portal/me')
      .then(r => r.json())
      .then((data) => {
        if (data.member) {
          setMemberStatus(data.member.status);
          // Load memberships from the member detail endpoint
          return fetch(`/api/members/${data.member.id}`);
        }
        return null;
      })
      .then((res) => {
        if (res) {
          return res.json();
        }
        return { memberships: [] };
      })
      .then((data) => {
        setMemberships(data.memberships ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleHoldToggle = async () => {
    const action = memberStatus === 'hold' ? 'resume' : 'hold';
    setHoldLoading(true);
    setError('');
    try {
      const res = await fetch('/api/member-portal/me/hold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (data.success) {
        setMemberStatus(data.status);
      }
      else {
        setError(data.error ?? 'Failed to update membership');
      }
    }
    catch {
      setError('Failed to update membership');
    }
    setHoldLoading(false);
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) {
      return '—';
    }
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const activeMembership = memberships.find(m => m.status === 'active' || m.status === 'hold');

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="bg-black p-6">
        <h1 className="text-center text-2xl font-bold text-white">{org?.orgName ?? 'Membership'}</h1>
      </header>
      <MemberNav />
      <main className="mx-auto w-full max-w-2xl flex-1 p-6">
        <h2 className="mb-6 text-xl font-bold text-black">Your Membership</h2>

        {error && <p className="mb-4 text-red-500">{error}</p>}

        {loading
          ? <p className="py-16 text-center text-gray-500">Loading...</p>
          : !activeMembership
              ? <p className="py-16 text-center text-gray-400">No active membership found.</p>
              : (
                  <div className="rounded-2xl border border-gray-200 p-6">
                    <div className="mb-4 flex items-center justify-between">
                      <h3 className="text-xl font-bold text-black">{activeMembership.planName}</h3>
                      <span className={`rounded-lg px-3 py-1 text-sm font-semibold capitalize ${
                        memberStatus === 'active'
                          ? 'bg-green-100 text-green-700'
                          : memberStatus === 'hold'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-gray-100 text-gray-600'
                      }`}
                      >
                        {memberStatus}
                      </span>
                    </div>

                    <div className="space-y-3">
                      <div className="flex justify-between border-b border-gray-100 py-2">
                        <span className="text-gray-500">Price</span>
                        <span className="font-semibold text-black">
                          $
                          {activeMembership.planPrice.toFixed(2)}
                          {activeMembership.planFrequency ? ` / ${activeMembership.planFrequency.toLowerCase()}` : ''}
                        </span>
                      </div>
                      <div className="flex justify-between border-b border-gray-100 py-2">
                        <span className="text-gray-500">Start Date</span>
                        <span className="font-semibold text-black">{formatDate(activeMembership.startDate)}</span>
                      </div>
                      {activeMembership.nextPaymentDate && (
                        <div className="flex justify-between border-b border-gray-100 py-2">
                          <span className="text-gray-500">Next Payment</span>
                          <span className="font-semibold text-black">{formatDate(activeMembership.nextPaymentDate)}</span>
                        </div>
                      )}
                      <div className="flex justify-between py-2">
                        <span className="text-gray-500">Billing Type</span>
                        <span className="font-semibold text-black capitalize">{activeMembership.billingType ?? '—'}</span>
                      </div>
                    </div>

                    <div className="mt-6">
                      <button
                        type="button"
                        onClick={handleHoldToggle}
                        disabled={holdLoading}
                        className={`min-h-12 w-full cursor-pointer rounded-xl px-6 py-3 font-bold transition-all hover:scale-105 active:scale-95 disabled:opacity-50 ${
                          memberStatus === 'hold'
                            ? 'bg-green-600 text-white'
                            : 'border-2 border-amber-500 bg-white text-amber-600'
                        }`}
                      >
                        {holdLoading
                          ? 'Updating...'
                          : memberStatus === 'hold'
                            ? 'Resume Membership'
                            : 'Put On Hold'}
                      </button>
                    </div>
                  </div>
                )}
      </main>
    </div>
  );
}

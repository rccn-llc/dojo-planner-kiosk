'use client';

import { use, useEffect, useState } from 'react';
import { OrgContext } from '@/lib/useOrgContext';
import { MemberNav } from './MemberNav';

interface WaiverData {
  id: string;
  membershipPlanName: string | null;
  signedByName: string | null;
  signedAt: string | null;
}

export function MemberWaivers() {
  const org = use(OrgContext);
  const [waivers, setWaivers] = useState<WaiverData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/member-portal/me/waivers')
      .then(r => r.json())
      .then((data) => {
        setWaivers(data.waivers ?? []);
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
        <h1 className="text-center text-2xl font-bold text-white">{org?.orgName ?? 'Waivers'}</h1>
      </header>
      <MemberNav />
      <main className="mx-auto w-full max-w-2xl flex-1 p-6">
        <h2 className="mb-6 text-xl font-bold text-black">Signed Waivers</h2>

        {loading
          ? <p className="py-16 text-center text-gray-500">Loading...</p>
          : waivers.length === 0
            ? <p className="py-16 text-center text-gray-400">No signed waivers found.</p>
            : (
                <div className="space-y-3">
                  {waivers.map(w => (
                    <div key={w.id} className="rounded-xl border border-gray-200 px-5 py-4">
                      <p className="font-semibold text-black">{w.membershipPlanName ?? 'Waiver'}</p>
                      <p className="text-sm text-gray-500">
                        Signed by
                        {' '}
                        {w.signedByName ?? 'Unknown'}
                        {' '}
                        on
                        {' '}
                        {formatDate(w.signedAt)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
      </main>
    </div>
  );
}

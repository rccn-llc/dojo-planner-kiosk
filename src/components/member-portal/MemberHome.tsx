'use client';

import { useRouter } from 'next/navigation';
import { use, useEffect, useState } from 'react';
import { OrgContext } from '@/lib/useOrgContext';
import { MemberNav } from './MemberNav';

interface MemberData {
  firstName: string;
  lastName: string;
  status: string;
}

export function MemberHome() {
  const org = use(OrgContext);
  const router = useRouter();
  const [memberData, setMemberData] = useState<MemberData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/member-portal/me')
      .then(r => r.json())
      .then((data) => {
        if (data.member) {
          setMemberData(data.member);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const base = `/${org?.orgSlug ?? ''}/dashboard`;

  const quickLinks = [
    { label: 'Check In', path: `${base}/checkin`, description: 'Check in to a class' },
    { label: 'Profile', path: `${base}/profile`, description: 'View and edit your info' },
    { label: 'Membership', path: `${base}/membership`, description: 'View membership details' },
    { label: 'Billing', path: `${base}/billing`, description: 'View payment history' },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="bg-black p-6">
        <h1 className="text-center text-2xl font-bold text-white sm:text-3xl">
          {org?.orgName ?? 'Member Portal'}
        </h1>
      </header>

      <MemberNav />

      <main className="mx-auto w-full max-w-4xl flex-1 p-6">
        {loading
          ? (
              <div className="py-16 text-center">
                <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-gray-200 border-t-black" />
                <p className="text-gray-500">Loading...</p>
              </div>
            )
          : (
              <>
                <h2 className="mb-6 text-2xl font-bold text-black">
                  Welcome,
                  {' '}
                  {memberData?.firstName ?? 'Member'}
                  !
                </h2>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {quickLinks.map(link => (
                    <button
                      key={link.path}
                      type="button"
                      onClick={() => router.push(link.path)}
                      className="cursor-pointer rounded-2xl border-2 border-gray-200 p-6 text-left transition-all hover:border-black hover:bg-gray-50 active:scale-95"
                    >
                      <p className="text-xl font-bold text-black">{link.label}</p>
                      <p className="mt-1 text-gray-500">{link.description}</p>
                    </button>
                  ))}
                </div>
              </>
            )}
      </main>
    </div>
  );
}

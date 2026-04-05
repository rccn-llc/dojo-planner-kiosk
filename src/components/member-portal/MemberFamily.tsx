'use client';

import { use, useEffect, useState } from 'react';
import { OrgContext } from '@/lib/useOrgContext';
import { MemberNav } from './MemberNav';

interface FamilyMemberData {
  id: string;
  firstName: string;
  lastName: string;
  status: string;
  memberType: string;
  relationship: string;
}

export function MemberFamily() {
  const org = use(OrgContext);
  const [familyMembers, setFamilyMembers] = useState<FamilyMemberData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // First get current member ID, then fetch family
    fetch('/api/member-portal/me')
      .then(r => r.json())
      .then((data) => {
        if (data.member?.id) {
          return fetch(`/api/members/${data.member.id}/family`);
        }
        return null;
      })
      .then((res) => {
        if (res) {
          return res.json();
        }
        return { familyMembers: [] };
      })
      .then((data) => {
        setFamilyMembers(data.familyMembers ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="bg-black p-6">
        <h1 className="text-center text-2xl font-bold text-white">{org?.orgName ?? 'Family'}</h1>
      </header>
      <MemberNav />
      <main className="mx-auto w-full max-w-2xl flex-1 p-6">
        <h2 className="mb-6 text-xl font-bold text-black">Family Members</h2>

        {loading
          ? <p className="py-16 text-center text-gray-500">Loading...</p>
          : familyMembers.length === 0
            ? <p className="py-16 text-center text-gray-400">No family members linked.</p>
            : (
                <div className="space-y-3">
                  {familyMembers.map(fm => (
                    <div key={fm.id} className="flex items-center justify-between rounded-xl border border-gray-200 px-5 py-4">
                      <div>
                        <p className="font-semibold text-black">
                          {fm.firstName}
                          {' '}
                          {fm.lastName}
                        </p>
                        <p className="text-sm text-gray-500 capitalize">{fm.relationship}</p>
                      </div>
                      <span className={`rounded-lg px-3 py-1 text-xs font-semibold capitalize ${
                        fm.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                      }`}
                      >
                        {fm.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
      </main>
    </div>
  );
}

'use client';

import { usePathname, useRouter } from 'next/navigation';
import { use } from 'react';
import { OrgContext } from '@/lib/useOrgContext';

interface NavItem {
  label: string;
  path: string;
}

export function MemberNav() {
  const router = useRouter();
  const pathname = usePathname();
  const org = use(OrgContext);
  const base = `/${org?.orgSlug ?? ''}/dashboard`;

  const items: NavItem[] = [
    { label: 'Home', path: base },
    { label: 'Profile', path: `${base}/profile` },
    { label: 'Membership', path: `${base}/membership` },
    { label: 'Billing', path: `${base}/billing` },
    { label: 'Waivers', path: `${base}/waivers` },
    { label: 'Family', path: `${base}/family` },
    { label: 'Check In', path: `${base}/checkin` },
  ];

  return (
    <nav className="border-b border-gray-200 bg-white px-4">
      <div className="mx-auto flex max-w-4xl gap-1 overflow-x-auto">
        {items.map(item => (
          <button
            key={item.path}
            type="button"
            onClick={() => router.push(item.path)}
            className={`shrink-0 cursor-pointer border-b-2 px-4 py-3 text-sm font-semibold transition-colors ${
              pathname === item.path
                ? 'border-black text-black'
                : 'border-transparent text-gray-500 hover:text-black'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
    </nav>
  );
}

'use client';

import type { ChildMembershipSeed } from './flows/MembershipFlow';
import type { TrialCheckinMember } from './flows/TrialFlow';
import Image from 'next/image';
import { useEffect, useState } from 'react';
import { CheckinFlow } from './flows/CheckinFlow';
import { MemberAreaFlow } from './flows/MemberAreaFlow';
import { MembershipFlow } from './flows/MembershipFlow';
import { StoreFlow } from './flows/StoreFlow';
import { TrialFlow } from './flows/TrialFlow';
import { KioskActionButton } from './KioskActionButton';

type FlowType = 'home' | 'checkin' | 'trial' | 'membership' | 'memberArea' | 'store';

export function KioskHome() {
  const [currentFlow, setCurrentFlow] = useState<FlowType>('home');
  const [orgName, setOrgName] = useState<string | null>(null);
  const [orgImageUrl, setOrgImageUrl] = useState<string | null>(null);
  const [checkinPreseededMembers, setCheckinPreseededMembers] = useState<TrialCheckinMember[]>([]);
  const [childMembershipSeed, setChildMembershipSeed] = useState<ChildMembershipSeed | null>(null);

  useEffect(() => {
    fetch('/api/organization')
      .then(r => r.json())
      .then((data: { name: string | null; imageUrl: string | null }) => {
        if (data.name) {
          setOrgName(data.name);
        }
        if (data.imageUrl) {
          setOrgImageUrl(data.imageUrl);
        }
      })
      .catch(() => {});
  }, []);

  const handleFlowComplete = () => {
    setCurrentFlow('home');
    setCheckinPreseededMembers([]);
    setChildMembershipSeed(null);
  };

  const handleFlowChange = (newFlow: FlowType) => {
    setCurrentFlow(newFlow);
    if (newFlow !== 'checkin') {
      setCheckinPreseededMembers([]);
    }
    if (newFlow !== 'membership') {
      setChildMembershipSeed(null);
    }
  };

  if (currentFlow === 'checkin') {
    return (
      <CheckinFlow
        onComplete={handleFlowComplete}
        onBack={() => handleFlowChange('home')}
        preseededMembers={checkinPreseededMembers.length > 0 ? checkinPreseededMembers : undefined}
      />
    );
  }

  if (currentFlow === 'trial') {
    return (
      <TrialFlow
        onComplete={handleFlowComplete}
        onBack={() => handleFlowChange('home')}
        onCheckIn={(members) => {
          setCheckinPreseededMembers(members);
          setCurrentFlow('checkin');
        }}
      />
    );
  }

  if (currentFlow === 'membership') {
    return (
      <MembershipFlow
        onComplete={handleFlowComplete}
        onBack={() => handleFlowChange('home')}
        initialMemberData={childMembershipSeed ?? undefined}
      />
    );
  }

  if (currentFlow === 'memberArea') {
    return (
      <MemberAreaFlow
        onComplete={handleFlowComplete}
        onBack={() => handleFlowChange('home')}
        onAssignChildMembership={(seed) => {
          setChildMembershipSeed(seed);
          setCurrentFlow('membership');
        }}
      />
    );
  }

  if (currentFlow === 'store') {
    return (
      <StoreFlow
        onComplete={handleFlowComplete}
        onBack={() => handleFlowChange('home')}
      />
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-white">
      {/* Header */}
      <header className="relative bg-black p-4 sm:p-6 md:p-8">
        {orgImageUrl && (
          <Image
            src={orgImageUrl}
            alt={orgName ? `${orgName} logo` : 'Organization logo'}
            width={96}
            height={96}
            unoptimized
            className="absolute top-1/2 left-4 h-12 w-12 -translate-y-1/2 rounded-full object-contain sm:left-6 sm:h-16 sm:w-16 md:left-8 md:h-24 md:w-24"
          />
        )}
        <h1 className={`text-center text-3xl font-bold text-white sm:text-4xl md:text-6xl${orgImageUrl ? ' px-20 sm:px-28 md:px-40' : ''}`}>
          {orgName ?? 'Our Dojo'}
        </h1>
        <p className={`mt-4 text-center text-lg text-white sm:text-xl md:text-2xl${orgImageUrl ? ' px-20 sm:px-28 md:px-40' : ''}`}>
          Select an option below to get started
        </p>
      </header>

      {/* Main Options */}
      <main className="flex flex-1 items-center justify-center p-4 sm:p-6 md:p-8">
        <div className="grid w-full max-w-4xl grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 md:grid-cols-3">
          <KioskActionButton label="Free Trial" variant="lightBlue" onClick={() => handleFlowChange('trial')} />
          <KioskActionButton label="Membership" variant="blue" onClick={() => handleFlowChange('membership')} />
          <KioskActionButton label="Store" onClick={() => handleFlowChange('store')} />
          <KioskActionButton label="Check In" variant="green" onClick={() => handleFlowChange('checkin')} />
          <KioskActionButton label="Manage Profiles" onClick={() => handleFlowChange('memberArea')} />
          {/* "My Account" hidden for now — restore when member-portal subdomain routing is ready.
          <KioskActionButton
            label="My Account"
            variant="dark"
            onClick={() => {
              const slug = (orgName ?? 'dojo').toLowerCase().replace(/[^a-z0-9]+/g, '-');
              window.location.href = `/${slug}`;
            }}
          />
          */}
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-black p-4 text-center sm:p-6">
        <p className="text-lg text-white">
          Need help? Please ask a staff member
        </p>
      </footer>
    </div>
  );
}

'use client';

import type { ChildMembershipSeed } from './flows/MembershipFlow';
import type { TrialCheckinMember } from './flows/TrialFlow';
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
  const [checkinPreseededMembers, setCheckinPreseededMembers] = useState<TrialCheckinMember[]>([]);
  const [childMembershipSeed, setChildMembershipSeed] = useState<ChildMembershipSeed | null>(null);

  useEffect(() => {
    fetch('/api/organization')
      .then(r => r.json())
      .then((data: { name: string | null }) => {
        if (data.name) {
          setOrgName(data.name);
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
      <header className="bg-black p-4 sm:p-6 md:p-8">
        <h1 className="text-center text-3xl font-bold text-white sm:text-4xl md:text-6xl">
          Welcome to
          {' '}
          {orgName ?? 'Our Dojo'}
        </h1>
        <p className="mt-4 text-center text-lg text-white sm:text-xl md:text-2xl">
          Select an option below to get started
        </p>
      </header>

      {/* Main Options */}
      <main className="flex flex-1 items-center justify-center p-4 sm:p-6 md:p-8">
        <div className="grid w-full max-w-4xl grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 md:grid-cols-3">
          <KioskActionButton label="Free Trial" onClick={() => handleFlowChange('trial')} />
          <KioskActionButton label="Membership" onClick={() => handleFlowChange('membership')} />
          <KioskActionButton label="Store" onClick={() => handleFlowChange('store')} />
          <KioskActionButton label="Check In" onClick={() => handleFlowChange('checkin')} />
          <KioskActionButton label="Member Management" onClick={() => handleFlowChange('memberArea')} />
          <KioskActionButton
            label="My Account"
            variant="dark"
            onClick={() => {
              const slug = (orgName ?? 'dojo').toLowerCase().replace(/[^a-z0-9]+/g, '-');
              window.location.href = `/${slug}`;
            }}
          />
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

'use client';

import { useEffect, useState } from 'react';
import { CheckinFlow } from './flows/CheckinFlow';
import { MemberAreaFlow } from './flows/MemberAreaFlow';
import { MembershipFlow } from './flows/MembershipFlow';
import { StoreFlow } from './flows/StoreFlow';
import { TrialFlow } from './flows/TrialFlow';

type FlowType = 'home' | 'checkin' | 'trial' | 'membership' | 'memberArea' | 'store';

export function KioskHome() {
  const [currentFlow, setCurrentFlow] = useState<FlowType>('home');
  const [orgName, setOrgName] = useState<string | null>(null);

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
  };

  const handleFlowChange = (newFlow: FlowType) => {
    setCurrentFlow(newFlow);
  };

  if (currentFlow === 'checkin') {
    return (
      <CheckinFlow
        onComplete={handleFlowComplete}
        onBack={() => handleFlowChange('home')}
      />
    );
  }

  if (currentFlow === 'trial') {
    return <TrialFlow onComplete={handleFlowComplete} onBack={() => handleFlowChange('home')} onCheckIn={() => handleFlowChange('checkin')} />;
  }

  if (currentFlow === 'membership') {
    return <MembershipFlow onComplete={handleFlowComplete} onBack={() => handleFlowChange('home')} onCheckIn={() => handleFlowChange('checkin')} />;
  }

  if (currentFlow === 'memberArea') {
    return <MemberAreaFlow onComplete={handleFlowComplete} onBack={() => handleFlowChange('home')} />;
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

          {/* Col 1 Row 1: Free Trial */}
          <button
            type="button"
            onClick={() => handleFlowChange('trial')}
            className="flex cursor-pointer items-center justify-center rounded-3xl border-2 border-black bg-white py-8 text-center transition-all duration-300 hover:scale-105 hover:bg-gray-100 sm:py-10 md:py-12"
          >
            <h2 className="text-3xl font-bold text-black">Free Trial</h2>
          </button>

          {/* Col 2 Row 1: Membership */}
          <button
            type="button"
            onClick={() => handleFlowChange('membership')}
            className="flex cursor-pointer items-center justify-center rounded-3xl border-2 border-black bg-white py-8 text-center transition-all duration-300 hover:scale-105 hover:bg-gray-100 sm:py-10 md:py-12"
          >
            <h2 className="text-3xl font-bold text-black">Membership</h2>
          </button>

          {/* Col 3 Row 1: Check In */}
          <button
            type="button"
            onClick={() => handleFlowChange('checkin')}
            className="flex cursor-pointer items-center justify-center rounded-3xl border-2 border-black bg-white py-8 text-center transition-all duration-300 hover:scale-105 hover:bg-gray-100 sm:py-10 md:py-12"
          >
            <h2 className="text-3xl font-bold text-black">Check In</h2>
          </button>

          {/* Col 1 Row 2: Members Area */}
          <button
            type="button"
            onClick={() => handleFlowChange('memberArea')}
            className="flex cursor-pointer items-center justify-center rounded-3xl border-2 border-black bg-white py-8 text-center transition-all duration-300 hover:scale-105 hover:bg-gray-100 sm:py-10 md:py-12"
          >
            <h2 className="text-3xl font-bold text-black">Members Area</h2>
          </button>

          {/* Col 2 Row 2: Store */}
          <button
            type="button"
            onClick={() => handleFlowChange('store')}
            className="flex cursor-pointer items-center justify-center rounded-3xl border-2 border-black bg-white py-8 text-center transition-all duration-300 hover:scale-105 hover:bg-gray-100 sm:py-10 md:py-12"
          >
            <h2 className="text-3xl font-bold text-black">Store</h2>
          </button>

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

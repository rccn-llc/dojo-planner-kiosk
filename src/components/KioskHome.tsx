'use client';

import { useEffect, useState } from 'react';
import { CheckinFlow } from './flows/CheckinFlow';
import { MemberAreaFlow } from './flows/MemberAreaFlow';
import { MembershipFlow } from './flows/MembershipFlow';
import { TrialFlow } from './flows/TrialFlow';

type FlowType = 'home' | 'checkin' | 'trial' | 'membership' | 'memberArea';

export function KioskHome() {
  const [currentFlow, setCurrentFlow] = useState<FlowType>('home');

  // Debug logging and global function
  useEffect(() => {
    console.log('Current Flow:', currentFlow);

    // Add global debug function to window
    (window as any).kioskDebug = () => {
      console.log('KIOSK DEBUG INFO:');
      console.log('Current Flow:', currentFlow);
      console.log('Timestamp:', new Date().toLocaleTimeString());
      return { currentFlow, timestamp: new Date().toISOString() };
    };
  }, [currentFlow]);

  const handleFlowComplete = () => {
    console.log('Flow completed, returning to home');
    setCurrentFlow('home');
  };

  const handleFlowChange = (newFlow: FlowType) => {
    console.log(`Flow changing: ${currentFlow} → ${newFlow}`);
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
    return <TrialFlow onComplete={handleFlowComplete} onBack={() => handleFlowChange('home')} />;
  }

  if (currentFlow === 'membership') {
    return <MembershipFlow onComplete={handleFlowComplete} onBack={() => handleFlowChange('home')} />;
  }

  if (currentFlow === 'memberArea') {
    return <MemberAreaFlow onComplete={handleFlowComplete} onBack={() => handleFlowChange('home')} />;
  }

  return (
    <div className="flex min-h-screen flex-col bg-white">
      {/* Header */}
      <header className="bg-black p-8">
        <h1 className="text-center text-6xl font-bold text-white">
          Welcome to Our Dojo
        </h1>
        <p className="mt-4 text-center text-2xl text-white">
          Select an option below to get started
        </p>
      </header>

      {/* Main Options */}
      <main className="flex flex-1 items-center justify-center p-8">
        <div className="grid w-full max-w-7xl grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">

          {/* Member Check-in */}
          <button
            onClick={() => handleFlowChange('checkin')}
            className="group flex min-h-80 cursor-pointer flex-col justify-center rounded-3xl border-2 border-black bg-white p-12 text-center transition-all duration-300 hover:scale-105 hover:bg-gray-100"
          >

            <h2 className="mb-4 text-4xl font-bold text-black">
              Member Check-in
            </h2>
            <p className="text-xl text-black">
              Already a member? Check in for your class
            </p>
          </button>

          {/* Free Trial */}
          <button
            onClick={() => handleFlowChange('trial')}
            className="group flex min-h-80 cursor-pointer flex-col justify-center rounded-3xl border-2 border-black bg-white p-12 text-center transition-all duration-300 hover:scale-105 hover:bg-gray-100"
          >

            <h2 className="mb-4 text-4xl font-bold text-black">
              Free Trial
            </h2>
            <p className="text-xl text-black">
              New to martial arts? Sign up for a complimentary trial
            </p>
          </button>

          {/* Membership Signup */}
          <button
            onClick={() => handleFlowChange('membership')}
            className="group flex min-h-80 cursor-pointer flex-col justify-center rounded-3xl border-2 border-black bg-white p-12 text-center transition-all duration-300 hover:scale-105 hover:bg-gray-100"
          >

            <h2 className="mb-4 text-4xl font-bold text-black">
              Join Our Dojo
            </h2>
            <p className="text-xl text-black">
              Ready to commit? Sign up for a membership today
            </p>
          </button>

          {/* Member Area */}
          <button
            onClick={() => handleFlowChange('memberArea')}
            className="group flex min-h-80 cursor-pointer flex-col justify-center rounded-3xl border-2 border-black bg-white p-12 text-center transition-all duration-300 hover:scale-105 hover:bg-gray-100"
          >

            <h2 className="mb-4 text-4xl font-bold text-black">
              Member Area
            </h2>
            <p className="text-xl text-black">
              Access your account and member benefits
            </p>
          </button>

        </div>
      </main>

      {/* Footer */}
      <footer className="bg-black p-6 text-center">
        <p className="text-lg text-white">
          Need help? Please ask a staff member
        </p>
      </footer>
    </div>
  );
}

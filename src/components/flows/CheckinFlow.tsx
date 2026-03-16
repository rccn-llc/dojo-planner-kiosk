'use client';

import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useState } from 'react';
import { useCheckinMachine } from '../../hooks/useKioskMachines';
import { formatPhoneForDisplay, sanitizePhoneInput } from '../../shared/utils';

interface CheckinFlowProps {
  onComplete: () => void;
  onBack: () => void;
}

export function CheckinFlow({ onComplete, onBack }: CheckinFlowProps) {
  const [state, send] = useCheckinMachine();
  const [phoneInput, setPhoneInput] = useState('');

  const handlePhoneSubmit = () => {
    const cleaned = sanitizePhoneInput(phoneInput);
    send({ type: 'ENTER_PHONE', phoneNumber: cleaned });
  };

  const handlePhoneChange = (value: string) => {
    // Only allow numeric input
    const cleaned = sanitizePhoneInput(value);
    if (cleaned.length <= 10) {
      setPhoneInput(formatPhoneForDisplay(cleaned));
    }
  };

  // Auto-complete after successful check-in
  if (state.matches('checkinComplete')) {
    setTimeout(onComplete, 5000);
  }

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <header className="bg-black p-8 flex justify-between items-center">
        <button
          onClick={onBack}
          className="text-white hover:text-gray-300 transition-colors cursor-pointer"
        >
          <ArrowBackIcon sx={{ fontSize: 48 }} />
        </button>
        <h1 className="text-5xl font-bold text-white text-center flex-1">
          Member Check-in
        </h1>
        <div className="w-12" />
        {' '}
        {/* Spacer */}
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-2xl w-full">

          {/* Phone Input State */}
          {state.matches('idle') && (
            <div className="bg-white border-2 border-black rounded-3xl p-12 text-center">

              <h2 className="text-4xl font-bold text-black mb-6">
                Enter Your Phone Number
              </h2>
              <p className="text-xl text-black mb-8">
                We'll look up your membership information
              </p>

              <div className="space-y-6">
                <input
                  type="tel"
                  value={phoneInput}
                  onChange={e => handlePhoneChange(e.target.value)}
                  placeholder="(555) 123-4567"
                  className="w-full text-3xl p-6 bg-white border-2 border-gray-300 rounded-2xl text-black placeholder-gray-500 text-center focus:outline-none focus:ring-4 focus:ring-blue-500 focus:border-blue-500"
                  autoFocus
                />

                <button
                  onClick={handlePhoneSubmit}
                  disabled={sanitizePhoneInput(phoneInput).length !== 10}
                  className="w-full bg-white border-2 border-black hover:bg-gray-100 disabled:bg-gray-200 disabled:cursor-not-allowed text-black text-2xl font-bold py-6 px-8 rounded-2xl transition-colors min-h-20 cursor-pointer"
                >
                  Check In
                </button>
              </div>
            </div>
          )}

          {/* Loading State */}
          {state.matches('validatingPhone') && (
            <div className="bg-white border-2 border-black rounded-3xl p-12 text-center">

              <h2 className="text-4xl font-bold text-black mb-6">
                Looking up your information...
              </h2>
            </div>
          )}

          {/* Member Found State */}
          {state.matches('memberFound') && state.context.member && (
            <div className="bg-white border-2 border-black rounded-3xl p-12 text-center">

              <h2 className="text-4xl font-bold text-black mb-6">
                Welcome back,
                {' '}
                {state.context.member.firstName}
                !
              </h2>
              <p className="text-xl text-black mb-8">
                Tap below to confirm your check-in
              </p>

              <button
                onClick={() => send({ type: 'CONFIRM_CHECKIN' })}
                className="w-full bg-white border-2 border-black hover:bg-gray-100 text-black text-2xl font-bold py-6 px-8 rounded-2xl transition-colors min-h-20 cursor-pointer"
              >
                Confirm Check-in
              </button>
            </div>
          )}

          {/* Processing Check-in State */}
          {state.matches('processingCheckin') && (
            <div className="bg-white border-2 border-black rounded-3xl p-12 text-center">

              <h2 className="text-4xl font-bold text-black mb-6">
                Processing your check-in...
              </h2>
            </div>
          )}

          {/* Success State */}
          {state.matches('checkinComplete') && (
            <div className="bg-white border-2 border-black rounded-3xl p-12 text-center">

              <div className="mb-8">
                <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <div className="text-5xl text-green-600">
                    ✓
                  </div>
                </div>
                <h2 className="text-4xl font-bold text-black mb-6">
                  You're checked in!
                </h2>
                <p className="text-xl text-black mb-4">
                  Have a great class!
                </p>
              </div>

              <p className="text-lg text-gray-600">
                Returning to home screen...
              </p>
            </div>
          )}

          {/* Member Info Collection State */}
          {state.matches('collectingUpgradeInfo') && (
            <div className="bg-white border-2 border-black rounded-3xl p-12">

              <h2 className="text-4xl font-bold text-black mb-6 text-center">
                Complete Your Membership
              </h2>
              <p className="text-xl text-black mb-8 text-center">
                Please provide your information to complete the upgrade
              </p>

              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <input
                    type="text"
                    placeholder="First Name"
                    value={state.context.upgradeFirstName || ''}
                    onChange={e => send({ type: 'UPDATE_INFO', firstName: e.target.value })}
                    className="w-full text-2xl p-4 bg-white border-2 border-gray-300 rounded-2xl text-black placeholder-gray-500 focus:outline-none focus:ring-4 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <input
                    type="text"
                    placeholder="Last Name"
                    value={state.context.upgradeLastName || ''}
                    onChange={e => send({ type: 'UPDATE_INFO', lastName: e.target.value })}
                    className="w-full text-2xl p-4 bg-white border-2 border-gray-300 rounded-2xl text-black placeholder-gray-500 focus:outline-none focus:ring-4 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <input
                  type="email"
                  placeholder="Email Address"
                  value={state.context.upgradeEmail || ''}
                  onChange={e => send({ type: 'UPDATE_INFO', email: e.target.value })}
                  className="w-full text-2xl p-4 bg-white border-2 border-gray-300 rounded-2xl text-black placeholder-gray-500 focus:outline-none focus:ring-4 focus:ring-blue-500 focus:border-blue-500"
                />

                <input
                  type="tel"
                  placeholder="Phone Number"
                  value={state.context.upgradePhoneNumber || ''}
                  onChange={e => send({ type: 'UPDATE_INFO', phoneNumber: e.target.value })}
                  className="w-full text-2xl p-4 bg-white border-2 border-gray-300 rounded-2xl text-black placeholder-gray-500 focus:outline-none focus:ring-4 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div className="space-y-4 mt-8">
                <button
                  onClick={() => send({ type: 'SUBMIT_UPGRADE' })}
                  className="w-full bg-white border-2 border-black hover:bg-gray-100 text-black text-2xl font-bold py-6 px-8 rounded-2xl transition-colors min-h-20"
                >
                  Complete Membership Upgrade
                </button>

                <button
                  onClick={() => send({ type: 'BACK' })}
                  className="w-full bg-white border-2 border-gray-400 hover:bg-gray-100 text-black text-xl py-4 px-8 rounded-2xl transition-colors"
                >
                  Back to Review
                </button>
              </div>
            </div>
          )}

          {/* Processing Upgrade State */}
          {state.matches('processingUpgrade') && (
            <div className="bg-white border-2 border-black rounded-3xl p-12 text-center">

              <h2 className="text-4xl font-bold text-black mb-6">
                Processing Your Upgrade...
              </h2>
            </div>
          )}

          {/* Upgrade Complete State */}
          {state.matches('upgradeComplete') && (
            <div className="bg-white border-2 border-black rounded-3xl p-12 text-center">

              <div className="mb-8">
                <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <div className="text-5xl text-green-600">
                    ✓
                  </div>
                </div>
                <h2 className="text-4xl font-bold text-black mb-6">
                  Membership Upgraded!
                </h2>
                <p className="text-xl text-black mb-4">
                  Welcome to your new membership plan!
                </p>
                <p className="text-lg text-gray-600">
                  You'll receive a confirmation email shortly.
                </p>
              </div>

              <p className="text-lg text-gray-600">
                Returning to home screen...
              </p>
            </div>
          )}

          {/* Error State */}
          {state.matches('error') && (
            <div className="bg-white border-2 border-black rounded-3xl p-12 text-center">

              <h2 className="text-4xl font-bold text-black mb-6">
                Member Not Found
              </h2>
              <p className="text-xl text-red-600 mb-8">
                {state.context.errors.phone || 'Please check your phone number or ask a staff member for help.'}
              </p>

              <div className="space-y-4">
                <button
                  onClick={() => send({ type: 'TRY_AGAIN' })}
                  className="w-full bg-white border-2 border-black hover:bg-gray-100 text-black text-2xl font-bold py-6 px-8 rounded-2xl transition-colors min-h-20 cursor-pointer"
                >
                  Try Again
                </button>

                <button
                  onClick={onBack}
                  className="w-full bg-white border-2 border-gray-400 hover:bg-gray-100 text-black text-xl py-4 px-8 rounded-2xl transition-colors cursor-pointer"
                >
                  Back to Home
                </button>
              </div>
            </div>
          )}

          {/* Timeout State */}
          {state.matches('timeout') && (
            <div className="bg-white border-2 border-black rounded-3xl p-12 text-center">

              <h2 className="text-4xl font-bold text-black mb-6">
                Session Timeout
              </h2>
              <p className="text-xl text-orange-600 mb-8">
                Returning to home screen for security...
              </p>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}

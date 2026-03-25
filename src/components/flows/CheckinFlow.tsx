'use client';

import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useState } from 'react';
import { useCheckinMachine } from '../../hooks/useKioskMachines';
import { formatPhoneForDisplay, sanitizePhoneInput } from '../../lib/utils';

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
    <div className="flex min-h-screen flex-col bg-white">
      {/* Header */}
      <header className="flex items-center justify-between bg-black p-4 sm:p-6 md:p-8">
        <button
          type="button"
          onClick={onBack}
          className="cursor-pointer text-white transition-colors hover:text-gray-300"
        >
          <ArrowBackIcon sx={{ fontSize: 48 }} />
        </button>
        <h1 className="flex-1 text-center text-2xl font-bold text-white sm:text-3xl md:text-5xl">
          Member Check-in
        </h1>
        <div className="w-12" />
        {' '}
        {/* Spacer */}
      </header>

      {/* Main Content */}
      <main className="flex flex-1 items-center justify-center p-4 sm:p-6 md:p-8">
        <div className="w-full max-w-2xl">

          {/* Phone Input State */}
          {state.matches('idle') && (
            <div className="rounded-3xl border-2 border-black bg-white p-6 text-center sm:p-8 md:p-12">

              <h2 className="mb-6 text-2xl font-bold text-black sm:text-3xl md:text-4xl">
                Enter Your Phone Number
              </h2>
              <p className="mb-8 text-xl text-black">
                We'll look up your membership information
              </p>

              <div className="space-y-6">
                <input
                  type="tel"
                  value={phoneInput}
                  onChange={e => handlePhoneChange(e.target.value)}
                  placeholder="(555) 123-4567"
                  className="w-full rounded-2xl border-2 border-gray-300 bg-white p-4 text-center text-xl text-black placeholder:text-gray-500 focus:border-blue-500 focus:ring-4 focus:ring-blue-500 focus:outline-none sm:p-5 sm:text-2xl md:p-6 md:text-3xl"
                />

                <button
                  type="button"
                  onClick={handlePhoneSubmit}
                  disabled={sanitizePhoneInput(phoneInput).length !== 10}
                  className="min-h-14 w-full cursor-pointer rounded-2xl border-2 border-black bg-white px-8 py-4 text-lg font-bold text-black transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:bg-gray-200 sm:min-h-16 sm:py-5 sm:text-xl md:min-h-20 md:py-6 md:text-2xl"
                >
                  Check In
                </button>
              </div>
            </div>
          )}

          {/* Loading State */}
          {state.matches('validatingPhone') && (
            <div className="rounded-3xl border-2 border-black bg-white p-6 text-center sm:p-8 md:p-12">

              <h2 className="mb-6 text-2xl font-bold text-black sm:text-3xl md:text-4xl">
                Looking up your information...
              </h2>
            </div>
          )}

          {/* Member Found State */}
          {state.matches('memberFound') && state.context.member && (
            <div className="rounded-3xl border-2 border-black bg-white p-6 text-center sm:p-8 md:p-12">

              <h2 className="mb-6 text-2xl font-bold text-black sm:text-3xl md:text-4xl">
                Welcome back,
                {' '}
                {state.context.member.firstName}
                !
              </h2>
              <p className="mb-8 text-xl text-black">
                Tap below to confirm your check-in
              </p>

              <button
                type="button"
                onClick={() => send({ type: 'CONFIRM_CHECKIN' })}
                className="min-h-14 w-full cursor-pointer rounded-2xl border-2 border-black bg-white px-8 py-4 text-lg font-bold text-black transition-colors hover:bg-gray-100 sm:min-h-16 sm:py-5 sm:text-xl md:min-h-20 md:py-6 md:text-2xl"
              >
                Confirm Check-in
              </button>
            </div>
          )}

          {/* Processing Check-in State */}
          {state.matches('processingCheckin') && (
            <div className="rounded-3xl border-2 border-black bg-white p-6 text-center sm:p-8 md:p-12">

              <h2 className="mb-6 text-2xl font-bold text-black sm:text-3xl md:text-4xl">
                Processing your check-in...
              </h2>
            </div>
          )}

          {/* Success State */}
          {state.matches('checkinComplete') && (
            <div className="rounded-3xl border-2 border-black bg-white p-6 text-center sm:p-8 md:p-12">

              <div className="mb-8">
                <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-green-100">
                  <div className="text-5xl text-green-600">
                    ✓
                  </div>
                </div>
                <h2 className="mb-6 text-2xl font-bold text-black sm:text-3xl md:text-4xl">
                  You're checked in!
                </h2>
                <p className="mb-4 text-xl text-black">
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
            <div className="rounded-3xl border-2 border-black bg-white p-6 sm:p-8 md:p-12">

              <h2 className="mb-6 text-center text-2xl font-bold text-black sm:text-3xl md:text-4xl">
                Complete Your Membership
              </h2>
              <p className="mb-8 text-center text-xl text-black">
                Please provide your information to complete the upgrade
              </p>

              <div className="space-y-6">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <input
                    type="text"
                    placeholder="First Name"
                    value={state.context.upgradeFirstName || ''}
                    onChange={e => send({ type: 'UPDATE_INFO', firstName: e.target.value })}
                    className="w-full rounded-2xl border-2 border-gray-300 bg-white p-4 text-2xl text-black placeholder:text-gray-500 focus:border-blue-500 focus:ring-4 focus:ring-blue-500 focus:outline-none"
                  />
                  <input
                    type="text"
                    placeholder="Last Name"
                    value={state.context.upgradeLastName || ''}
                    onChange={e => send({ type: 'UPDATE_INFO', lastName: e.target.value })}
                    className="w-full rounded-2xl border-2 border-gray-300 bg-white p-4 text-2xl text-black placeholder:text-gray-500 focus:border-blue-500 focus:ring-4 focus:ring-blue-500 focus:outline-none"
                  />
                </div>

                <input
                  type="email"
                  placeholder="Email Address"
                  value={state.context.upgradeEmail || ''}
                  onChange={e => send({ type: 'UPDATE_INFO', email: e.target.value })}
                  className="w-full rounded-2xl border-2 border-gray-300 bg-white p-4 text-2xl text-black placeholder:text-gray-500 focus:border-blue-500 focus:ring-4 focus:ring-blue-500 focus:outline-none"
                />

                <input
                  type="tel"
                  placeholder="Phone Number"
                  value={state.context.upgradePhoneNumber || ''}
                  onChange={e => send({ type: 'UPDATE_INFO', phoneNumber: e.target.value })}
                  className="w-full rounded-2xl border-2 border-gray-300 bg-white p-4 text-2xl text-black placeholder:text-gray-500 focus:border-blue-500 focus:ring-4 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div className="mt-8 space-y-4">
                <button
                  type="button"
                  onClick={() => send({ type: 'SUBMIT_UPGRADE' })}
                  className="min-h-14 w-full rounded-2xl border-2 border-black bg-white px-8 py-4 text-lg font-bold text-black transition-colors hover:bg-gray-100 sm:min-h-16 sm:py-5 sm:text-xl md:min-h-20 md:py-6 md:text-2xl"
                >
                  Complete Membership Upgrade
                </button>

                <button
                  type="button"
                  onClick={() => send({ type: 'BACK' })}
                  className="w-full rounded-2xl border-2 border-gray-400 bg-white px-8 py-4 text-xl text-black transition-colors hover:bg-gray-100"
                >
                  Back to Review
                </button>
              </div>
            </div>
          )}

          {/* Processing Upgrade State */}
          {state.matches('processingUpgrade') && (
            <div className="rounded-3xl border-2 border-black bg-white p-6 text-center sm:p-8 md:p-12">

              <h2 className="mb-6 text-2xl font-bold text-black sm:text-3xl md:text-4xl">
                Processing Your Upgrade...
              </h2>
            </div>
          )}

          {/* Upgrade Complete State */}
          {state.matches('upgradeComplete') && (
            <div className="rounded-3xl border-2 border-black bg-white p-6 text-center sm:p-8 md:p-12">

              <div className="mb-8">
                <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-green-100">
                  <div className="text-5xl text-green-600">
                    ✓
                  </div>
                </div>
                <h2 className="mb-6 text-2xl font-bold text-black sm:text-3xl md:text-4xl">
                  Membership Upgraded!
                </h2>
                <p className="mb-4 text-xl text-black">
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
            <div className="rounded-3xl border-2 border-black bg-white p-6 text-center sm:p-8 md:p-12">

              <h2 className="mb-6 text-2xl font-bold text-black sm:text-3xl md:text-4xl">
                Member Not Found
              </h2>
              <p className="mb-8 text-xl text-red-600">
                {state.context.errors.phone || 'Please check your phone number or ask a staff member for help.'}
              </p>

              <div className="space-y-4">
                <button
                  type="button"
                  onClick={() => send({ type: 'TRY_AGAIN' })}
                  className="min-h-14 w-full cursor-pointer rounded-2xl border-2 border-black bg-white px-8 py-4 text-lg font-bold text-black transition-colors hover:bg-gray-100 sm:min-h-16 sm:py-5 sm:text-xl md:min-h-20 md:py-6 md:text-2xl"
                >
                  Try Again
                </button>

                <button
                  type="button"
                  onClick={onBack}
                  className="w-full cursor-pointer rounded-2xl border-2 border-gray-400 bg-white px-8 py-4 text-xl text-black transition-colors hover:bg-gray-100"
                >
                  Back to Home
                </button>
              </div>
            </div>
          )}

          {/* Timeout State */}
          {state.matches('timeout') && (
            <div className="rounded-3xl border-2 border-black bg-white p-6 text-center sm:p-8 md:p-12">

              <h2 className="mb-6 text-2xl font-bold text-black sm:text-3xl md:text-4xl">
                Session Timeout
              </h2>
              <p className="mb-8 text-xl text-orange-600">
                Returning to home screen for security...
              </p>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}

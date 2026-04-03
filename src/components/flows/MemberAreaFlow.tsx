'use client';

import { useState } from 'react';
import { useMemberAreaMachine } from '../../hooks/useKioskMachines';
import { formatPhoneForDisplay, sanitizePhoneInput } from '../../lib/utils';
import { KioskFlowHeader } from '../KioskFlowHeader';

interface MemberAreaFlowProps {
  onComplete: () => void;
  onBack: () => void;
}

export function MemberAreaFlow({ onBack }: MemberAreaFlowProps) {
  const [state, send] = useMemberAreaMachine();
  const [phoneInput, setPhoneInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');

  const handlePhoneChange = (value: string) => {
    const cleaned = sanitizePhoneInput(value);
    if (cleaned.length <= 10) {
      setPhoneInput(formatPhoneForDisplay(cleaned));
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <KioskFlowHeader title="Member Area" onBack={onBack} />

      {/* Main Content */}
      <main className="flex flex-1 items-center justify-center p-4 sm:p-6 md:p-8">
        <div className="w-full max-w-4xl">

          {/* Member Login State */}
          {state.matches('selectingProgram') && (
            <div className="rounded-3xl border-2 border-black bg-white p-6 sm:p-8 md:p-12">
              <h2 className="mb-2 text-center text-2xl font-bold text-black sm:text-3xl md:text-4xl">
                Member Login
              </h2>
              <p className="mb-8 text-center text-xl text-gray-600">
                Please enter your details
              </p>

              <div className="space-y-6">
                <div>
                  <label className="mb-2 block text-lg font-medium text-black" htmlFor="phone-input">Phone Number</label>
                  <input
                    id="phone-input"
                    type="tel"
                    value={phoneInput}
                    onChange={e => handlePhoneChange(e.target.value)}
                    placeholder="(555) 123-4567"
                    autoComplete="tel"
                    className="w-full rounded-2xl border-2 border-gray-300 bg-white p-4 text-xl text-black placeholder:text-gray-500 focus:border-blue-500 focus:ring-4 focus:ring-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-lg font-medium text-black" htmlFor="password-input">Password</label>
                  <input
                    id="password-input"
                    type="password"
                    value={passwordInput}
                    onChange={e => setPasswordInput(e.target.value)}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    className="w-full rounded-2xl border-2 border-gray-300 bg-white p-4 text-xl text-black placeholder:text-gray-500 focus:border-blue-500 focus:ring-4 focus:ring-blue-500 focus:outline-none"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => send({ type: 'SELECT_PROGRAM', program: { id: 'login', name: 'Login', description: 'Member Login', price: 0, isActive: true } })}
                  disabled={sanitizePhoneInput(phoneInput).length !== 10 || !passwordInput}
                  className="min-h-16 w-full cursor-pointer rounded-2xl bg-black px-8 py-4 text-lg font-bold text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-400 sm:text-xl md:text-2xl"
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* Member Dashboard */}
          {state.matches('selectingPlan') && (
            <div className="mx-auto max-w-6xl rounded-3xl bg-white p-4 sm:p-6 md:p-8">
              <div className="mb-6 flex items-center justify-between">
                <h2 className="text-2xl font-bold text-black sm:text-3xl md:text-4xl">John Smith</h2>
                <button
                  type="button"
                  onClick={onBack}
                  className="cursor-pointer rounded-lg bg-red-600 px-8 py-3 text-lg font-bold text-white transition-colors hover:bg-red-700"
                >
                  Logout
                </button>
              </div>

              {/* Tabs */}
              <div className="mb-8 flex border-b-2 border-gray-200">
                <button type="button" className="cursor-pointer border-b-4 border-black px-3 py-2 text-lg font-bold text-black sm:px-4 sm:py-3 md:px-6">
                  Account
                </button>
                <button type="button" className="cursor-pointer px-3 py-2 text-lg font-medium text-gray-500 hover:text-black sm:px-4 sm:py-3 md:px-6">
                  Billing
                </button>
              </div>

              {/* Family Members & Memberships */}
              <div>
                <h3 className="mb-6 text-xl font-bold text-black sm:text-2xl">Family Members & Memberships</h3>

                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                  {/* John Smith's Membership */}
                  <div className="rounded-xl border-2 border-gray-200 bg-white p-6">
                    <div className="mb-4 flex items-start justify-between">
                      <h4 className="text-xl font-bold text-black">John Smith</h4>
                      <span className="rounded bg-green-100 px-3 py-1 text-sm font-semibold text-green-700">Active</span>
                    </div>

                    <div className="mb-6 space-y-2">
                      <div className="flex justify-between text-gray-600">
                        <span>Membership</span>
                        <span className="font-medium text-black">12 Month - Adult BJJ</span>
                      </div>
                      <div className="flex justify-between text-gray-600">
                        <span>Next Billing</span>
                        <span className="font-medium text-black">Jan. 30, 2025</span>
                      </div>
                      <div className="flex justify-between text-gray-600">
                        <span>Amount</span>
                        <span className="font-medium text-black">$150.00</span>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <button type="button" className="flex-1 cursor-pointer rounded-lg border-2 border-gray-300 bg-white px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-gray-50">
                        View Waiver
                      </button>
                      <button type="button" className="flex-1 cursor-pointer rounded-lg border-2 border-gray-300 bg-white px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-gray-50">
                        Hold
                      </button>
                      <button type="button" className="flex-1 cursor-pointer rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700">
                        Cancel
                      </button>
                    </div>
                  </div>

                  {/* Emma Smith's Membership */}
                  <div className="rounded-xl border-2 border-gray-200 bg-white p-6">
                    <div className="mb-4 flex items-start justify-between">
                      <h4 className="text-xl font-bold text-black">Emma Smith</h4>
                      <span className="rounded bg-green-100 px-3 py-1 text-sm font-semibold text-green-700">Active</span>
                    </div>

                    <div className="mb-6 space-y-2">
                      <div className="flex justify-between text-gray-600">
                        <span>Membership</span>
                        <span className="font-medium text-black">Month to Month - Kids</span>
                      </div>
                      <div className="flex justify-between text-gray-600">
                        <span>Next Billing</span>
                        <span className="font-medium text-black">Jan. 30, 2025</span>
                      </div>
                      <div className="flex justify-between text-gray-600">
                        <span>Amount</span>
                        <span className="font-medium text-black">$95.00</span>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <button type="button" className="flex-1 cursor-pointer rounded-lg border-2 border-gray-300 bg-white px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-gray-50">
                        View Waiver
                      </button>
                      <button type="button" className="flex-1 cursor-pointer rounded-lg border-2 border-gray-300 bg-white px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-gray-50">
                        Hold
                      </button>
                      <button type="button" className="flex-1 cursor-pointer rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700">
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}

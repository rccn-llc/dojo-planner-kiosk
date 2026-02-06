'use client';

import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useState } from 'react';
import { useMemberAreaMachine } from '../../hooks/useKioskMachines';
import { formatPhoneForDisplay, sanitizePhoneInput } from '../../shared/utils';

interface MemberAreaFlowProps {
  onComplete: () => void;
  onBack: () => void;
}

export function MemberAreaFlow({ onComplete, onBack }: MemberAreaFlowProps) {
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
          Member Area
        </h1>
        <div className="w-12" />
        {' '}
        {/* Spacer */}
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-4xl w-full">

          {/* Member Login State */}
          {state.matches('selectingProgram') && (
            <div className="bg-white border-2 border-black rounded-3xl p-12">
              <h2 className="text-4xl font-bold text-black mb-2 text-center">
                Member Login
              </h2>
              <p className="text-xl text-gray-600 mb-8 text-center">
                Please enter your details
              </p>

              <div className="space-y-6">
                <div>
                  <label className="block text-lg font-medium text-black mb-2">Phone Number</label>
                  <input
                    type="tel"
                    value={phoneInput}
                    onChange={e => handlePhoneChange(e.target.value)}
                    placeholder="(555) 123-4567"
                    autoComplete="tel"
                    className="w-full text-xl p-4 bg-white border-2 border-gray-300 rounded-2xl text-black placeholder-gray-500 focus:outline-none focus:ring-4 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-lg font-medium text-black mb-2">Password</label>
                  <input
                    type="password"
                    value={passwordInput}
                    onChange={e => setPasswordInput(e.target.value)}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    className="w-full text-xl p-4 bg-white border-2 border-gray-300 rounded-2xl text-black placeholder-gray-500 focus:outline-none focus:ring-4 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <button
                  onClick={() => send({ type: 'SELECT_PROGRAM', program: { id: 'login', name: 'Login' } })}
                  disabled={sanitizePhoneInput(phoneInput).length !== 10 || !passwordInput}
                  className="w-full bg-black hover:bg-gray-800 disabled:bg-gray-400 disabled:cursor-not-allowed text-white text-2xl font-bold py-4 px-8 rounded-2xl transition-colors min-h-16 cursor-pointer"
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* Member Dashboard */}
          {state.matches('selectingPlan') && (
            <div className="bg-white rounded-3xl p-8 max-w-6xl mx-auto">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-4xl font-bold text-black">John Smith</h2>
                <button
                  onClick={onBack}
                  className="bg-red-600 hover:bg-red-700 text-white text-lg font-bold py-3 px-8 rounded-lg transition-colors cursor-pointer"
                >
                  Logout
                </button>
              </div>

              {/* Tabs */}
              <div className="flex border-b-2 border-gray-200 mb-8">
                <button className="px-6 py-3 text-lg font-bold text-black border-b-4 border-black cursor-pointer">
                  Account
                </button>
                <button className="px-6 py-3 text-lg font-medium text-gray-500 hover:text-black cursor-pointer">
                  Billing
                </button>
              </div>

              {/* Family Members & Memberships */}
              <div>
                <h3 className="text-2xl font-bold text-black mb-6">Family Members & Memberships</h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* John Smith's Membership */}
                  <div className="bg-white border-2 border-gray-200 rounded-xl p-6">
                    <div className="flex justify-between items-start mb-4">
                      <h4 className="text-xl font-bold text-black">John Smith</h4>
                      <span className="bg-green-100 text-green-700 text-sm font-semibold px-3 py-1 rounded">Active</span>
                    </div>

                    <div className="space-y-2 mb-6">
                      <div className="flex justify-between text-gray-600">
                        <span>Membership</span>
                        <span className="text-black font-medium">12 Month - Adult BJJ</span>
                      </div>
                      <div className="flex justify-between text-gray-600">
                        <span>Next Billing</span>
                        <span className="text-black font-medium">Jan. 30, 2025</span>
                      </div>
                      <div className="flex justify-between text-gray-600">
                        <span>Amount</span>
                        <span className="text-black font-medium">$150.00</span>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <button className="flex-1 bg-white border-2 border-gray-300 hover:bg-gray-50 text-black text-sm font-medium py-2 px-4 rounded-lg transition-colors cursor-pointer">
                        View Waiver
                      </button>
                      <button className="flex-1 bg-white border-2 border-gray-300 hover:bg-gray-50 text-black text-sm font-medium py-2 px-4 rounded-lg transition-colors cursor-pointer">
                        Hold
                      </button>
                      <button className="flex-1 bg-red-600 hover:bg-red-700 text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors cursor-pointer">
                        Cancel
                      </button>
                    </div>
                  </div>

                  {/* Emma Smith's Membership */}
                  <div className="bg-white border-2 border-gray-200 rounded-xl p-6">
                    <div className="flex justify-between items-start mb-4">
                      <h4 className="text-xl font-bold text-black">Emma Smith</h4>
                      <span className="bg-green-100 text-green-700 text-sm font-semibold px-3 py-1 rounded">Active</span>
                    </div>

                    <div className="space-y-2 mb-6">
                      <div className="flex justify-between text-gray-600">
                        <span>Membership</span>
                        <span className="text-black font-medium">Month to Month - Kids</span>
                      </div>
                      <div className="flex justify-between text-gray-600">
                        <span>Next Billing</span>
                        <span className="text-black font-medium">Jan. 30, 2025</span>
                      </div>
                      <div className="flex justify-between text-gray-600">
                        <span>Amount</span>
                        <span className="text-black font-medium">$95.00</span>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <button className="flex-1 bg-white border-2 border-gray-300 hover:bg-gray-50 text-black text-sm font-medium py-2 px-4 rounded-lg transition-colors cursor-pointer">
                        View Waiver
                      </button>
                      <button className="flex-1 bg-white border-2 border-gray-300 hover:bg-gray-50 text-black text-sm font-medium py-2 px-4 rounded-lg transition-colors cursor-pointer">
                        Hold
                      </button>
                      <button className="flex-1 bg-red-600 hover:bg-red-700 text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors cursor-pointer">
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

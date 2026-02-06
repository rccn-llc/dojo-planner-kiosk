'use client';

import type { Program } from '../../shared/types';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useTrialMachine } from '../../hooks/useKioskMachines';
import { formatPhoneForDisplay, sanitizePhoneInput } from '../../shared/utils';

interface TrialFlowProps {
  onComplete: () => void;
  onBack: () => void;
}

export function TrialFlow({ onComplete, onBack }: TrialFlowProps) {
  const [state, send] = useTrialMachine();

  const handleInputChange = (field: string, value: string) => {
    if (field === 'phoneNumber') {
      const cleaned = sanitizePhoneInput(value);
      if (cleaned.length <= 10) {
        send({ type: 'UPDATE_FIELD', field, value: formatPhoneForDisplay(cleaned) });
      }
    }
    else {
      send({ type: 'UPDATE_FIELD', field, value });
    }
  };

  const handleProgramSelect = (program: Program) => {
    send({ type: 'SELECT_PROGRAM', program });
  };

  // Auto-complete after successful trial creation
  if (state.matches('success')) {
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
          Free Trial Signup
        </h1>
        <div className="w-12" />
        {' '}
        {/* Spacer */}
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-4xl w-full">

          {/* Contact Information Form */}
          {(state.matches('idle') || state.matches('collectingInfo') || state.matches('validatingContact')) && (
            <div className="bg-white border-2 border-black rounded-3xl p-12">
              <div className="text-center mb-8">

                <h2 className="text-4xl font-bold text-black mb-4">
                  Tell us about yourself
                </h2>
                <p className="text-xl text-black">
                  We'll use this information to set up your free trial
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">

                {/* First Name */}
                <div>
                  <label className="block text-black text-xl mb-3" htmlFor="firstName">
                    First Name *
                  </label>
                  <input
                    id="firstName"
                    type="text"
                    value={state.context.firstName || ''}
                    onChange={e => handleInputChange('firstName', e.target.value)}
                    className={`w-full text-2xl p-4 bg-white border-2 rounded-xl text-black placeholder-gray-500 focus:outline-none focus:ring-4 focus:ring-blue-500 focus:border-blue-500 ${
                      state.context.errors?.firstName
                        ? 'border-red-400 focus:ring-red-500 focus:border-red-500'
                        : 'border-gray-300'
                    }`}
                    placeholder="John"
                  />
                  {state.context.errors?.firstName && (
                    <p className="text-red-600 text-lg mt-2">{state.context.errors?.firstName}</p>
                  )}
                </div>

                {/* Last Name */}
                <div>
                  <label className="block text-black text-xl mb-3" htmlFor="lastName">
                    Last Name *
                  </label>
                  <input
                    id="lastName"
                    type="text"
                    value={state.context.lastName || ''}
                    onChange={e => handleInputChange('lastName', e.target.value)}
                    className={`w-full text-2xl p-4 bg-white border-2 rounded-xl text-black placeholder-gray-500 focus:outline-none focus:ring-4 focus:ring-blue-500 focus:border-blue-500 ${
                      state.context.errors?.lastName
                        ? 'border-red-400 focus:ring-red-500 focus:border-red-500'
                        : 'border-gray-300'
                    }`}
                    placeholder="Doe"
                  />
                  {state.context.errors?.lastName && (
                    <p className="text-red-600 text-lg mt-2">{state.context.errors?.lastName}</p>
                  )}
                </div>

                {/* Email */}
                <div>
                  <label className="block text-black text-xl mb-3" htmlFor="email">
                    Email Address *
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={state.context.email || ''}
                    onChange={e => handleInputChange('email', e.target.value)}
                    className={`w-full text-2xl p-4 bg-white border-2 rounded-xl text-black placeholder-gray-500 focus:outline-none focus:ring-4 focus:ring-blue-500 focus:border-blue-500 ${
                      state.context.errors?.email
                        ? 'border-red-400 focus:ring-red-500 focus:border-red-500'
                        : 'border-gray-300'
                    }`}
                    placeholder="john@example.com"
                  />
                  {state.context.errors?.email && (
                    <p className="text-red-600 text-lg mt-2">{state.context.errors?.email}</p>
                  )}
                </div>

                {/* Phone Number */}
                <div>
                  <label className="block text-black text-xl mb-3" htmlFor="phoneNumber">
                    Phone Number *
                  </label>
                  <input
                    id="phoneNumber"
                    type="tel"
                    value={state.context.phoneNumber || ''}
                    onChange={e => handleInputChange('phoneNumber', e.target.value)}
                    className={`w-full text-2xl p-4 bg-white border-2 rounded-xl text-black placeholder-gray-500 focus:outline-none focus:ring-4 focus:ring-blue-500 focus:border-blue-500 ${
                      state.context.errors?.phoneNumber
                        ? 'border-red-400 focus:ring-red-500 focus:border-red-500'
                        : 'border-gray-300'
                    }`}
                    placeholder="(555) 123-4567"
                  />
                  {state.context.errors?.phoneNumber && (
                    <p className="text-red-600 text-lg mt-2">{state.context.errors?.phoneNumber}</p>
                  )}
                </div>

              </div>

              <div className="text-center mt-8">
                <button
                  onClick={() => send({ type: 'SUBMIT_CONTACT' })}
                  disabled={state.context.isSubmitting}
                  className="bg-white border-2 border-black hover:bg-gray-100 disabled:bg-gray-200 disabled:cursor-not-allowed text-black text-2xl font-bold py-6 px-12 rounded-2xl transition-colors min-h-20 min-w-64 cursor-pointer"
                >
                  {state.context.isSubmitting ? 'Validating...' : 'Continue'}
                </button>
              </div>
            </div>
          )}

          {/* Program Selection */}
          {state.matches('selectingProgram') && (
            <div className="bg-white border-2 border-black rounded-3xl p-12">
              <div className="text-center mb-8">

                <h2 className="text-4xl font-bold text-black mb-4">
                  Choose Your Program
                </h2>
                <p className="text-xl text-black">
                  Select which program you'd like to try
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto mb-8">
                {state.context.availablePrograms.map(program => (
                  <button
                    key={program.id}
                    onClick={() => handleProgramSelect(program)}
                    className={`p-8 rounded-2xl border-2 transition-all hover:scale-105 cursor-pointer ${
                      state.context.selectedProgram?.id === program.id
                        ? 'bg-gray-100 border-blue-500 ring-4 ring-blue-300'
                        : 'bg-white border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <h3 className="text-2xl font-bold text-black mb-4">{program.name}</h3>
                    <p className="text-lg text-black mb-6">{program.description}</p>
                    <div className="flex justify-between items-center">
                      <span className="text-xl text-gray-700">
                        {program.trialLength}
                        {' '}
                        day
                        {program.trialLength !== 1 ? 's' : ''}
                        {' '}
                        free
                      </span>
                      <span className="text-xl font-bold text-black">
                        $
                        {program.price}
                        /month after
                      </span>
                    </div>
                  </button>
                ))}
              </div>

              <div className="text-center">
                <button
                  onClick={() => send({ type: 'SUBMIT_TRIAL' })}
                  disabled={!state.context.selectedProgram}
                  className="bg-white border-2 border-black hover:bg-gray-100 disabled:bg-gray-200 disabled:cursor-not-allowed text-black text-2xl font-bold py-6 px-12 rounded-2xl transition-colors min-h-20 min-w-64 cursor-pointer"
                >
                  Start Free Trial
                </button>
              </div>
            </div>
          )}

          {/* Creating Trial State */}
          {state.matches('creatingTrial') && (
            <div className="bg-white border-2 border-black rounded-3xl p-12 text-center">

              <h2 className="text-4xl font-bold text-black mb-6">
                Setting up your free trial...
              </h2>
              <p className="text-xl text-black">
                This will just take a moment
              </p>
            </div>
          )}

          {/* Success State */}
          {state.matches('success') && (
            <div className="bg-white border-2 border-black rounded-3xl p-12 text-center">

              <h2 className="text-4xl font-bold text-black mb-6">
                Welcome to the Dojo!
              </h2>
              <p className="text-xl text-black mb-6">
                Your free trial has been activated. Check your email for next steps.
              </p>
              <p className="text-lg text-gray-600">
                Returning to home screen...
              </p>
            </div>
          )}

          {/* Error State */}
          {state.matches('error') && (
            <div className="bg-white border-2 border-black rounded-3xl p-12 text-center">

              <h2 className="text-4xl font-bold text-black mb-6">
                Something went wrong
              </h2>
              <p className="text-xl text-red-600 mb-8">
                {Object.values(state.context.errors).join(' ') || 'Please try again or ask a staff member for help.'}
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

'use client';

import type { MembershipPlan } from '../../shared/types';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import { useEffect, useState } from 'react';
import { useMembershipMachine } from '../../hooks/useKioskMachines';
import { formatPhoneForDisplay, sanitizePhoneInput } from '../../shared/utils';

const US_STATES = [
  'AL',
  'AK',
  'AZ',
  'AR',
  'CA',
  'CO',
  'CT',
  'DE',
  'FL',
  'GA',
  'HI',
  'ID',
  'IL',
  'IN',
  'IA',
  'KS',
  'KY',
  'LA',
  'ME',
  'MD',
  'MA',
  'MI',
  'MN',
  'MS',
  'MO',
  'MT',
  'NE',
  'NV',
  'NH',
  'NJ',
  'NM',
  'NY',
  'NC',
  'ND',
  'OH',
  'OK',
  'OR',
  'PA',
  'RI',
  'SC',
  'SD',
  'TN',
  'TX',
  'UT',
  'VT',
  'VA',
  'WA',
  'WV',
  'WI',
  'WY',
];

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="mt-8 flex justify-center gap-2">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`h-2 w-8 rounded-full transition-colors ${i <= current ? 'bg-black' : 'bg-gray-300'}`}
        />
      ))}
    </div>
  );
}

function formatPlanPrice(plan: MembershipPlan): string {
  const formatted = plan.price.toLocaleString();
  return plan.interval === 'yearly' ? `$${formatted}/yr` : `$${formatted}/mo`;
}

function nextBillingDate(plan: MembershipPlan): string {
  const d = new Date();
  if (plan.interval === 'yearly') {
    d.setFullYear(d.getFullYear() + 1);
  }
  else {
    d.setMonth(d.getMonth() + 1);
  }
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

interface MembershipFlowProps {
  onComplete: () => void;
  onBack: () => void;
  onCheckIn?: () => void;
}

export function MembershipFlow({ onComplete, onBack, onCheckIn }: MembershipFlowProps) {
  const [state, send] = useMembershipMachine();
  const [planPage, setPlanPage] = useState(0);

  const PLANS_PER_PAGE = 2;
  const totalPlanPages = Math.ceil((state.context.availablePlans?.length ?? 0) / PLANS_PER_PAGE);
  const visiblePlans = state.context.availablePlans.slice(
    planPage * PLANS_PER_PAGE,
    (planPage + 1) * PLANS_PER_PAGE,
  );

  // Reset plan page when plans change
  useEffect(() => {
    setPlanPage(0);
  }, [state.context.selectedProgram]);

  // Auto-advance after success
  useEffect(() => {
    if (state.matches('success')) {
      const timer = setTimeout(onComplete, 15000);
      return () => clearTimeout(timer);
    }
    return undefined;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.value, onComplete]);

  const handleInputChange = (field: string, value: string | boolean) => {
    if ((field === 'phoneNumber' || field === 'memberLookupPhone') && typeof value === 'string') {
      const cleaned = sanitizePhoneInput(value);
      if (cleaned.length <= 10) {
        send({ type: 'UPDATE_FIELD', field, value: formatPhoneForDisplay(cleaned) });
      }
    }
    else {
      send({ type: 'UPDATE_FIELD', field, value });
    }
  };

  const labelClass = 'block text-lg font-semibold text-black mb-2';
  const inputClass = (field: string) =>
    `w-full text-xl p-4 bg-white border-2 rounded-xl text-black placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-black ${
      state.context.errors?.[field] ? 'border-red-400 focus:ring-red-500' : 'border-gray-300'
    }`;

  const headerTitle = () => {
    if (state.matches('selectingProgram')) {
      return 'Select Your Program';
    }
    if (state.matches('selectingPlan')) {
      return 'Select Your Membership Plan';
    }
    if (state.matches('reviewingCommitment')) {
      return state.context.selectedPlan?.name ?? 'Review Commitment';
    }
    if (state.matches('collectingInfo') || state.matches('validatingContact') || state.matches('lookingUpMember')) {
      return 'Complete Your Membership';
    }
    if (state.matches('processingPayment') || state.matches('creatingMembership')) {
      return 'Processing…';
    }
    if (state.matches('success')) {
      return 'Enrollment Successful!';
    }
    if (state.matches('paymentFailed')) {
      return 'Payment Failed';
    }
    if (state.matches('error')) {
      return 'Something Went Wrong';
    }
    if (state.matches('timeout')) {
      return 'Session Timeout';
    }
    return 'Membership';
  };

  return (
    <div className="flex min-h-screen flex-col bg-white">
      {/* Header */}
      <header className="flex items-center justify-between bg-black p-8">
        <button onClick={onBack} className="cursor-pointer text-white transition-colors hover:text-gray-300">
          <ArrowBackIcon sx={{ fontSize: 48 }} />
        </button>
        <h1 className="flex-1 text-center text-5xl font-bold text-white">{headerTitle()}</h1>
        <div className="w-12" />
      </header>

      {/* Main content */}
      <main className="flex flex-1 items-start justify-center p-8">

        {/* ── Step 1: Program selection ───────────────────────────────────────── */}
        {state.matches('selectingProgram') && (
          <div className="w-full max-w-4xl">
            <p className="mb-8 text-center text-xl text-gray-500">Choose the program you'd like to join</p>
            <div className="grid grid-cols-2 gap-6">
              {state.context.programs.map(program => (
                <button
                  key={program.id}
                  onClick={() => send({ type: 'SELECT_PROGRAM', program })}
                  className="cursor-pointer rounded-3xl border-2 border-black bg-white p-10 text-left transition-all hover:scale-105 hover:bg-gray-50"
                >
                  <h2 className="text-3xl font-bold text-black">{program.name}</h2>
                  <p className="mt-3 text-lg text-gray-500">{program.description}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Step 2: Plan selection ──────────────────────────────────────────── */}
        {state.matches('selectingPlan') && (
          <div className="w-full max-w-4xl">
            <p className="mb-6 text-center text-xl text-gray-500">Choose a plan that's right for you</p>

            <div className="mb-4 grid grid-cols-2 gap-6">
              {visiblePlans.map(plan => (
                <button
                  key={plan.id}
                  onClick={() => send({ type: 'SELECT_PLAN', plan })}
                  className={`cursor-pointer rounded-3xl border-2 p-8 text-left transition-all hover:scale-105 ${
                    state.context.selectedPlan?.id === plan.id
                      ? 'border-black bg-gray-100 ring-2 ring-black'
                      : 'border-gray-300 bg-white hover:bg-gray-50'
                  }`}
                >
                  <h3 className="mb-1 text-2xl font-bold text-black">{plan.name}</h3>
                  <p className="mb-4 text-3xl font-bold text-black">{formatPlanPrice(plan)}</p>
                  {plan.description.split('\n').map((line, i) => (
                    <p key={i} className={`${i === 0 ? 'mb-2 text-base text-gray-500' : 'text-base text-gray-600'}`}>{line}</p>
                  ))}
                </button>
              ))}
            </div>

            {/* Pagination */}
            {totalPlanPages > 1 && (
              <div className="mb-4 flex items-center justify-center gap-6">
                <button
                  onClick={() => setPlanPage(p => Math.max(0, p - 1))}
                  disabled={planPage === 0}
                  className="cursor-pointer rounded-xl border-2 border-black px-6 py-3 text-lg font-bold disabled:opacity-30"
                >
                  ← Prev
                </button>
                <span className="text-gray-500">
                  {planPage + 1}
                  {' '}
                  /
                  {' '}
                  {totalPlanPages}
                </span>
                <button
                  onClick={() => setPlanPage(p => Math.min(totalPlanPages - 1, p + 1))}
                  disabled={planPage === totalPlanPages - 1}
                  className="cursor-pointer rounded-xl border-2 border-black px-6 py-3 text-lg font-bold disabled:opacity-30"
                >
                  Next →
                </button>
              </div>
            )}

            <div className="flex items-center justify-between">
              <button
                onClick={() => send({ type: 'BACK' })}
                className="flex cursor-pointer items-center gap-2 text-xl text-gray-600 transition-colors hover:text-black"
              >
                <ArrowBackIcon sx={{ fontSize: 24 }} />
                {' '}
                Go back
              </button>
              <button
                onClick={() => send({ type: 'SUBMIT_PAYMENT' })}
                disabled={!state.context.selectedPlan}
                className="cursor-pointer rounded-2xl border-2 border-black bg-white px-12 py-4 text-xl font-bold text-black transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:bg-gray-200"
              >
                Next →
              </button>
            </div>
            <StepIndicator current={0} total={3} />
          </div>
        )}

        {/* ── Step 3: Commitment / waiver ─────────────────────────────────────── */}
        {state.matches('reviewingCommitment') && (
          <div className="w-full max-w-3xl">
            {state.context.selectedProgram && state.context.selectedPlan && (
              <div className="mb-6 flex items-center justify-between rounded-2xl border border-gray-200 bg-gray-50 p-5">
                <div>
                  <p className="text-lg font-semibold text-black">{state.context.selectedProgram.name}</p>
                  <p className="text-gray-500">{state.context.selectedPlan.name}</p>
                </div>
                <p className="text-2xl font-bold text-black">{formatPlanPrice(state.context.selectedPlan)}</p>
              </div>
            )}

            <div className="mb-2">
              <p className="mb-2 text-xl font-semibold text-black">Membership Description</p>
              <div className="h-52 overflow-y-auto rounded-2xl border border-gray-200 bg-gray-50 p-5 text-lg leading-relaxed text-gray-700">
                <p className="mb-2 font-semibold">Membership Agreement</p>
                <p className="mb-3">By joining, you agree to the following terms and conditions. This membership grants access to all regularly scheduled classes for the program selected above.</p>
                <p className="mb-2 font-semibold">Cancellation Policy</p>
                <p className="mb-3">Month-to-month memberships may be cancelled with 30 days written notice. Commitment plans (6-month, 12-month) require full payment for the committed term and may not be cancelled early except for documented medical reasons.</p>
                <p className="mb-2 font-semibold">Hold Policy</p>
                <p className="mb-3">Members may place their account on hold for up to 60 days per calendar year for medical or military reasons with appropriate documentation.</p>
                <p>You understand and agree that martial arts training involves physical contact and risk of injury. The dojo and its instructors are not liable for injuries sustained during training when proper safety protocols are followed.</p>
              </div>
              <p className="mt-2 text-right text-sm text-gray-400">Scroll to read full agreement</p>
            </div>

            <label className="mt-4 flex cursor-pointer items-start gap-4 rounded-2xl border-2 border-gray-200 p-5 hover:bg-gray-50">
              <input
                type="checkbox"
                checked={!!state.context.hasAgreedToCommitment}
                onChange={e => handleInputChange('hasAgreedToCommitment', e.target.checked)}
                className="mt-1 h-6 w-6 shrink-0 cursor-pointer accent-black"
              />
              <span className="text-lg text-black">
                I agree to the terms of the membership agreement above and authorize recurring billing as described.
              </span>
            </label>

            <div className="mt-6 flex items-center justify-between">
              <button
                onClick={() => send({ type: 'BACK' })}
                className="flex cursor-pointer items-center gap-2 text-xl text-gray-600 transition-colors hover:text-black"
              >
                <ArrowBackIcon sx={{ fontSize: 24 }} />
                {' '}
                Go back
              </button>
              <button
                onClick={() => send({ type: 'SUBMIT_COMMITMENT' })}
                disabled={!state.context.hasAgreedToCommitment}
                className="cursor-pointer rounded-2xl border-2 border-black bg-white px-12 py-4 text-xl font-bold text-black transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:bg-gray-200"
              >
                Next →
              </button>
            </div>
            <StepIndicator current={1} total={3} />
          </div>
        )}

        {/* ── Step 4: Member info + order summary ─────────────────────────────── */}
        {(state.matches('collectingInfo') || state.matches('validatingContact') || state.matches('lookingUpMember')) && (
          <div className="w-full max-w-6xl">
            <div className="grid grid-cols-5 gap-8">

              {/* Left: form */}
              <div className="col-span-3">
                {/* Member lookup */}
                <div className="mb-8 rounded-2xl border border-gray-200 bg-gray-50 p-5">
                  <p className="mb-3 text-base font-semibold tracking-wide text-gray-500 uppercase">
                    Already a member or have a trial?
                  </p>
                  <div className="flex gap-3">
                    <input
                      type="tel"
                      value={state.context.memberLookupPhone || ''}
                      onChange={e => handleInputChange('memberLookupPhone', e.target.value)}
                      placeholder="Phone number"
                      className="flex-1 rounded-xl border-2 border-gray-300 p-4 text-xl focus:border-black focus:outline-none"
                    />
                    <button
                      onClick={() => send({ type: 'LOOKUP_MEMBER' })}
                      disabled={state.matches('lookingUpMember') || !(state.context.memberLookupPhone?.replace(/\D/g, '').length >= 10)}
                      className="cursor-pointer rounded-xl border-2 border-black bg-black px-6 py-4 text-base font-bold text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {state.matches('lookingUpMember') ? 'Looking up…' : 'Look Up'}
                    </button>
                  </div>
                </div>

                {/* Member info form */}
                <p className="mb-4 text-lg font-semibold text-black">Member Information</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelClass} htmlFor="firstName">
                      First Name
                      <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="firstName"
                      type="text"
                      value={state.context.firstName || ''}
                      onChange={e => handleInputChange('firstName', e.target.value)}
                      className={inputClass('firstName')}
                      placeholder="First name"
                    />
                    {state.context.errors?.firstName && <p className="mt-1 text-base text-red-600">{state.context.errors.firstName}</p>}
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="lastName">
                      Last Name
                      <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="lastName"
                      type="text"
                      value={state.context.lastName || ''}
                      onChange={e => handleInputChange('lastName', e.target.value)}
                      className={inputClass('lastName')}
                      placeholder="Last name"
                    />
                    {state.context.errors?.lastName && <p className="mt-1 text-base text-red-600">{state.context.errors.lastName}</p>}
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="email">
                      Email
                      <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="email"
                      type="email"
                      value={state.context.email || ''}
                      onChange={e => handleInputChange('email', e.target.value)}
                      className={inputClass('email')}
                      placeholder="email@example.com"
                    />
                    {state.context.errors?.email && <p className="mt-1 text-base text-red-600">{state.context.errors.email}</p>}
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="phoneNumber">
                      Phone
                      <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="phoneNumber"
                      type="tel"
                      value={state.context.phoneNumber || ''}
                      onChange={e => handleInputChange('phoneNumber', e.target.value)}
                      className={inputClass('phoneNumber')}
                      placeholder="(555) 123-4567"
                    />
                    {state.context.errors?.phoneNumber && <p className="mt-1 text-base text-red-600">{state.context.errors.phoneNumber}</p>}
                  </div>
                  <div className="col-span-2">
                    <label className={labelClass} htmlFor="address">
                      Address
                      <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="address"
                      type="text"
                      value={state.context.address || ''}
                      onChange={e => handleInputChange('address', e.target.value)}
                      className={inputClass('address')}
                      placeholder="123 Main St"
                    />
                    {state.context.errors?.address && <p className="mt-1 text-base text-red-600">{state.context.errors.address}</p>}
                  </div>
                  <div className="col-span-2">
                    <label className={labelClass} htmlFor="addressLine2">Apartment / Suite</label>
                    <input
                      id="addressLine2"
                      type="text"
                      value={state.context.addressLine2 || ''}
                      onChange={e => handleInputChange('addressLine2', e.target.value)}
                      className={inputClass('addressLine2')}
                      placeholder="Apt, Suite, etc. (optional)"
                    />
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="city">
                      City
                      <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="city"
                      type="text"
                      value={state.context.city || ''}
                      onChange={e => handleInputChange('city', e.target.value)}
                      className={inputClass('city')}
                      placeholder="City"
                    />
                    {state.context.errors?.city && <p className="mt-1 text-base text-red-600">{state.context.errors.city}</p>}
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="state">
                      State
                      <span className="text-red-500">*</span>
                    </label>
                    <select
                      id="state"
                      value={state.context.state || ''}
                      onChange={e => handleInputChange('state', e.target.value)}
                      className={inputClass('state')}
                    >
                      <option value="">Select state…</option>
                      {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    {state.context.errors?.state && <p className="mt-1 text-base text-red-600">{state.context.errors.state}</p>}
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="zip">
                      ZIP Code
                      <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="zip"
                      type="text"
                      value={state.context.zip || ''}
                      onChange={e => handleInputChange('zip', e.target.value)}
                      className={inputClass('zip')}
                      placeholder="12345"
                    />
                    {state.context.errors?.zip && <p className="mt-1 text-base text-red-600">{state.context.errors.zip}</p>}
                  </div>
                </div>
              </div>
              {/* end left col */}

              {/* Right: order summary */}
              <div className="col-span-2">
                {state.context.selectedPlan && (
                  <div className="sticky top-4 rounded-3xl border-2 border-gray-200 bg-gray-50 p-6">
                    <p className="mb-4 text-base font-semibold tracking-wide text-gray-500 uppercase">Order Summary</p>

                    <div className="mb-4 space-y-2 border-b border-gray-200 pb-4 text-base">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Program</span>
                        <span className="max-w-36 text-right font-semibold text-black">{state.context.selectedProgram?.name}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Plan</span>
                        <span className="max-w-36 text-right font-semibold text-black">{state.context.selectedPlan.name}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Start Date</span>
                        <span className="font-semibold text-black">
                          {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Next Billing</span>
                        <span className="font-semibold text-black">{nextBillingDate(state.context.selectedPlan)}</span>
                      </div>
                    </div>

                    <div className="mb-6 flex justify-between text-xl font-bold text-black">
                      <span>Total Due Today</span>
                      <span>{formatPlanPrice(state.context.selectedPlan)}</span>
                    </div>

                    {/* Membership agreement snippet */}
                    <div className="h-40 overflow-y-auto rounded-xl border border-gray-200 bg-white p-4 text-sm leading-relaxed text-gray-600">
                      <p className="mb-1 font-semibold">Membership Agreement</p>
                      <p className="mb-2">Cancellation Policy: 30-day written notice required for month-to-month. Commitment plans require payment for the full committed term.</p>
                      <p>Hold Policy: Accounts may be placed on hold up to 60 days/year for medical or military reasons. Two holds allowed per year, minimum 30 days each.</p>
                    </div>
                  </div>
                )}
              </div>
              {/* end right col */}

            </div>
            {/* end grid */}

            <div className="mt-8 flex items-center justify-between">
              <button
                onClick={() => send({ type: 'BACK' })}
                className="flex cursor-pointer items-center gap-2 text-xl text-gray-600 transition-colors hover:text-black"
              >
                <ArrowBackIcon sx={{ fontSize: 24 }} />
                {' '}
                Go back
              </button>
              <button
                onClick={() => send({ type: 'SUBMIT_CONTACT' })}
                disabled={state.context.isSubmitting || state.matches('lookingUpMember')}
                className="cursor-pointer rounded-2xl border-2 border-black bg-black px-12 py-4 text-xl font-bold text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {state.context.isSubmitting ? 'Validating…' : 'Complete Membership →'}
              </button>
            </div>
            <StepIndicator current={2} total={3} />
          </div>
        )}

        {/* ── Processing ──────────────────────────────────────────────────────── */}
        {(state.matches('processingPayment') || state.matches('creatingMembership')) && (
          <div className="w-full max-w-xl py-16 text-center">
            <div className="mx-auto mb-8 h-20 w-20 animate-spin rounded-full border-4 border-gray-200 border-t-black" />
            <h2 className="mb-4 text-3xl font-bold text-black">
              {state.matches('creatingMembership') ? 'Setting up your membership…' : 'Processing payment…'}
            </h2>
            <p className="text-xl text-gray-500">Please don't leave this screen</p>
          </div>
        )}

        {/* ── Success ─────────────────────────────────────────────────────────── */}
        {state.matches('success') && (
          <div className="w-full max-w-2xl py-8 text-center">
            <CheckCircleOutlineIcon sx={{ fontSize: 96 }} className="mb-6 text-black" />
            <h2 className="mb-4 text-4xl font-bold text-black">Enrollment Successful!</h2>
            <p className="mb-2 text-xl text-gray-600">
              Welcome,
              {' '}
              {state.context.firstName}
              ! Your membership is now active.
            </p>
            {state.context.selectedPlan && (
              <p className="mb-10 text-lg text-gray-500">
                {state.context.selectedProgram?.name}
                {' '}
                —
                {state.context.selectedPlan.name}
                {' '}
                (
                {formatPlanPrice(state.context.selectedPlan)}
                )
              </p>
            )}
            <div className="flex justify-center gap-4">
              <button
                onClick={onComplete}
                className="flex-1 cursor-pointer rounded-2xl border-2 border-black bg-white px-8 py-5 text-xl font-bold text-black transition-colors hover:bg-gray-100"
              >
                Done
              </button>
              {onCheckIn && (
                <button
                  onClick={onCheckIn}
                  className="flex-1 cursor-pointer rounded-2xl border-2 border-black bg-black px-8 py-5 text-xl font-bold text-white transition-colors hover:bg-gray-800"
                >
                  Check In Now
                </button>
              )}
            </div>
            <p className="mt-8 text-base text-gray-400">Auto-returning to home in 15 seconds…</p>
          </div>
        )}

        {/* ── Payment failed ──────────────────────────────────────────────────── */}
        {state.matches('paymentFailed') && (
          <div className="w-full max-w-2xl py-8 text-center">
            <div className="rounded-3xl border-2 border-red-200 bg-white p-12">
              <h2 className="mb-4 text-4xl font-bold text-black">Payment Failed</h2>
              <p className="mb-8 text-xl text-red-600">
                {Object.values(state.context.errors).join(' ') || 'There was an issue processing your payment.'}
              </p>
              <div className="flex gap-4">
                <button
                  onClick={() => send({ type: 'TRY_AGAIN' })}
                  className="flex-1 cursor-pointer rounded-2xl border-2 border-black bg-white px-8 py-5 text-xl font-bold text-black transition-colors hover:bg-gray-100"
                >
                  Try Again
                </button>
                <button
                  onClick={onBack}
                  className="flex-1 cursor-pointer rounded-2xl border-2 border-gray-300 bg-white px-8 py-5 text-xl font-bold text-gray-600 transition-colors hover:bg-gray-50"
                >
                  Back to Home
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Error ───────────────────────────────────────────────────────────── */}
        {state.matches('error') && (
          <div className="w-full max-w-2xl py-8 text-center">
            <div className="rounded-3xl border-2 border-red-200 bg-white p-12">
              <h2 className="mb-4 text-4xl font-bold text-black">Something Went Wrong</h2>
              <p className="mb-8 text-xl text-red-600">
                {Object.values(state.context.errors).join(' ') || 'Please try again or ask a staff member for help.'}
              </p>
              <div className="flex gap-4">
                <button
                  onClick={() => send({ type: 'TRY_AGAIN' })}
                  className="flex-1 cursor-pointer rounded-2xl border-2 border-black bg-white px-8 py-5 text-xl font-bold text-black transition-colors hover:bg-gray-100"
                >
                  Try Again
                </button>
                <button
                  onClick={onBack}
                  className="flex-1 cursor-pointer rounded-2xl border-2 border-gray-300 bg-white px-8 py-5 text-xl font-bold text-gray-600 transition-colors hover:bg-gray-50"
                >
                  Back to Home
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Timeout ─────────────────────────────────────────────────────────── */}
        {state.matches('timeout') && (
          <div className="w-full max-w-xl py-16 text-center">
            <h2 className="mb-4 text-4xl font-bold text-black">Session Timeout</h2>
            <p className="mb-4 text-xl text-orange-600">For security, your session has timed out.</p>
            <p className="text-lg text-gray-500">Returning to home screen…</p>
          </div>
        )}

      </main>
    </div>
  );
}

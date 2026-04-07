'use client';

import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import { useEffect, useRef, useState } from 'react';
import { useTrialMachine } from '../../hooks/useKioskMachines';
import { formatPhoneForDisplay, sanitizePhoneInput } from '../../lib/utils';
import { KioskFlowHeader } from '../KioskFlowHeader';
import { KioskSelect } from '../KioskSelect';
import { SignatureCapture } from '../SignatureCapture';
import { TouchDatePicker } from '../TouchDatePicker';

export interface TrialCheckinMember {
  memberId: string;
  firstName: string;
  lastName: string;
}

interface TrialFlowProps {
  onComplete: () => void;
  onBack: () => void;
  onCheckIn?: (members: TrialCheckinMember[]) => void;
}

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
    <div className="mt-6 flex items-center justify-center gap-3">
      {Array.from({ length: total }, (_, i) => `step-${i}`).map(stepKey => (
        <div
          key={stepKey}
          className={`h-3 w-8 rounded-full transition-all ${Number(stepKey.split('-')[1]) <= current ? 'bg-black' : 'bg-gray-300'}`}
        />
      ))}
    </div>
  );
}

interface DefaultTrialSelection {
  programId: string;
  programName: string;
  planId: string;
  planName: string;
}

export function TrialFlow({ onComplete, onBack, onCheckIn }: TrialFlowProps) {
  const [state, send] = useTrialMachine();
  const [defaultTrial, setDefaultTrial] = useState<DefaultTrialSelection | null>(null);
  const [createdMembers, setCreatedMembers] = useState<TrialCheckinMember[]>([]);

  // Load the first available trial program + plan once when the flow mounts
  useEffect(() => {
    fetch('/api/trial/programs')
      .then(r => r.json())
      .then((data: { programs?: Array<{ id: string; name: string; trialPlans: Array<{ id: string; name: string }> }> }) => {
        const firstProgram = data.programs?.[0];
        const firstPlan = firstProgram?.trialPlans?.[0];
        if (firstProgram && firstPlan) {
          setDefaultTrial({
            programId: firstProgram.id,
            programName: firstProgram.name,
            planId: firstPlan.id,
            planName: firstPlan.name,
          });
        }
      })
      .catch(() => {});
  }, []);

  // Track session IDs so effects re-run on each new session but not on re-renders
  const programsLoadedRef = useRef<string>('');
  const waiverLoadedRef = useRef<string>('');
  const processingRef = useRef(false);

  // Load programs when entering selectingAge (re-fetches on each new session)
  useEffect(() => {
    if (!state.matches('selectingAge')) {
      return;
    }
    if (programsLoadedRef.current === state.context.sessionId) {
      return;
    }
    programsLoadedRef.current = state.context.sessionId;
    processingRef.current = false;

    fetch('/api/trial/programs')
      .then(res => res.json())
      .then((data: { programs: Array<{ id: string; trialPlans: Array<{ id: string }> }> }) => {
        const firstPlan = data.programs?.[0]?.trialPlans?.[0];
        send({ type: 'PROGRAMS_LOADED', selectedMembershipPlanId: firstPlan?.id ?? '' });
      })
      .catch(() => {
        // Non-fatal — proceed without a pre-selected plan
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.value]);

  // Load waiver content when entering collectingWaiver (once per session)
  useEffect(() => {
    if (!state.matches('collectingWaiver')) {
      return;
    }
    if (waiverLoadedRef.current === state.context.sessionId) {
      return;
    }
    waiverLoadedRef.current = state.context.sessionId;

    fetch('/api/trial/waiver')
      .then(res => res.json())
      .then((data: { id: string; version: number; content: string }) => {
        if (data.id) {
          send({ type: 'WAIVER_LOADED', id: data.id, version: data.version, content: data.content });
        }
      })
      .catch(() => {
        // Non-fatal — waiver text falls back to hardcoded content
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.value]);

  // Submit trial when entering creatingTrial
  useEffect(() => {
    if (!state.matches('creatingTrial')) {
      return;
    }
    if (processingRef.current) {
      return;
    }
    processingRef.current = true;

    const ctx = state.context;
    const isYouth = ctx.ageGroup === 'youth';

    const body = isYouth
      ? {
          ageGroup: 'youth' as const,
          member: {
            firstName: ctx.parentFirstName,
            lastName: ctx.parentLastName,
            email: ctx.parentEmail,
            phone: ctx.parentPhone,
            address: ctx.parentAddress,
            addressLine2: ctx.parentAddressLine2,
            city: ctx.parentCity,
            state: ctx.parentState,
            zip: ctx.parentZip,
          },
          children: ctx.children,
          waiver: {
            templateId: ctx.waiverTemplateId,
            templateVersion: ctx.waiverTemplateVersion,
            renderedContent: ctx.waiverContent,
            signature: ctx.signature,
          },
          membershipPlanId: ctx.selectedMembershipPlanId,
        }
      : {
          ageGroup: 'adult' as const,
          member: {
            firstName: ctx.firstName,
            lastName: ctx.lastName,
            email: ctx.email,
            phone: ctx.phoneNumber,
            address: ctx.address,
            addressLine2: ctx.addressLine2,
            city: ctx.city,
            state: ctx.state,
            zip: ctx.zip,
          },
          waiver: {
            templateId: ctx.waiverTemplateId,
            templateVersion: ctx.waiverTemplateVersion,
            renderedContent: ctx.waiverContent,
            signature: ctx.signature,
          },
          membershipPlanId: ctx.selectedMembershipPlanId,
        };

    fetch('/api/trial/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then((res) => {
        if (!res.ok) {
          return res.json().then(d => Promise.reject(new Error(d.error ?? 'Submission failed')));
        }
        return res.json();
      })
      .then((data: { memberId: string }) => {
        send({ type: 'TRIAL_SUCCESS', memberId: data.memberId });
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
        send({ type: 'TRIAL_FAILED', error: message });
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.value]);

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

  // Submit trial signup when entering creatingTrial state
  useEffect(() => {
    if (!state.matches('creatingTrial')) {
      return;
    }
    if (!defaultTrial) {
      send({ type: 'TRIAL_FAILED', error: 'No trial plan available. Please contact the front desk.' });
      return;
    }
    const ctx = state.context;
    const isYouth = ctx.ageGroup === 'youth';
    const body = {
      ageGroup: ctx.ageGroup,
      member: {
        firstName: isYouth ? ctx.parentFirstName : ctx.firstName,
        lastName: isYouth ? ctx.parentLastName : ctx.lastName,
        email: isYouth ? ctx.parentEmail : ctx.email,
        phone: isYouth ? ctx.parentPhone : ctx.phoneNumber,
        address: isYouth ? ctx.parentAddress : ctx.address,
        addressLine2: isYouth ? ctx.parentAddressLine2 : ctx.addressLine2,
        city: isYouth ? ctx.parentCity : ctx.city,
        state: isYouth ? ctx.parentState : ctx.state,
        zip: isYouth ? ctx.parentZip : ctx.zip,
        dateOfBirth: (isYouth ? ctx.parentDateOfBirth : ctx.dateOfBirth) || undefined,
      },
      children: isYouth
        ? [...ctx.children, ...(ctx.currentChildFirstName
            ? [{ firstName: ctx.currentChildFirstName, lastName: ctx.currentChildLastName, dateOfBirth: ctx.currentChildDateOfBirth }]
            : [])]
        : undefined,
      waiver: {
        templateId: ctx.waiverTemplateId,
        templateVersion: ctx.waiverTemplateVersion,
        renderedContent: ctx.waiverContent,
        signature: ctx.signature,
      },
      membershipPlanId: defaultTrial.planId,
      programName: defaultTrial.programName,
      planName: defaultTrial.planName,
    };

    fetch('/api/trial/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(async (r) => {
        const data = await r.json() as {
          memberId?: string;
          members?: TrialCheckinMember[];
          error?: string;
        };
        if (r.ok && data.memberId) {
          setCreatedMembers(data.members ?? []);
          send({ type: 'TRIAL_SUCCESS', memberId: data.memberId });
        }
        else {
          send({ type: 'TRIAL_FAILED', error: data.error ?? 'Trial signup failed' });
        }
      })
      .catch((err) => {
        send({ type: 'TRIAL_FAILED', error: err instanceof Error ? err.message : 'Trial signup failed' });
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.value]);

  // Fetch the trial waiver template when entering collectingWaiver
  useEffect(() => {
    if (!state.matches('collectingWaiver') || !state.context.isLoadingWaiver) {
      return;
    }
    fetch('/api/trial/waiver')
      .then(r => r.json())
      .then((data: { id?: string; version?: number; content?: string; error?: string }) => {
        if (data.id && typeof data.version === 'number' && data.content) {
          send({ type: 'WAIVER_LOADED', id: data.id, version: data.version, content: data.content });
        }
        else {
          send({ type: 'WAIVER_FAILED' });
        }
      })
      .catch(() => send({ type: 'WAIVER_FAILED' }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.value]);

  // No auto-redirect on success -- user chooses next action

  const inputClass = (field: string) =>
    `w-full text-xl p-4 bg-white border-2 rounded-xl text-black placeholder-gray-400 focus:outline-none focus:ring-4 focus:ring-gray-400 focus:border-gray-600 ${
      state.context.errors?.[field]
        ? 'border-red-400 focus:ring-red-300 focus:border-red-500'
        : 'border-gray-300'
    }`;

  const labelClass = 'block text-black text-lg font-medium mb-2';

  const headerTitle = () => {
    if (state.matches('selectingAge')) {
      return 'Start Your Free Trial';
    }
    if (state.matches('collectingYouthParentInfo') || state.matches('validatingYouthParent')) {
      return 'Parent/Guardian Details';
    }
    if (state.matches('collectingYouthChildInfo') || state.matches('validatingYouthChild')) {
      return 'Child\'s Details';
    }
    if (state.matches('askingAddAnotherChild')) {
      return 'Add Another Child?';
    }
    if (state.matches('collectingInfo') || state.matches('validatingContact')) {
      return 'Your Details';
    }
    if (state.matches('collectingWaiver') || state.matches('validatingWaiver')) {
      return 'Waiver & Agreement';
    }
    if (state.matches('creatingTrial')) {
      return 'Setting Up Your Trial…';
    }
    if (state.matches('success')) {
      return 'Welcome to the Dojo!';
    }
    if (state.matches('error')) {
      return 'Something Went Wrong';
    }
    if (state.matches('timeout')) {
      return 'Session Timeout';
    }
    return 'Free Trial';
  };

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <KioskFlowHeader
        title={headerTitle()}
        onBack={state.matches('selectingAge') ? onBack : () => send({ type: 'BACK' })}
      />

      <main className="flex flex-1 items-center justify-center p-4 sm:p-6 md:p-8">

        {/* ── Step 1: Age Selection ── */}
        {state.matches('selectingAge') && (
          <div className="w-full max-w-3xl text-center">
            <p className="mb-10 text-2xl text-gray-600">
              Is this trial for an adult or youth under 18?
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-8">
              <button
                type="button"
                onClick={() => send({ type: 'SELECT_AGE_GROUP', ageGroup: 'adult' })}
                className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-3xl border-2 border-black bg-white px-6 py-8 transition-all hover:scale-105 hover:bg-gray-50 sm:px-8 sm:py-14"
              >
                <span className="text-xl font-bold text-black sm:text-2xl md:text-3xl">Adult (18+)</span>
                <span className="text-lg text-gray-500">Get started</span>
              </button>
              <button
                type="button"
                onClick={() => send({ type: 'SELECT_AGE_GROUP', ageGroup: 'youth' })}
                className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-3xl border-2 border-black bg-white px-6 py-8 transition-all hover:scale-105 hover:bg-gray-50 sm:px-8 sm:py-14"
              >
                <span className="text-xl font-bold text-black sm:text-2xl md:text-3xl">Youth (Under 18)</span>
                <span className="text-lg text-gray-500">Get started</span>
              </button>
            </div>
          </div>
        )}

        {/* ── Youth Step 2: Parent/Guardian Details ── */}
        {(state.matches('collectingYouthParentInfo') || state.matches('validatingYouthParent')) && (
          <div className="w-full max-w-4xl">
            <p className="mb-8 text-center text-xl text-gray-500">Please fill in your information</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5">

              <div>
                <label className={labelClass} htmlFor="parentFirstName">
                  First Name
                  <span className="text-red-500">*</span>
                </label>
                <input
                  id="parentFirstName"
                  type="text"
                  value={state.context.parentFirstName || ''}
                  onChange={e => handleInputChange('parentFirstName', e.target.value)}
                  className={inputClass('parentFirstName')}
                  placeholder="First name"
                />
                {state.context.errors?.parentFirstName && <p className="mt-1 text-base text-red-600">{state.context.errors.parentFirstName}</p>}
              </div>

              <div>
                <label className={labelClass} htmlFor="parentLastName">
                  Last Name
                  <span className="text-red-500">*</span>
                </label>
                <input
                  id="parentLastName"
                  type="text"
                  value={state.context.parentLastName || ''}
                  onChange={e => handleInputChange('parentLastName', e.target.value)}
                  className={inputClass('parentLastName')}
                  placeholder="Last name"
                />
                {state.context.errors?.parentLastName && <p className="mt-1 text-base text-red-600">{state.context.errors.parentLastName}</p>}
              </div>

              <div>
                <label className={labelClass} htmlFor="parentEmail">
                  Email
                  <span className="text-red-500">*</span>
                </label>
                <input
                  id="parentEmail"
                  type="email"
                  value={state.context.parentEmail || ''}
                  onChange={e => handleInputChange('parentEmail', e.target.value)}
                  className={inputClass('parentEmail')}
                  placeholder="email@example.com"
                />
                {state.context.errors?.parentEmail && <p className="mt-1 text-base text-red-600">{state.context.errors.parentEmail}</p>}
              </div>

              <div>
                <label className={labelClass} htmlFor="parentPhone">
                  Phone Number
                  <span className="text-red-500">*</span>
                </label>
                <input
                  id="parentPhone"
                  type="tel"
                  value={state.context.parentPhone || ''}
                  onChange={e => handleInputChange('parentPhone', e.target.value)}
                  className={inputClass('parentPhone')}
                  placeholder="(555) 123-4567"
                />
                {state.context.errors?.parentPhone && <p className="mt-1 text-base text-red-600">{state.context.errors.parentPhone}</p>}
              </div>

              <div>
                <label className={labelClass} htmlFor="parentAddress">
                  Address
                  <span className="text-red-500">*</span>
                </label>
                <input
                  id="parentAddress"
                  type="text"
                  value={state.context.parentAddress || ''}
                  onChange={e => handleInputChange('parentAddress', e.target.value)}
                  className={inputClass('parentAddress')}
                  placeholder="123 Main St"
                />
                {state.context.errors?.parentAddress && <p className="mt-1 text-base text-red-600">{state.context.errors.parentAddress}</p>}
              </div>

              <div>
                <label className={labelClass} htmlFor="parentAddressLine2">Apartment / Suite</label>
                <input
                  id="parentAddressLine2"
                  type="text"
                  value={state.context.parentAddressLine2 || ''}
                  onChange={e => handleInputChange('parentAddressLine2', e.target.value)}
                  className={inputClass('parentAddressLine2')}
                  placeholder="Apt, Suite, etc. (optional)"
                />
              </div>

              <div>
                <label className={labelClass} htmlFor="parentCity">
                  City
                  <span className="text-red-500">*</span>
                </label>
                <input
                  id="parentCity"
                  type="text"
                  value={state.context.parentCity || ''}
                  onChange={e => handleInputChange('parentCity', e.target.value)}
                  className={inputClass('parentCity')}
                  placeholder="City"
                />
                {state.context.errors?.parentCity && <p className="mt-1 text-base text-red-600">{state.context.errors.parentCity}</p>}
              </div>

              <KioskSelect
                id="parentState"
                value={state.context.parentState || ''}
                onChange={v => handleInputChange('parentState', v)}
                label="State"
                required
                options={US_STATES.map(s => ({ value: s, label: s }))}
                placeholder="Select state…"
                error={state.context.errors?.parentState}
              />

              <div>
                <label className={labelClass} htmlFor="parentZip">
                  ZIP Code
                  <span className="text-red-500">*</span>
                </label>
                <input
                  id="parentZip"
                  type="text"
                  value={state.context.parentZip || ''}
                  onChange={e => handleInputChange('parentZip', e.target.value)}
                  className={inputClass('parentZip')}
                  placeholder="12345"
                />
                {state.context.errors?.parentZip && <p className="mt-1 text-base text-red-600">{state.context.errors.parentZip}</p>}
              </div>

              <TouchDatePicker
                value={state.context.parentDateOfBirth || ''}
                onChange={v => handleInputChange('parentDateOfBirth', v)}
                label="Date of Birth"
                error={state.context.errors?.parentDateOfBirth}
                placeholder="Select date of birth"
              />

            </div>
            <div className="mt-8 flex items-center justify-between">
              <button
                type="button"
                onClick={() => send({ type: 'BACK' })}
                className="flex cursor-pointer items-center gap-2 text-xl text-gray-600 transition-colors hover:text-black"
              >
                <ArrowBackIcon sx={{ fontSize: 24 }} />
                {' '}
                Go back
              </button>
              <button
                type="button"
                onClick={() => send({ type: 'SUBMIT_YOUTH_PARENT' })}
                disabled={
                  state.context.isSubmitting
                  || !state.context.parentFirstName?.trim()
                  || !state.context.parentLastName?.trim()
                  || !state.context.parentEmail?.trim()
                  || !state.context.parentPhone?.trim()
                  || !state.context.parentAddress?.trim()
                  || !state.context.parentCity?.trim()
                  || !state.context.parentState?.trim()
                  || !state.context.parentZip?.trim()
                  || !state.context.parentDateOfBirth?.trim()
                }
                className="cursor-pointer rounded-2xl border-2 border-black bg-white px-12 py-4 text-xl font-bold text-black transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:bg-gray-200"
              >
                Next →
              </button>
            </div>
            <StepIndicator current={0} total={3} />
          </div>
        )}

        {/* ── Youth Step 3: Child Details ── */}
        {(state.matches('collectingYouthChildInfo') || state.matches('validatingYouthChild')) && (
          <div className="w-full max-w-2xl">
            <p className="mb-6 text-center text-xl text-gray-500">Please fill in your child's information</p>

            {state.context.children.length > 0 && (
              <div className="mb-6 rounded-2xl border border-gray-200 bg-gray-50 p-4">
                <p className="mb-2 text-sm font-semibold tracking-wide text-gray-500 uppercase">Children added</p>
                {state.context.children.map(child => (
                  <p key={`${child.firstName}-${child.lastName}-${child.dateOfBirth}`} className="text-lg text-black">
                    {child.firstName}
                    {' '}
                    {child.lastName}
                    {' '}
                    &mdash;
                    {' '}
                    {child.dateOfBirth}
                  </p>
                ))}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5">
              <div>
                <label className={labelClass} htmlFor="currentChildFirstName">
                  First Name
                  <span className="text-red-500">*</span>
                </label>
                <input
                  id="currentChildFirstName"
                  type="text"
                  value={state.context.currentChildFirstName || ''}
                  onChange={e => handleInputChange('currentChildFirstName', e.target.value)}
                  className={inputClass('currentChildFirstName')}
                  placeholder="First name"
                />
                {state.context.errors?.currentChildFirstName && <p className="mt-1 text-base text-red-600">{state.context.errors.currentChildFirstName}</p>}
              </div>

              <div>
                <label className={labelClass} htmlFor="currentChildLastName">
                  Last Name
                  <span className="text-red-500">*</span>
                </label>
                <input
                  id="currentChildLastName"
                  type="text"
                  value={state.context.currentChildLastName || ''}
                  onChange={e => handleInputChange('currentChildLastName', e.target.value)}
                  className={inputClass('currentChildLastName')}
                  placeholder="Last name"
                />
                {state.context.errors?.currentChildLastName && <p className="mt-1 text-base text-red-600">{state.context.errors.currentChildLastName}</p>}
              </div>

              <TouchDatePicker
                value={state.context.currentChildDateOfBirth || ''}
                onChange={v => handleInputChange('currentChildDateOfBirth', v)}
                label="Child's Date of Birth"
                error={state.context.errors?.currentChildDateOfBirth}
                placeholder="Select date of birth"
              />
            </div>

            <div className="mt-8 flex items-center justify-between">
              <button
                type="button"
                onClick={() => send({ type: 'BACK' })}
                className="flex cursor-pointer items-center gap-2 text-xl text-gray-600 transition-colors hover:text-black"
              >
                <ArrowBackIcon sx={{ fontSize: 24 }} />
                {' '}
                Go back
              </button>
              <button
                type="button"
                onClick={() => send({ type: 'SUBMIT_YOUTH_CHILD' })}
                disabled={
                  state.context.isSubmitting
                  || !state.context.currentChildFirstName?.trim()
                  || !state.context.currentChildLastName?.trim()
                  || !state.context.currentChildDateOfBirth?.trim()
                }
                className="cursor-pointer rounded-2xl border-2 border-black bg-white px-12 py-4 text-xl font-bold text-black transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:bg-gray-200"
              >
                Next →
              </button>
            </div>
            <StepIndicator current={1} total={3} />
          </div>
        )}

        {/* ── Youth Step 5: Add Another Child? ── */}
        {state.matches('askingAddAnotherChild') && (
          <div className="w-full max-w-2xl text-center">
            <div className="rounded-3xl border-2 border-black bg-white p-6 sm:p-8 md:p-12">
              <p className="mb-4 text-xl text-gray-600">Would you like to add another child?</p>

              {state.context.children.length > 0 && (
                <div className="mb-8 rounded-2xl border border-gray-200 bg-gray-50 p-4 text-left">
                  <p className="mb-2 text-sm font-semibold tracking-wide text-gray-500 uppercase">Children added</p>
                  {state.context.children.map(child => (
                    <p key={`${child.firstName}-${child.lastName}-${child.dateOfBirth}`} className="text-lg text-black">
                      {child.firstName}
                      {' '}
                      {child.lastName}
                      {' '}
                      &mdash;
                      {' '}
                      {child.dateOfBirth}
                    </p>
                  ))}
                </div>
              )}

              <div className="flex justify-center gap-4">
                <button
                  type="button"
                  onClick={() => send({ type: 'FINISH_YOUTH' })}
                  className="flex-1 cursor-pointer rounded-2xl border-2 border-black bg-white px-8 py-5 text-xl font-bold text-black transition-colors hover:bg-gray-100"
                >
                  No, Continue
                </button>
                <button
                  type="button"
                  onClick={() => send({ type: 'ADD_ANOTHER_CHILD' })}
                  className="flex-1 cursor-pointer rounded-2xl border-2 border-black bg-black px-8 py-5 text-xl font-bold text-white transition-colors hover:bg-gray-800"
                >
                  Yes, Add Another Child
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Step 2: Your Details ── */}
        {(state.matches('collectingInfo') || state.matches('validatingContact')) && (
          <div className="w-full max-w-4xl">
            <p className="mb-8 text-center text-xl text-gray-500">Please fill in your information</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5">

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
                {state.context.errors?.firstName && (
                  <p className="mt-1 text-base text-red-600">{state.context.errors.firstName}</p>
                )}
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
                {state.context.errors?.lastName && (
                  <p className="mt-1 text-base text-red-600">{state.context.errors.lastName}</p>
                )}
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
                {state.context.errors?.email && (
                  <p className="mt-1 text-base text-red-600">{state.context.errors.email}</p>
                )}
              </div>

              <div>
                <label className={labelClass} htmlFor="phoneNumber">
                  Phone Number
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
                {state.context.errors?.phoneNumber && (
                  <p className="mt-1 text-base text-red-600">{state.context.errors.phoneNumber}</p>
                )}
              </div>

              <div>
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
                {state.context.errors?.address && (
                  <p className="mt-1 text-base text-red-600">{state.context.errors.address}</p>
                )}
              </div>

              <div>
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
                {state.context.errors?.city && (
                  <p className="mt-1 text-base text-red-600">{state.context.errors.city}</p>
                )}
              </div>

              <KioskSelect
                id="state"
                value={state.context.state || ''}
                onChange={v => handleInputChange('state', v)}
                label="State"
                required
                options={US_STATES.map(s => ({ value: s, label: s }))}
                placeholder="Select state…"
                error={state.context.errors?.state}
              />

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
                {state.context.errors?.zip && (
                  <p className="mt-1 text-base text-red-600">{state.context.errors.zip}</p>
                )}
              </div>

              <TouchDatePicker
                value={state.context.dateOfBirth || ''}
                onChange={v => handleInputChange('dateOfBirth', v)}
                label="Date of Birth"
                error={state.context.errors?.dateOfBirth}
                placeholder="Select date of birth"
              />

            </div>

            <div className="mt-8 flex items-center justify-between">
              <button
                type="button"
                onClick={() => send({ type: 'BACK' })}
                className="flex cursor-pointer items-center gap-2 text-xl text-gray-600 transition-colors hover:text-black"
              >
                <ArrowBackIcon sx={{ fontSize: 24 }} />
                {' '}
                Go back
              </button>
              <button
                type="button"
                onClick={() => send({ type: 'SUBMIT_CONTACT' })}
                disabled={
                  state.context.isSubmitting
                  || !state.context.firstName?.trim()
                  || !state.context.lastName?.trim()
                  || !state.context.email?.trim()
                  || !state.context.phoneNumber?.trim()
                  || !state.context.dateOfBirth?.trim()
                  || !state.context.address?.trim()
                  || !state.context.city?.trim()
                  || !state.context.state?.trim()
                  || !state.context.zip?.trim()
                }
                className="cursor-pointer rounded-2xl border-2 border-black bg-white px-12 py-4 text-xl font-bold text-black transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:bg-gray-200"
              >
                Next →
              </button>
            </div>
            <StepIndicator current={1} total={3} />
          </div>
        )}

        {/* ── Step 3: Waiver & Agreement ── */}
        {(state.matches('collectingWaiver') || state.matches('validatingWaiver')) && (
          <div className="w-full max-w-4xl">
            <p className="mb-6 text-center text-xl text-gray-500">Please read and sign the forms below</p>

            <div className="mb-6 max-h-72 overflow-y-auto rounded-2xl border-2 border-gray-300 bg-gray-50 p-8 text-base leading-relaxed text-gray-800">
              {state.context.isLoadingWaiver
                ? <p className="text-gray-400">Loading waiver...</p>
                : state.context.waiverContent
                  ? state.context.waiverContent.split('\n').map((line, i) => {
                      const lineKey = `w-${line.slice(0, 40).replace(/\s/g, '-')}-${i}`;
                      return (
                        <p key={lineKey} className={line.trim() ? 'mb-3' : 'mb-1'}>
                          {line}
                        </p>
                      );
                    })
                  : <p className="text-gray-400">No waiver content available</p>}
            </div>

            <div
              role="checkbox"
              aria-checked={state.context.waiverAgreed}
              tabIndex={0}
              className={`mb-2 flex cursor-pointer items-start gap-4 rounded-xl border-2 p-5 transition-colors ${
                state.context.waiverAgreed ? 'border-black bg-gray-50' : 'border-gray-300 bg-white'
              } ${state.context.errors?.waiverAgreed ? 'border-red-400' : ''}`}
              onClick={() => send({ type: 'AGREE_WAIVER', agreed: !state.context.waiverAgreed })}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  send({ type: 'AGREE_WAIVER', agreed: !state.context.waiverAgreed });
                }
              }}
            >
              <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded border-2 transition-colors ${
                state.context.waiverAgreed ? 'border-black bg-black' : 'border-gray-400'
              }`}
              >
                {state.context.waiverAgreed && (
                  <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
              <span className="text-lg text-black">
                I agree to the waiver &amp; agreement and understand the risks involved in martial arts training.
              </span>
            </div>
            {state.context.errors?.waiverAgreed && (
              <p className="mb-4 text-base text-red-600">{state.context.errors.waiverAgreed}</p>
            )}

            <div className="mt-4 mb-2">
              <SignatureCapture
                label={state.context.ageGroup === 'youth' ? 'Parent/Guardian Signature' : 'Signature'}
                onSignatureChange={(dataUrl) => {
                  handleInputChange('signature', dataUrl ?? '');
                }}
              />
              {state.context.errors?.signature && (
                <p className="mt-1 text-base text-red-600">{state.context.errors.signature}</p>
              )}
            </div>

            <div className="mt-6 flex items-center justify-between">
              <button
                type="button"
                onClick={() => send({ type: 'BACK' })}
                className="flex cursor-pointer items-center gap-2 text-xl text-gray-600 transition-colors hover:text-black"
              >
                <ArrowBackIcon sx={{ fontSize: 24 }} />
                {' '}
                Go back
              </button>
              <button
                type="button"
                onClick={() => send({ type: 'SUBMIT_WAIVER' })}
                disabled={
                  state.context.isSubmitting
                  || !state.context.waiverAgreed
                  || !state.context.signature?.trim()
                }
                className="cursor-pointer rounded-2xl border-2 border-black bg-black px-12 py-4 text-xl font-bold text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-400"
              >
                Continue Signup →
              </button>
            </div>
            <StepIndicator current={2} total={3} />
          </div>
        )}

        {/* ── Creating Trial ── */}
        {state.matches('creatingTrial') && (
          <div className="w-full max-w-2xl text-center">
            <div className="rounded-3xl border-2 border-black bg-white p-8 sm:p-12 md:p-16">
              <div className="mb-6 flex justify-center">
                <div className="h-16 w-16 animate-spin rounded-full border-4 border-black border-t-transparent" />
              </div>
              <h2 className="text-xl font-bold text-black sm:text-2xl md:text-3xl">Setting up your free trial…</h2>
              <p className="mt-4 text-xl text-gray-500">This will just take a moment.</p>
            </div>
          </div>
        )}

        {/* ── Success ── */}
        {state.matches('success') && (
          <div className="w-full max-w-2xl text-center">
            <div className="rounded-3xl border-2 border-black bg-white p-8 sm:p-12 md:p-16">
              <CheckCircleOutlineIcon sx={{ fontSize: 80, color: '#16a34a' }} className="mb-6" />
              <h2 className="mb-4 text-2xl font-bold text-black sm:text-3xl md:text-4xl">Welcome to the Dojo!</h2>
              <p className="mb-2 text-xl text-gray-600">
                Your free trial has been set up,
                {' '}
                <span className="font-semibold text-black">{state.context.firstName}</span>
                !
              </p>
              <p className="mb-10 text-lg text-gray-500">
                Check your email for next steps. We look forward to training with you.
              </p>
              <div className="flex justify-center gap-4">
                <button
                  type="button"
                  onClick={onComplete}
                  className="cursor-pointer rounded-2xl border-2 border-black bg-white px-12 py-5 text-xl font-bold text-black transition-colors hover:bg-gray-100"
                >
                  Done
                </button>
                <button
                  type="button"
                  onClick={() => onCheckIn?.(createdMembers)}
                  className="cursor-pointer rounded-2xl border-2 border-black bg-black px-12 py-5 text-xl font-bold text-white transition-colors hover:bg-gray-800"
                >
                  Check In Now
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Error ── */}
        {state.matches('error') && (
          <div className="w-full max-w-2xl text-center">
            <div className="rounded-3xl border-2 border-black bg-white p-8 sm:p-12 md:p-16">
              <h2 className="mb-6 text-2xl font-bold text-black sm:text-3xl md:text-4xl">Something went wrong</h2>
              <p className="mb-8 text-xl text-red-600">
                {Object.values(state.context.errors).join(' ') || 'Please try again or ask a staff member for help.'}
              </p>
              <div className="space-y-4">
                <button
                  type="button"
                  onClick={() => send({ type: 'TRY_AGAIN' })}
                  className="w-full cursor-pointer rounded-2xl border-2 border-black bg-white px-8 py-5 text-xl font-bold text-black transition-colors hover:bg-gray-100"
                >
                  Try Again
                </button>
                <button
                  type="button"
                  onClick={onBack}
                  className="w-full cursor-pointer rounded-2xl border-2 border-gray-300 bg-white px-8 py-4 text-lg text-gray-600 transition-colors hover:bg-gray-100"
                >
                  Back to Home
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Timeout ── */}
        {state.matches('timeout') && (
          <div className="w-full max-w-2xl text-center">
            <div className="rounded-3xl border-2 border-black bg-white p-8 sm:p-12 md:p-16">
              <h2 className="mb-4 text-2xl font-bold text-black sm:text-3xl md:text-4xl">Session Timeout</h2>
              <p className="text-xl text-orange-600">Returning to home screen for security…</p>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}

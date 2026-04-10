'use client';

import type { TokenizationIframeConfig } from '../../lib/iqpro';
import type { MembershipPlan } from '../../lib/types';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import { useEffect, useRef, useState } from 'react';
import { useMembershipMachine } from '../../hooks/useKioskMachines';
import { useTokenExIframe } from '../../hooks/useTokenExIframe';
import { formatPhoneForDisplay, sanitizePhoneInput } from '../../lib/utils';
import { KioskFlowHeader } from '../KioskFlowHeader';
import { KioskSelect } from '../KioskSelect';
import { SignatureCapture } from '../SignatureCapture';
import { StepIndicator } from '../StepIndicator';
import { TouchDatePicker } from '../TouchDatePicker';

const TOKENEX_CARD_ID = 'membership-tokenex-card';
const TOKENEX_CVV_ID = 'membership-tokenex-cvv';

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

export interface ChildMembershipSeed {
  childMemberId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  convertingTrialMembershipId: string | null;
  guardianFirstName: string;
  guardianLastName: string;
  guardianEmail: string;
}

interface MembershipFlowProps {
  onComplete: () => void;
  onBack: () => void;
  onCheckIn?: () => void;
  initialMemberData?: ChildMembershipSeed;
}

interface LookupResult {
  memberId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  dateOfBirth: string | null;
  status: string;
  memberType: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  trialMembershipId: string | null;
  existingSignature: string | null;
}

export function MembershipFlow({ onComplete, onBack, onCheckIn, initialMemberData }: MembershipFlowProps) {
  const [state, send] = useMembershipMachine();
  const [planPage, setPlanPage] = useState(0);
  const [successCountdown, setSuccessCountdown] = useState(60);
  const [lookupResults, setLookupResults] = useState<LookupResult[]>([]);
  const [showLookupPicker, setShowLookupPicker] = useState(false);
  const preseededRef = useRef(false);
  const [wantsNewSignature, setWantsNewSignature] = useState(false);

  // Determine if member is a minor
  const memberIsMinor = (() => {
    const dob = state.context.dateOfBirth;
    if (!dob) {
      return false;
    }
    const birthDate = new Date(dob);
    if (Number.isNaN(birthDate.getTime())) {
      return false;
    }
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age < 18;
  })();

  // Tokenization state
  const [tokenizationConfig, setTokenizationConfig] = useState<TokenizationIframeConfig | null>(null);
  const [tokenizationError, setTokenizationError] = useState<string | null>(null);
  const capturedTokenRef = useRef<{ token: string; firstSix: string; lastFour: string } | null>(null);

  const isCardPayment = state.context.paymentMethod === 'card';

  const { isLoaded: iframeLoaded, isValid: iframeValid, isCvvValid: iframeCvvValid, error: iframeError, tokenize: iframeTokenize } = useTokenExIframe({
    containerId: TOKENEX_CARD_ID,
    cvvContainerId: TOKENEX_CVV_ID,
    config: isCardPayment && state.matches('collectingPayment') ? tokenizationConfig : null,
  });

  // Fetch programs and plans when entering selectingProgram state
  useEffect(() => {
    if (!state.matches('selectingProgram') || !state.context.isLoadingPrograms) {
      return;
    }
    fetch('/api/programs')
      .then(r => r.json())
      .then((data) => {
        const programs = (data.programs ?? []).map((p: Record<string, unknown>) => ({
          id: p.id as string,
          name: p.name as string,
          description: (p.description as string) ?? '',
          price: 0,
          isActive: true,
        }));
        const plansByProgram: Record<string, MembershipPlan[]> = {};
        for (const [programId, plans] of Object.entries(data.plansByProgram ?? {})) {
          plansByProgram[programId] = (plans as Array<Record<string, unknown>>).map(p => ({
            id: p.id as string,
            name: p.name as string,
            description: (p.description as string) ?? '',
            price: p.price as number,
            interval: ((p.frequency as string) ?? 'Monthly').toLowerCase() === 'annual' ? 'yearly' as const : 'monthly' as const,
            isActive: true,
          }));
        }
        send({ type: 'PROGRAMS_LOADED', programs, plansByProgram });
      })
      .catch(() => send({ type: 'PROGRAMS_FAILED' }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.value]);

  const dispatchMemberFound = (m: LookupResult) => {
    send({
      type: 'MEMBER_FOUND',
      member: {
        id: m.memberId,
        firstName: m.firstName,
        lastName: m.lastName,
        email: m.email,
        phoneNumber: m.phone ?? state.context.memberLookupPhone,
        status: (m.status as 'active' | 'inactive' | 'trial' | 'suspended') ?? 'active',
        joinedAt: new Date(),
        dateOfBirth: m.dateOfBirth ?? undefined,
        address: m.address ?? undefined,
        city: m.city ?? undefined,
        state: m.state ?? undefined,
        zip: m.zip ?? undefined,
        trialMembershipId: m.trialMembershipId,
        existingSignature: m.existingSignature ?? undefined,
      },
    });
  };

  // Handle member lookup when entering lookingUpMember state
  useEffect(() => {
    if (!state.matches('lookingUpMember')) {
      return;
    }
    const phone = state.context.memberLookupPhone;
    fetch('/api/members/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone,
        selectedPlanId: state.context.selectedPlan?.id,
      }),
    })
      .then(r => r.json())
      .then((data: { found: boolean; members: LookupResult[] }) => {
        if (!data.found || !data.members || data.members.length === 0) {
          send({ type: 'MEMBER_NOT_FOUND' });
          return;
        }

        if (data.members.length === 1) {
          // Single match — dispatch immediately
          const m = data.members[0];
          if (m) {
            dispatchMemberFound(m);
          }
          return;
        }

        // Multiple matches — show picker
        setLookupResults(data.members);
        setShowLookupPicker(true);
        send({ type: 'MEMBER_NOT_FOUND' }); // Transition back to collectingInfo; picker stays as overlay
      })
      .catch(() => send({ type: 'MEMBER_NOT_FOUND' }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.value]);

  const handlePickLookupResult = (m: LookupResult) => {
    setShowLookupPicker(false);
    setLookupResults([]);
    dispatchMemberFound(m);
  };

  // Fetch waiver content when entering reviewingCommitment state
  useEffect(() => {
    if (!state.matches('reviewingCommitment') || !state.context.isLoadingWaiver) {
      return;
    }
    const planId = state.context.selectedPlan?.id;
    if (!planId) {
      send({ type: 'WAIVER_FAILED' });
      return;
    }
    fetch('/api/waiver-content', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planId }),
    })
      .then(r => r.json())
      .then((data) => {
        if (data.found) {
          send({ type: 'WAIVER_LOADED', content: data.content, templateName: data.templateName });
        }
        else {
          send({ type: 'WAIVER_FAILED' });
        }
      })
      .catch(() => send({ type: 'WAIVER_FAILED' }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.value]);

  // Pre-fill guardian info when entering commitment/waiver step (for child membership assignment)
  useEffect(() => {
    if (!state.matches('reviewingCommitment') || !initialMemberData) {
      return;
    }
    if (initialMemberData.guardianFirstName) {
      send({ type: 'UPDATE_FIELD', field: 'guardianFirstName', value: initialMemberData.guardianFirstName });
    }
    if (initialMemberData.guardianLastName) {
      send({ type: 'UPDATE_FIELD', field: 'guardianLastName', value: initialMemberData.guardianLastName });
    }
    if (initialMemberData.guardianEmail) {
      send({ type: 'UPDATE_FIELD', field: 'guardianEmail', value: initialMemberData.guardianEmail });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.value]);

  // Pre-fill child's contact info when entering collectingInfo (for child membership assignment)
  useEffect(() => {
    if (!state.matches('collectingInfo') || !initialMemberData || preseededRef.current) {
      return;
    }
    preseededRef.current = true;
    const d = initialMemberData;
    send({ type: 'UPDATE_FIELD', field: 'firstName', value: d.firstName });
    send({ type: 'UPDATE_FIELD', field: 'lastName', value: d.lastName });
    send({ type: 'UPDATE_FIELD', field: 'email', value: d.email });
    if (d.phone) {
      send({ type: 'UPDATE_FIELD', field: 'phoneNumber', value: formatPhoneForDisplay(sanitizePhoneInput(d.phone)) });
    }
    if (d.dateOfBirth) {
      send({ type: 'UPDATE_FIELD', field: 'dateOfBirth', value: d.dateOfBirth });
    }
    if (d.address) {
      send({ type: 'UPDATE_FIELD', field: 'address', value: d.address });
    }
    if (d.city) {
      send({ type: 'UPDATE_FIELD', field: 'city', value: d.city });
    }
    if (d.state) {
      send({ type: 'UPDATE_FIELD', field: 'state', value: d.state });
    }
    if (d.zip) {
      send({ type: 'UPDATE_FIELD', field: 'zip', value: d.zip });
    }
    // Set existing member ID and trial conversion ID so the payment route
    // updates this member instead of creating a new one
    send({ type: 'UPDATE_FIELD', field: 'existingMemberId', value: d.childMemberId });
    if (d.convertingTrialMembershipId) {
      send({ type: 'UPDATE_FIELD', field: 'convertingTrialMembershipId', value: d.convertingTrialMembershipId });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.value]);

  // Fetch tokenization config when entering payment step
  useEffect(() => {
    if (state.matches('collectingPayment') && !tokenizationConfig && !tokenizationError) {
      fetch('/api/payment/tokenization-config')
        .then(r => r.json())
        .then((data: { config: TokenizationIframeConfig }) => {
          if (data.config) {
            setTokenizationConfig(data.config);
          }
          else {
            setTokenizationError('Payment form unavailable');
          }
        })
        .catch(() => setTokenizationError('Failed to load payment form'));
    }
  }, [state, tokenizationConfig, tokenizationError]);

  const PLANS_PER_PAGE = 4;
  const totalPlanPages = Math.ceil((state.context.availablePlans?.length ?? 0) / PLANS_PER_PAGE);
  const visiblePlans = state.context.availablePlans.slice(
    planPage * PLANS_PER_PAGE,
    (planPage + 1) * PLANS_PER_PAGE,
  );

  // Reset plan page when plans change
  useEffect(() => {
    setPlanPage(0);
  }, [state.context.selectedProgram]);

  // Process payment when entering processingPayment state
  useEffect(() => {
    if (!state.matches('processingPayment')) {
      return;
    }

    const ctx = state.context;
    const planFrequency = ctx.selectedPlan?.interval === 'yearly' ? 'Annual' : 'Monthly';
    const isRecurring = !ctx.selectedPlan?.trialPeriodDays;

    // Use the dynamically fetched waiver content from the commitment screen
    const waiverContent = ctx.waiverContent || '';

    const paymentBody = {
      firstName: ctx.firstName,
      lastName: ctx.lastName,
      email: ctx.email,
      phone: ctx.phoneNumber,
      address: ctx.address,
      addressLine2: ctx.addressLine2,
      city: ctx.city,
      state: ctx.state,
      zip: ctx.zip,
      paymentMethod: ctx.paymentMethod,
      cardToken: ctx.cardToken || capturedTokenRef.current?.token || '',
      cardFirstSix: ctx.cardFirstSix || capturedTokenRef.current?.firstSix || '',
      cardLastFour: ctx.cardLastFour || capturedTokenRef.current?.lastFour || '',
      cardExpiry: ctx.cardExpiry,
      cardholderName: ctx.cardholderName,
      achAccountHolder: ctx.achAccountHolder,
      achRoutingNumber: ctx.achRoutingNumber,
      achAccountNumber: ctx.achAccountNumber,
      achAccountType: ctx.achAccountType,
      planId: ctx.selectedPlan?.id ?? '',
      planName: ctx.selectedPlan?.name ?? '',
      planPrice: ctx.selectedPlan?.price ?? 0,
      planFrequency,
      planContractLength: ctx.selectedPlan?.description?.split('\n')[0] ?? '',
      billingType: isRecurring ? 'autopay' : 'one-time',
      programName: ctx.selectedProgram?.name ?? '',
      dateOfBirth: ctx.dateOfBirth || undefined,
      guardianFirstName: ctx.guardianFirstName || undefined,
      guardianLastName: ctx.guardianLastName || undefined,
      guardianEmail: ctx.guardianEmail || undefined,
      guardianRelationship: ctx.guardianRelationship || undefined,
      waiverSignature: ctx.waiverSignature,
      signedByName: ctx.guardianFirstName
        ? `${ctx.guardianFirstName} ${ctx.guardianLastName}`
        : `${ctx.firstName} ${ctx.lastName}`,
      waiverContent,
      organizationName: '',
      organizationId: process.env.NEXT_PUBLIC_ORGANIZATION_ID ?? '',
      existingMemberId: ctx.existingMemberId,
      convertingTrialMembershipId: ctx.convertingTrialMembershipId,
    };

    fetch('/api/payment/membership', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(paymentBody),
    })
      .then(r => r.json())
      .then((data) => {
        if (data.success && data.status !== 'declined') {
          capturedTokenRef.current = null;
          send({ type: 'PAYMENT_SUCCESS' });
        }
        else {
          send({ type: 'PAYMENT_FAILED', error: data.error ?? 'Payment was declined' });
        }
      })
      .catch((err) => {
        send({ type: 'PAYMENT_FAILED', error: err instanceof Error ? err.message : 'Payment failed' });
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.value]);

  // Auto-return to home after success (60s countdown)
  useEffect(() => {
    if (!state.matches('success')) {
      return;
    }
    setSuccessCountdown(60);
    const interval = setInterval(() => {
      setSuccessCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.value]);

  // Navigate home once countdown reaches 0
  useEffect(() => {
    if (successCountdown === 0 && state.matches('success')) {
      onComplete();
    }
  }, [successCountdown, state, onComplete]);

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
      return 'Member Information';
    }
    if (state.matches('collectingPayment')) {
      return 'Payment';
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
      <KioskFlowHeader title={headerTitle()} onBack={onBack} />

      {/* Main content */}
      <main className="flex flex-1 items-start justify-center p-4 sm:p-6 md:p-8">

        {/* ── Step 1: Program selection ───────────────────────────────────────── */}
        {state.matches('selectingProgram') && (
          <div className="w-full max-w-4xl">
            <p className="mb-8 text-center text-xl text-gray-500">Choose the program you'd like to join</p>
            {state.context.isLoadingPrograms
              ? (
                  <p className="py-16 text-center text-xl text-gray-400">Loading programs...</p>
                )
              : state.context.programs.length === 0
                ? (
                    <p className="py-16 text-center text-xl text-gray-400">No programs available</p>
                  )
                : (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
                      {state.context.programs.map(prog => (
                        <button
                          type="button"
                          key={prog.id}
                          onClick={() => send({ type: 'SELECT_PROGRAM', program: prog })}
                          className="cursor-pointer rounded-3xl border-2 border-black bg-white p-6 text-left transition-all hover:scale-105 hover:bg-gray-50 sm:p-8 md:p-10"
                        >
                          <h2 className="text-xl font-bold text-black sm:text-2xl md:text-3xl">{prog.name}</h2>
                          <p className="mt-3 text-lg text-gray-500">{prog.description}</p>
                        </button>
                      ))}
                    </div>
                  )}
          </div>
        )}

        {/* ── Step 2: Plan selection ──────────────────────────────────────────── */}
        {state.matches('selectingPlan') && (
          <div className="w-full max-w-4xl">
            <p className="mb-6 text-center text-xl text-gray-500">Choose a plan that's right for you</p>

            <div className="mb-4 grid grid-cols-1 gap-6 sm:grid-cols-2">
              {visiblePlans.map(plan => (
                <button
                  type="button"
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
                    <p key={line || `line-${i}`} className={`${i === 0 ? 'mb-2 text-base text-gray-500' : 'text-base text-gray-600'}`}>{line}</p>
                  ))}
                </button>
              ))}
            </div>

            {/* Pagination */}
            {totalPlanPages > 1 && (
              <div className="mb-4 flex items-center justify-center gap-6">
                <button
                  type="button"
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
                  type="button"
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

                onClick={() => send({ type: 'SUBMIT_PAYMENT' })}
                disabled={!state.context.selectedPlan}
                className="cursor-pointer rounded-2xl border-2 border-black bg-white px-12 py-4 text-xl font-bold text-black transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:bg-gray-200"
              >
                Next →
              </button>
            </div>
            <StepIndicator current={0} total={4} />
          </div>
        )}

        {/* ── Step 4: Commitment / waiver ─────────────────────────────────────── */}
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
              <p className="mb-2 text-xl font-semibold text-black">
                {state.context.waiverTemplateName || 'Membership Agreement'}
              </p>
              <div className="h-52 overflow-y-auto rounded-2xl border border-gray-200 bg-gray-50 p-5 text-lg leading-relaxed text-gray-700">
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
              {state.context.waiverContent && (
                <p className="mt-2 text-right text-sm text-gray-400">Scroll to read full agreement</p>
              )}
            </div>

            {/* Guardian info for minors */}
            {memberIsMinor && (
              <div className="mt-4 rounded-2xl border-2 border-amber-200 bg-amber-50 p-5">
                <p className="mb-3 text-lg font-semibold text-amber-800">
                  Parent/Guardian Required
                </p>
                <p className="mb-4 text-base text-amber-700">
                  The member is under 18. A parent or legal guardian must sign the waiver on their behalf.
                </p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-semibold text-amber-800" htmlFor="guardianFirstName">
                      Guardian First Name
                      <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="guardianFirstName"
                      type="text"
                      value={state.context.guardianFirstName || ''}
                      onChange={e => handleInputChange('guardianFirstName', e.target.value)}
                      className="w-full rounded-xl border-2 border-amber-300 bg-white p-4 text-xl text-black placeholder:text-gray-400 focus:border-black focus:ring-2 focus:ring-black focus:outline-none"
                      placeholder="First name"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-semibold text-amber-800" htmlFor="guardianLastName">
                      Guardian Last Name
                      <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="guardianLastName"
                      type="text"
                      value={state.context.guardianLastName || ''}
                      onChange={e => handleInputChange('guardianLastName', e.target.value)}
                      className="w-full rounded-xl border-2 border-amber-300 bg-white p-4 text-xl text-black placeholder:text-gray-400 focus:border-black focus:ring-2 focus:ring-black focus:outline-none"
                      placeholder="Last name"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-semibold text-amber-800" htmlFor="guardianEmail">
                      Guardian Email
                      <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="guardianEmail"
                      type="email"
                      value={state.context.guardianEmail || ''}
                      onChange={e => handleInputChange('guardianEmail', e.target.value)}
                      className="w-full rounded-xl border-2 border-amber-300 bg-white p-4 text-xl text-black placeholder:text-gray-400 focus:border-black focus:ring-2 focus:ring-black focus:outline-none"
                      placeholder="guardian@email.com"
                    />
                  </div>
                  <KioskSelect
                    id="guardianRelationship"
                    value={state.context.guardianRelationship || 'parent'}
                    onChange={v => handleInputChange('guardianRelationship', v)}
                    label="Relationship"
                    options={[
                      { value: 'parent', label: 'Parent' },
                      { value: 'guardian', label: 'Guardian' },
                      { value: 'legal_guardian', label: 'Legal Guardian' },
                    ]}
                  />
                </div>
              </div>
            )}

            <div
              role="checkbox"
              aria-checked={!!state.context.hasAgreedToCommitment}
              tabIndex={0}
              className={`mt-4 flex cursor-pointer items-start gap-4 rounded-2xl border-2 p-5 transition-colors ${
                state.context.hasAgreedToCommitment ? 'border-black bg-gray-50' : 'border-gray-200 bg-white'
              } hover:bg-gray-50`}
              onClick={() => handleInputChange('hasAgreedToCommitment', !state.context.hasAgreedToCommitment)}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  handleInputChange('hasAgreedToCommitment', !state.context.hasAgreedToCommitment);
                }
              }}
            >
              <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded border-2 transition-colors ${
                state.context.hasAgreedToCommitment ? 'border-black bg-black' : 'border-gray-400'
              }`}
              >
                {state.context.hasAgreedToCommitment && (
                  <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
              <span className="text-lg text-black">
                {memberIsMinor
                  ? 'As the parent/guardian, I agree to the waiver and membership agreement on behalf of the minor.'
                  : 'I agree to the waiver, membership agreement, and authorize recurring billing as described.'}
              </span>
            </div>

            {/* Signature: show existing or capture new */}
            <div className="mt-4 mb-2">
              {state.context.waiverSignature?.startsWith('data:image/') && !wantsNewSignature
                ? (
                    <div>
                      <p className="mb-2 text-lg font-semibold text-black">Signature on File</p>
                      <div className="rounded-2xl border-2 border-gray-300 bg-white p-2">
                        <div
                          role="img"
                          aria-label="Existing signature"
                          className="h-32 w-full bg-contain bg-center bg-no-repeat sm:h-40"
                          style={{ backgroundImage: `url(${state.context.waiverSignature})` }}
                        />
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <p className="text-sm text-gray-400">Using signature from previous waiver</p>
                        <button
                          type="button"
                          onClick={() => {
                            setWantsNewSignature(true);
                            handleInputChange('waiverSignature', '');
                          }}
                          className="cursor-pointer text-sm font-semibold text-black transition-colors hover:text-gray-600"
                        >
                          Sign Again
                        </button>
                      </div>
                    </div>
                  )
                : (
                    <SignatureCapture
                      label={memberIsMinor ? 'Parent/Guardian Signature' : 'Signature'}
                      onSignatureChange={(dataUrl) => {
                        handleInputChange('waiverSignature', dataUrl ?? '');
                      }}
                    />
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
                onClick={() => send({ type: 'SUBMIT_COMMITMENT' })}
                disabled={
                  !state.context.hasAgreedToCommitment
                  || !state.context.waiverSignature?.trim()
                  || (memberIsMinor && (!state.context.guardianFirstName?.trim() || !state.context.guardianLastName?.trim() || !state.context.guardianEmail?.trim()))
                }
                className="cursor-pointer rounded-2xl border-2 border-black bg-white px-12 py-4 text-xl font-bold text-black transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:bg-gray-200"
              >
                Next →
              </button>
            </div>
            <StepIndicator current={2} total={4} />
          </div>
        )}

        {/* ── Step 3: Member info + order summary ─────────────────────────────── */}
        {(state.matches('collectingInfo') || state.matches('validatingContact') || state.matches('lookingUpMember')) && (
          <div className="w-full max-w-6xl">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-5 lg:gap-8">

              {/* Left: form */}
              <div className="lg:col-span-3">
                {/* Pre-seeded child membership banner */}
                {initialMemberData && (
                  <div className="mb-8 rounded-2xl border-2 border-amber-200 bg-amber-50 p-5">
                    <p className="text-lg font-semibold text-amber-900">
                      Assigning membership for
                      {' '}
                      {initialMemberData.firstName}
                      {' '}
                      {initialMemberData.lastName}
                    </p>
                    {initialMemberData.convertingTrialMembershipId && (
                      <p className="mt-1 text-sm text-amber-700">Converting from trial membership</p>
                    )}
                  </div>
                )}

                {/* Member lookup (hidden when pre-seeded) */}
                {!initialMemberData && (
                  <div className="mb-8 rounded-2xl border border-gray-200 bg-gray-50 p-5">
                    <p className="mb-3 text-base font-semibold tracking-wide text-gray-500 uppercase">
                      Already a member, or have a free trial?
                    </p>
                    <div className="flex gap-3">
                      <input
                        type="tel"
                        value={state.context.memberLookupPhone || ''}
                        onChange={e => handleInputChange('memberLookupPhone', e.target.value)}
                        placeholder="Phone number"
                        className="flex-1 rounded-xl border-2 border-gray-300 bg-white p-4 text-xl text-black placeholder:text-gray-400 focus:border-black focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => send({ type: 'LOOKUP_MEMBER' })}
                        disabled={state.matches('lookingUpMember') || !(state.context.memberLookupPhone?.replace(/\D/g, '').length >= 10)}
                        className="cursor-pointer rounded-xl border-2 border-black bg-black px-6 py-4 text-base font-bold text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {state.matches('lookingUpMember') ? 'Looking up…' : 'Look Up'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Member info form */}
                <p className="mb-4 text-lg font-semibold text-black">Member Information</p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                  <TouchDatePicker
                    value={state.context.dateOfBirth || ''}
                    onChange={v => handleInputChange('dateOfBirth', v)}
                    label="Date of Birth"
                    error={state.context.errors?.dateOfBirth}
                    placeholder="Select date of birth"
                  />
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
                    {state.context.errors?.zip && <p className="mt-1 text-base text-red-600">{state.context.errors.zip}</p>}
                  </div>
                </div>
              </div>
              {/* end left col */}

              {/* Right: order summary */}
              <div className="lg:col-span-2">
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
                    {state.context.waiverContent && (
                      <div className="h-40 overflow-y-auto rounded-xl border border-gray-200 bg-white p-4 text-sm leading-relaxed text-gray-600">
                        <p className="mb-1 font-semibold">{state.context.waiverTemplateName || 'Membership Agreement'}</p>
                        {state.context.waiverContent.split('\n').slice(0, 10).map((line, i) => {
                          const snippetKey = `s-${line.slice(0, 40).replace(/\s/g, '-')}-${i}`;
                          return <p key={snippetKey} className="mb-1">{line}</p>;
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
              {/* end right col */}

            </div>
            {/* end grid */}

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
                  || state.matches('lookingUpMember')
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
                className="cursor-pointer rounded-2xl border-2 border-black bg-black px-12 py-4 text-xl font-bold text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {state.context.isSubmitting ? 'Validating…' : 'Next →'}
              </button>
            </div>
            <StepIndicator current={1} total={4} />
          </div>
        )}

        {/* ── Step 5: Payment ────────────────────────────────────────────────── */}
        {state.matches('collectingPayment') && (
          <div className="w-full max-w-6xl">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-5 lg:gap-8">

              {/* Left: payment form */}
              <div className="lg:col-span-3">
                <p className="mb-6 text-lg font-semibold text-black">Payment Method</p>

                {/* Card / ACH toggle */}
                <div className="mb-6 flex gap-3">
                  <button
                    type="button"
                    onClick={() => handleInputChange('paymentMethod', 'card')}
                    className={`flex-1 cursor-pointer rounded-xl border-2 py-4 text-center text-lg font-bold transition-all ${
                      state.context.paymentMethod === 'card'
                        ? 'border-black bg-black text-white'
                        : 'border-gray-300 bg-white text-gray-500 hover:border-black'
                    }`}
                  >
                    Credit / Debit Card
                  </button>
                  <button
                    type="button"
                    onClick={() => handleInputChange('paymentMethod', 'ach')}
                    className={`flex-1 cursor-pointer rounded-xl border-2 py-4 text-center text-lg font-bold transition-all ${
                      state.context.paymentMethod === 'ach'
                        ? 'border-black bg-black text-white'
                        : 'border-gray-300 bg-white text-gray-500 hover:border-black'
                    }`}
                  >
                    Bank Account (ACH)
                  </button>
                </div>

                {/* Card fields */}
                {state.context.paymentMethod === 'card' && (
                  <div className="space-y-4">
                    <div>
                      <label className={labelClass} htmlFor="cardholderName">
                        Cardholder Name
                        <span className="text-red-500">*</span>
                      </label>
                      <input
                        id="cardholderName"
                        type="text"
                        value={state.context.cardholderName || ''}
                        onChange={e => handleInputChange('cardholderName', e.target.value)}
                        className={inputClass('cardholderName')}
                        placeholder="Name on card"
                      />
                    </div>
                    <div>
                      <p className={labelClass}>
                        Card Number
                        <span className="text-red-500">*</span>
                      </p>
                      {tokenizationError
                        ? (
                            <div className="rounded-xl border-2 border-red-300 bg-red-50 p-4 text-base text-red-600">
                              {tokenizationError}
                            </div>
                          )
                        : !tokenizationConfig
                            ? (
                                <div className="flex items-center gap-3 rounded-xl border-2 border-gray-300 bg-white p-4 text-lg text-gray-400">
                                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
                                  Loading card form...
                                </div>
                              )
                            : (
                                <>
                                  {!iframeLoaded && !iframeError && (
                                    <div className="flex items-center gap-3 rounded-xl border-2 border-gray-300 bg-white p-4 text-lg text-gray-400">
                                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
                                      Loading card form...
                                    </div>
                                  )}
                                  {iframeError && (
                                    <div className="rounded-xl border-2 border-red-300 bg-red-50 p-4 text-base text-red-600">
                                      {iframeError}
                                    </div>
                                  )}
                                  <div
                                    id={TOKENEX_CARD_ID}
                                    className={`w-full overflow-hidden rounded-xl border-2 border-gray-300 bg-white [&_iframe]:border-none ${!iframeLoaded && !iframeError ? 'hidden' : ''}`}
                                    style={{ height: '56px' }}
                                  />
                                </>
                              )}
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className={labelClass} htmlFor="cardExpiry">
                          Expiry (MM/YY)
                          <span className="text-red-500">*</span>
                        </label>
                        <input
                          id="cardExpiry"
                          type="text"
                          value={state.context.cardExpiry || ''}
                          onChange={e => handleInputChange('cardExpiry', e.target.value)}
                          className={inputClass('cardExpiry')}
                          placeholder="MM/YY"
                          maxLength={5}
                        />
                      </div>
                      <div>
                        <p className={labelClass}>
                          CVV
                          <span className="text-red-500">*</span>
                        </p>
                        {tokenizationConfig
                          ? (
                              <div
                                id={TOKENEX_CVV_ID}
                                className={`w-full overflow-hidden rounded-xl border-2 border-gray-300 bg-white [&_iframe]:border-none ${!iframeLoaded ? 'opacity-0' : ''}`}
                                style={{ height: '56px' }}
                              />
                            )
                          : (
                              <div className="h-14 rounded-xl border-2 border-gray-300 bg-white" />
                            )}
                      </div>
                    </div>
                  </div>
                )}

                {/* ACH fields */}
                {state.context.paymentMethod === 'ach' && (
                  <div className="space-y-4">
                    <div>
                      <label className={labelClass} htmlFor="achAccountHolder">
                        Account Holder Name
                        <span className="text-red-500">*</span>
                      </label>
                      <input
                        id="achAccountHolder"
                        type="text"
                        value={state.context.achAccountHolder || ''}
                        onChange={e => handleInputChange('achAccountHolder', e.target.value)}
                        className={inputClass('achAccountHolder')}
                        placeholder="Name on account"
                      />
                    </div>
                    <div>
                      <label className={labelClass} htmlFor="achRoutingNumber">
                        Routing Number
                        <span className="text-red-500">*</span>
                      </label>
                      <input
                        id="achRoutingNumber"
                        type="text"
                        value={state.context.achRoutingNumber || ''}
                        onChange={e => handleInputChange('achRoutingNumber', e.target.value)}
                        className={inputClass('achRoutingNumber')}
                        placeholder="9-digit routing number"
                      />
                    </div>
                    <div>
                      <label className={labelClass} htmlFor="achAccountNumber">
                        Account Number
                        <span className="text-red-500">*</span>
                      </label>
                      <input
                        id="achAccountNumber"
                        type="text"
                        value={state.context.achAccountNumber || ''}
                        onChange={e => handleInputChange('achAccountNumber', e.target.value)}
                        className={inputClass('achAccountNumber')}
                        placeholder="Account number"
                      />
                    </div>
                    <KioskSelect
                      id="achAccountType"
                      value={state.context.achAccountType || 'Checking'}
                      onChange={v => handleInputChange('achAccountType', v)}
                      label="Account Type"
                      required
                      options={[
                        { value: 'Checking', label: 'Checking' },
                        { value: 'Savings', label: 'Savings' },
                      ]}
                    />
                  </div>
                )}
              </div>

              {/* Right: order summary */}
              <div className="lg:col-span-2">
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
                        <span className="text-gray-600">Member</span>
                        <span className="font-semibold text-black">
                          {state.context.firstName}
                          {' '}
                          {state.context.lastName}
                        </span>
                      </div>
                    </div>
                    <div className="flex justify-between text-xl font-bold text-black">
                      <span>Total Due Today</span>
                      <span>{formatPlanPrice(state.context.selectedPlan)}</span>
                    </div>
                  </div>
                )}
              </div>

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
                disabled={state.context.isSubmitting || (isCardPayment ? (!tokenizationConfig || !iframeLoaded || !iframeValid || !iframeCvvValid || !state.context.cardholderName || !state.context.cardExpiry) : (!state.context.achAccountHolder || !state.context.achRoutingNumber || !state.context.achAccountNumber))}
                onClick={async () => {
                  if (isCardPayment && tokenizationConfig) {
                    try {
                      handleInputChange('isSubmitting', true as unknown as string);
                      const result = await iframeTokenize();
                      capturedTokenRef.current = {
                        token: result.token,
                        firstSix: result.firstSix ?? '',
                        lastFour: result.lastFour ?? '',
                      };
                      send({ type: 'UPDATE_FIELD', field: 'cardToken', value: result.token });
                      send({ type: 'UPDATE_FIELD', field: 'cardFirstSix', value: result.firstSix ?? '' });
                      send({ type: 'UPDATE_FIELD', field: 'cardLastFour', value: result.lastFour ?? '' });
                    }
                    catch (err) {
                      handleInputChange('isSubmitting', false as unknown as string);
                      console.error('Tokenization failed:', err);
                      return;
                    }
                  }
                  send({ type: 'SUBMIT_PAYMENT' });
                }}
                className="cursor-pointer rounded-2xl border-2 border-black bg-black px-12 py-4 text-xl font-bold text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {state.context.isSubmitting ? 'Processing...' : 'Complete Membership →'}
              </button>
            </div>
            <StepIndicator current={3} total={4} />
          </div>
        )}

        {/* ── Processing ──────────────────────────────────────────────────────── */}
        {state.matches('processingPayment') && (
          <div className="w-full max-w-xl py-16 text-center">
            <div className="mx-auto mb-8 h-20 w-20 animate-spin rounded-full border-4 border-gray-200 border-t-black" />
            <h2 className="mb-4 text-3xl font-bold text-black">
              Processing payment…
            </h2>
            <p className="text-xl text-gray-500">Please don't leave this screen</p>
          </div>
        )}

        {/* ── Success ─────────────────────────────────────────────────────────── */}
        {state.matches('success') && (
          <div className="w-full max-w-2xl py-8 text-center">
            <CheckCircleOutlineIcon sx={{ fontSize: 96 }} className="mb-6 text-black" />
            <h2 className="mb-4 text-2xl font-bold text-black sm:text-3xl md:text-4xl">Enrollment Successful!</h2>
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
                type="button"
                onClick={onComplete}
                className="flex-1 cursor-pointer rounded-2xl border-2 border-black bg-white px-8 py-5 text-xl font-bold text-black transition-colors hover:bg-gray-100"
              >
                Return Home
              </button>
              {onCheckIn && (
                <button
                  type="button"
                  onClick={onCheckIn}
                  className="flex-1 cursor-pointer rounded-2xl border-2 border-black bg-black px-8 py-5 text-xl font-bold text-white transition-colors hover:bg-gray-800"
                >
                  Check In Now
                </button>
              )}
            </div>
            <div className="mt-8 flex flex-col items-center gap-2">
              <div className="relative h-16 w-16">
                <svg className="-rotate-90" width="64" height="64" viewBox="0 0 64 64">
                  <circle cx="32" cy="32" r="28" fill="none" stroke="#e5e7eb" strokeWidth="4" />
                  <circle
                    cx="32"
                    cy="32"
                    r="28"
                    fill="none"
                    stroke="#000000"
                    strokeWidth="4"
                    strokeDasharray={`${2 * Math.PI * 28}`}
                    strokeDashoffset={`${2 * Math.PI * 28 * (1 - successCountdown / 60)}`}
                    strokeLinecap="round"
                    className="transition-all duration-1000"
                  />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-lg font-bold text-black">
                  {successCountdown}
                </span>
              </div>
              <p className="text-base text-gray-400">
                Returning to home in
                {' '}
                {successCountdown}
                {' '}
                second
                {successCountdown !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
        )}

        {/* ── Payment failed ──────────────────────────────────────────────────── */}
        {state.matches('paymentFailed') && (
          <div className="w-full max-w-2xl py-8 text-center">
            <div className="rounded-3xl border-2 border-red-200 bg-white p-6 sm:p-8 md:p-12">
              <h2 className="mb-4 text-2xl font-bold text-black sm:text-3xl md:text-4xl">Payment Failed</h2>
              <p className="mb-8 text-xl text-red-600">
                {Object.values(state.context.errors).join(' ') || 'There was an issue processing your payment.'}
              </p>
              <div className="flex gap-4">
                <button
                  type="button"

                  onClick={() => send({ type: 'TRY_AGAIN' })}
                  className="flex-1 cursor-pointer rounded-2xl border-2 border-black bg-white px-8 py-5 text-xl font-bold text-black transition-colors hover:bg-gray-100"
                >
                  Try Again
                </button>
                <button
                  type="button"

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
            <div className="rounded-3xl border-2 border-red-200 bg-white p-6 sm:p-8 md:p-12">
              <h2 className="mb-4 text-2xl font-bold text-black sm:text-3xl md:text-4xl">Something Went Wrong</h2>
              <p className="mb-8 text-xl text-red-600">
                {Object.values(state.context.errors).join(' ') || 'Please try again or ask a staff member for help.'}
              </p>
              <div className="flex gap-4">
                <button
                  type="button"

                  onClick={() => send({ type: 'TRY_AGAIN' })}
                  className="flex-1 cursor-pointer rounded-2xl border-2 border-black bg-white px-8 py-5 text-xl font-bold text-black transition-colors hover:bg-gray-100"
                >
                  Try Again
                </button>
                <button
                  type="button"

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
            <h2 className="mb-4 text-2xl font-bold text-black sm:text-3xl md:text-4xl">Session Timeout</h2>
            <p className="mb-4 text-xl text-orange-600">For security, your session has timed out.</p>
            <p className="text-lg text-gray-500">Returning to home screen…</p>
          </div>
        )}

      </main>

      {/* Multi-member lookup picker overlay */}
      {showLookupPicker && lookupResults.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl sm:p-8">
            <h3 className="mb-2 text-center text-2xl font-bold text-black">
              {lookupResults.length}
              {' '}
              Members Found
            </h3>
            <p className="mb-6 text-center text-lg text-gray-500">Select who is signing up</p>
            <div className="space-y-3">
              {lookupResults.map(m => (
                <button
                  key={m.memberId}
                  type="button"
                  onClick={() => handlePickLookupResult(m)}
                  className="flex w-full cursor-pointer items-center justify-between rounded-2xl border-2 border-gray-200 px-6 py-5 text-left transition-all hover:border-black hover:bg-gray-50 active:scale-95"
                >
                  <div>
                    <p className="text-xl font-bold text-black">
                      {m.firstName}
                      {' '}
                      {m.lastName}
                    </p>
                    <p className="text-sm text-gray-400 capitalize">{m.memberType.replace(/-/g, ' ')}</p>
                  </div>
                  <span className={`rounded-lg px-3 py-1 text-sm font-semibold capitalize ${
                    m.status === 'active'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-gray-100 text-gray-600'
                  }`}
                  >
                    {m.status}
                  </span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                setShowLookupPicker(false);
                setLookupResults([]);
              }}
              className="mt-6 min-h-14 w-full cursor-pointer rounded-2xl border-2 border-gray-200 text-lg font-bold text-gray-500 transition-all hover:bg-gray-50 active:scale-95"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

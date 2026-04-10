'use client';

import type { CheckinClass, CheckinMember } from '../../machines/types';
import { useEffect, useState } from 'react';
import { useCheckinMachine } from '../../hooks/useKioskMachines';
import { formatPhoneForDisplay, sanitizePhoneInput } from '../../lib/utils';
import { KioskFlowHeader } from '../KioskFlowHeader';
import { StepIndicator } from '../StepIndicator';

interface PreseededMember {
  memberId: string;
  firstName: string;
  lastName: string;
}

interface CheckinFlowProps {
  onComplete: () => void;
  onBack: () => void;
  onSignUp?: () => void;
  preseededMembers?: PreseededMember[];
}

function formatTime(time24: string): string {
  const [hStr, mStr] = time24.split(':');
  let h = Number.parseInt(hStr ?? '0', 10);
  const m = mStr ?? '00';
  const ampm = h >= 12 ? 'PM' : 'AM';
  if (h > 12) {
    h -= 12;
  }
  if (h === 0) {
    h = 12;
  }
  return `${h}:${m} ${ampm}`;
}

export function CheckinFlow({ onComplete, onBack, onSignUp, preseededMembers }: CheckinFlowProps) {
  const [state, send] = useCheckinMachine();
  const [phoneInput, setPhoneInput] = useState('');

  // If the caller supplied already-known members (e.g. from a just-created trial),
  // skip the phone lookup and jump straight to member selection / class selection.
  useEffect(() => {
    if (!preseededMembers || preseededMembers.length === 0) {
      return;
    }
    send({
      type: 'MEMBERS_FOUND',
      members: preseededMembers.map(m => ({
        memberId: m.memberId,
        firstName: m.firstName,
        lastName: m.lastName,
        status: 'trial',
      })),
    });
  }, [preseededMembers, send]);

  const handlePhoneChange = (value: string) => {
    const cleaned = sanitizePhoneInput(value);
    if (cleaned.length <= 10) {
      setPhoneInput(formatPhoneForDisplay(cleaned));
    }
  };

  const handlePhoneSubmit = () => {
    const cleaned = sanitizePhoneInput(phoneInput);
    send({ type: 'ENTER_PHONE', phoneNumber: cleaned });
  };

  const isLookingUp = state.matches('lookingUp');
  const isSelectingMember = state.matches('selectingMember');
  const isLoadingClasses = state.matches('loadingClasses');
  const isProcessingCheckin = state.matches('processingCheckin');
  const isCheckinComplete = state.matches('checkinComplete');
  const { phoneNumber, members, selectedMember, selectedClass } = state.context;

  // Fetch members when entering lookingUp state
  useEffect(() => {
    if (!isLookingUp) {
      return;
    }
    fetch('/api/members/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: phoneNumber }),
    })
      .then(r => r.json())
      .then((data) => {
        if (data.found && data.members?.length > 0) {
          send({ type: 'MEMBERS_FOUND', members: data.members });
        }
        else {
          send({ type: 'MEMBER_NOT_FOUND' });
        }
      })
      .catch(() => {
        send({ type: 'MEMBER_NOT_FOUND' });
      });
  }, [isLookingUp, phoneNumber, send]);

  // Auto-select if only one member found
  useEffect(() => {
    if (isSelectingMember && members.length === 1) {
      const first = members[0];
      if (first) {
        send({ type: 'SELECT_MEMBER', member: first });
      }
    }
  }, [isSelectingMember, members, send]);

  // Fetch today's classes when entering loadingClasses state
  useEffect(() => {
    if (!isLoadingClasses || !selectedMember) {
      return;
    }
    fetch(`/api/classes/today?memberId=${encodeURIComponent(selectedMember.memberId)}`)
      .then(r => r.json())
      .then((data) => {
        const status = data.membershipStatus;
        if (status === 'no_membership' || status === 'inactive' || status === 'no_access') {
          send({ type: 'NO_ACTIVE_MEMBERSHIP', message: data.message ?? 'No active membership found.' });
        }
        else {
          send({ type: 'CLASSES_LOADED', classes: data.classes ?? [] });
        }
      })
      .catch(() => {
        send({ type: 'CLASSES_LOADED', classes: [] });
      });
  }, [isLoadingClasses, selectedMember, send]);

  // Process check-in when entering processingCheckin state
  useEffect(() => {
    if (!isProcessingCheckin || !selectedMember || !selectedClass) {
      return;
    }
    fetch('/api/checkin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        memberId: selectedMember.memberId,
        classScheduleInstanceId: selectedClass.scheduleId,
      }),
    })
      .then(r => r.json())
      .then((data) => {
        if (data.success) {
          send({ type: 'CHECKIN_SUCCESS' });
        }
        else {
          send({ type: 'CHECKIN_FAILED', error: data.error });
        }
      })
      .catch((err) => {
        send({ type: 'CHECKIN_FAILED', error: err instanceof Error ? err.message : 'Check-in failed' });
      });
  }, [isProcessingCheckin, selectedMember, selectedClass, send]);

  // Auto-complete after success
  useEffect(() => {
    if (!isCheckinComplete) {
      return;
    }
    const timer = setTimeout(onComplete, 5000);
    return () => clearTimeout(timer);
  }, [isCheckinComplete, onComplete]);

  const headerTitle = () => {
    if (state.matches('idle') || state.matches('lookingUp')) {
      return 'Step 1: Find Member';
    }
    if (state.matches('selectingMember')) {
      return 'Step 1: Select Member';
    }
    if (state.matches('loadingClasses') || state.matches('selectingClass')) {
      return 'Step 2: Select Class';
    }
    if (state.matches('processingCheckin')) {
      return 'Checking In...';
    }
    if (state.matches('checkinComplete')) {
      return 'Checked In!';
    }
    return 'Member Check-In';
  };

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <KioskFlowHeader
        title={headerTitle()}
        onBack={() => {
          if (state.matches('selectingClass') || state.matches('loadingClasses')) {
            send({ type: 'BACK' });
          }
          else {
            onBack();
          }
        }}
      />

      {/* Main Content */}
      <main className="flex flex-1 items-center justify-center p-4 sm:p-6 md:p-8">
        <div className="w-full max-w-2xl">

          {/* ── Step 1: Enter Phone ── */}
          {state.matches('idle') && (
            <div className="w-full max-w-2xl">
              <div className="rounded-3xl border-2 border-black bg-white p-6 text-center sm:p-8 md:p-12">
                <h2 className="mb-6 text-2xl font-bold text-black sm:text-3xl md:text-4xl">
                  Enter Your Phone Number
                </h2>
                <p className="mb-8 text-xl text-gray-500">
                  We'll look up your membership
                </p>
                <div className="space-y-6">
                  <input
                    type="tel"
                    value={phoneInput}
                    onChange={e => handlePhoneChange(e.target.value)}
                    placeholder="(555) 123-4567"
                    className="w-full rounded-2xl border-2 border-gray-300 bg-white p-4 text-center text-xl text-black placeholder:text-gray-400 focus:border-black focus:outline-none sm:p-5 sm:text-2xl md:p-6 md:text-3xl"
                  />
                  <button
                    type="button"
                    onClick={handlePhoneSubmit}
                    disabled={sanitizePhoneInput(phoneInput).length !== 10}
                    className="min-h-14 w-full cursor-pointer rounded-2xl bg-black px-8 py-4 text-lg font-bold text-white transition-all hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-16 sm:py-5 sm:text-xl md:min-h-20 md:py-6 md:text-2xl"
                  >
                    Find Member
                  </button>
                </div>
              </div>
              <StepIndicator current={0} total={3} />
            </div>
          )}

          {/* ── Loading: Looking up member ── */}
          {state.matches('lookingUp') && (
            <div className="rounded-3xl border-2 border-black bg-white p-6 text-center sm:p-8 md:p-12">
              <div className="mx-auto mb-6 h-16 w-16 animate-spin rounded-full border-4 border-gray-200 border-t-black" />
              <h2 className="text-2xl font-bold text-black sm:text-3xl">
                Looking up your information...
              </h2>
            </div>
          )}

          {/* ── Step 1b: Select member (multiple matches) ── */}
          {state.matches('selectingMember') && state.context.members.length > 1 && (
            <div className="w-full max-w-2xl">
              <div className="rounded-3xl border-2 border-black bg-white p-6 sm:p-8 md:p-12">
                <h2 className="mb-2 text-center text-2xl font-bold text-black sm:text-3xl">
                  Who's checking in?
                </h2>
                <p className="mb-8 text-center text-lg text-gray-500">Select your name</p>
                <div className="space-y-3">
                  {state.context.members.map((m: CheckinMember) => (
                    <button
                      key={m.memberId}
                      type="button"
                      onClick={() => send({ type: 'SELECT_MEMBER', member: m })}
                      className="flex w-full cursor-pointer items-center justify-between rounded-2xl border-2 border-gray-200 px-6 py-5 text-left transition-all hover:border-black hover:bg-gray-50 active:scale-95"
                    >
                      <p className="text-xl font-bold text-black">
                        {m.firstName}
                        {' '}
                        {m.lastName}
                      </p>
                      <span className={`rounded-lg px-3 py-1 text-sm font-semibold capitalize ${
                        m.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                      }`}
                      >
                        {m.status}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              <StepIndicator current={0} total={3} />
            </div>
          )}

          {/* ── Loading: Fetching classes ── */}
          {state.matches('loadingClasses') && (
            <div className="rounded-3xl border-2 border-black bg-white p-6 text-center sm:p-8 md:p-12">
              <div className="mx-auto mb-6 h-16 w-16 animate-spin rounded-full border-4 border-gray-200 border-t-black" />
              <h2 className="text-2xl font-bold text-black sm:text-3xl">
                Loading today's classes...
              </h2>
            </div>
          )}

          {/* ── Step 2: Select class ── */}
          {state.matches('selectingClass') && (
            <div className="w-full max-w-2xl">
              <div className="rounded-3xl border-2 border-black bg-white p-6 sm:p-8 md:p-12">
                <h2 className="mb-2 text-center text-2xl font-bold text-black sm:text-3xl">
                  Welcome,
                  {' '}
                  {state.context.selectedMember?.firstName}
                  !
                </h2>
                <p className="mb-8 text-center text-lg text-gray-500">
                  Which class are you here for?
                </p>

                {state.context.classes.length > 0
                  ? (
                      <div className="space-y-3">
                        {state.context.classes.map((c: CheckinClass) => (
                          <button
                            key={c.scheduleId}
                            type="button"
                            onClick={() => send({ type: 'SELECT_CLASS', classItem: c })}
                            className="flex w-full cursor-pointer items-center justify-between rounded-2xl border-2 border-gray-200 px-6 py-5 text-left transition-all hover:border-black hover:bg-gray-50 active:scale-95"
                          >
                            <div>
                              <p className="text-xl font-bold text-black">{c.className}</p>
                              <p className="text-sm text-gray-400">
                                {formatTime(c.startTime)}
                                {' '}
                                –
                                {' '}
                                {formatTime(c.endTime)}
                                {c.room ? ` · ${c.room}` : ''}
                              </p>
                            </div>
                            <span className="text-lg font-semibold text-black">Check In →</span>
                          </button>
                        ))}
                      </div>
                    )
                  : (
                      <div className="py-8 text-center">
                        <p className="text-xl text-gray-400">No classes scheduled for today.</p>
                        <p className="mt-2 text-gray-400">Please ask a staff member for help.</p>
                      </div>
                    )}
              </div>
              <StepIndicator current={1} total={3} />
            </div>
          )}

          {/* ── Processing check-in ── */}
          {state.matches('processingCheckin') && (
            <div className="rounded-3xl border-2 border-black bg-white p-6 text-center sm:p-8 md:p-12">
              <div className="mx-auto mb-6 h-16 w-16 animate-spin rounded-full border-4 border-gray-200 border-t-black" />
              <h2 className="text-2xl font-bold text-black sm:text-3xl">
                Checking you in...
              </h2>
            </div>
          )}

          {/* ── Success ── */}
          {state.matches('checkinComplete') && (
            <div className="w-full max-w-2xl">
              <div className="rounded-3xl border-2 border-black bg-white p-6 text-center sm:p-8 md:p-12">
                <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-green-100">
                  <span className="text-5xl text-green-600">✓</span>
                </div>
                <h2 className="mb-4 text-2xl font-bold text-black sm:text-3xl md:text-4xl">
                  You're checked in!
                </h2>
                {state.context.selectedClass && (
                  <p className="mb-2 text-xl text-gray-600">
                    {state.context.selectedClass.className}
                    {' '}
                    ·
                    {' '}
                    {formatTime(state.context.selectedClass.startTime)}
                  </p>
                )}
                <p className="text-lg text-gray-500">
                  Have a great class,
                  {' '}
                  {state.context.selectedMember?.firstName}
                  !
                </p>
                <p className="mt-6 text-gray-400">Returning to home screen...</p>
              </div>
              <StepIndicator current={2} total={3} />
            </div>
          )}

          {/* ── Not found ── */}
          {/* ── No Active Membership ── */}
          {state.matches('noMembership') && (
            <div className="rounded-3xl border-2 border-amber-300 bg-amber-50 p-6 text-center sm:p-8 md:p-12">
              <h2 className="mb-6 text-2xl font-bold text-black sm:text-3xl md:text-4xl">
                Membership Required
              </h2>
              <p className="mb-8 text-xl text-gray-600">
                {state.context.errors.general || 'No active membership found. Please sign up for a membership to check in.'}
              </p>
              <div className="space-y-4">
                <button
                  type="button"
                  onClick={() => send({ type: 'TRY_AGAIN' })}
                  className="min-h-14 w-full cursor-pointer rounded-2xl bg-black px-8 py-4 text-lg font-bold text-white transition-all hover:scale-105 active:scale-95"
                >
                  Try Again
                </button>
                {onSignUp && (
                  <button
                    type="button"
                    onClick={onSignUp}
                    className="min-h-14 w-full cursor-pointer rounded-2xl border-2 border-black bg-white px-8 py-4 text-lg font-bold text-black transition-all hover:scale-105 active:scale-95"
                  >
                    Sign Up for Membership
                  </button>
                )}
                <button
                  type="button"
                  onClick={onBack}
                  className="w-full cursor-pointer rounded-2xl border-2 border-gray-300 px-8 py-4 text-xl text-gray-600 transition-all hover:bg-gray-50 active:scale-95"
                >
                  Back to Home
                </button>
              </div>
            </div>
          )}

          {state.matches('notFound') && (
            <div className="rounded-3xl border-2 border-black bg-white p-6 text-center sm:p-8 md:p-12">
              <h2 className="mb-6 text-2xl font-bold text-black sm:text-3xl md:text-4xl">
                Member Not Found
              </h2>
              <p className="mb-8 text-xl text-gray-500">
                No member found with that phone number. Please check and try again.
              </p>
              <div className="space-y-4">
                <button
                  type="button"
                  onClick={() => send({ type: 'TRY_AGAIN' })}
                  className="min-h-14 w-full cursor-pointer rounded-2xl bg-black px-8 py-4 text-lg font-bold text-white transition-all hover:scale-105 active:scale-95"
                >
                  Try Again
                </button>
                <button
                  type="button"
                  onClick={onBack}
                  className="w-full cursor-pointer rounded-2xl border-2 border-gray-300 px-8 py-4 text-xl text-gray-600 transition-all hover:bg-gray-50 active:scale-95"
                >
                  Back to Home
                </button>
              </div>
            </div>
          )}

          {/* ── Error ── */}
          {state.matches('error') && (
            <div className="rounded-3xl border-2 border-black bg-white p-6 text-center sm:p-8 md:p-12">
              <h2 className="mb-6 text-2xl font-bold text-black sm:text-3xl md:text-4xl">
                Check-In Failed
              </h2>
              <p className="mb-8 text-xl text-red-500">
                {state.context.errors.general || 'Something went wrong. Please try again.'}
              </p>
              <button
                type="button"
                onClick={() => send({ type: 'TRY_AGAIN' })}
                className="min-h-14 w-full cursor-pointer rounded-2xl bg-black px-8 py-4 text-lg font-bold text-white transition-all hover:scale-105 active:scale-95"
              >
                Try Again
              </button>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}

'use client';

import { use, useEffect, useState } from 'react';
import { OrgContext } from '@/lib/useOrgContext';
import { MemberNav } from './MemberNav';

interface ClassData {
  scheduleId: string;
  classId: string;
  className: string;
  startTime: string;
  endTime: string;
  room: string | null;
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

export function MemberCheckin() {
  const org = use(OrgContext);
  const [classes, setClasses] = useState<ClassData[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkingIn, setCheckingIn] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/member-portal/me/checkin')
      .then(r => r.json())
      .then((data) => {
        setClasses(data.classes ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleCheckin = async (scheduleId: string, className: string) => {
    setCheckingIn(scheduleId);
    setError('');
    try {
      const res = await fetch('/api/member-portal/me/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classScheduleInstanceId: scheduleId }),
      });
      const data = await res.json();
      if (data.success) {
        setSuccess(className);
      }
      else {
        setError(data.error ?? 'Check-in failed');
      }
    }
    catch {
      setError('Check-in failed');
    }
    setCheckingIn(null);
  };

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="bg-black p-6">
        <h1 className="text-center text-2xl font-bold text-white">{org?.orgName ?? 'Check In'}</h1>
      </header>
      <MemberNav />
      <main className="mx-auto w-full max-w-2xl flex-1 p-6">
        {success
          ? (
              <div className="py-16 text-center">
                <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-green-100">
                  <span className="text-5xl text-green-600">✓</span>
                </div>
                <h2 className="mb-2 text-2xl font-bold text-black">Checked In!</h2>
                <p className="mb-6 text-lg text-gray-500">{success}</p>
                <button
                  type="button"
                  onClick={() => setSuccess(null)}
                  className="cursor-pointer rounded-xl bg-black px-8 py-3 font-bold text-white transition-all hover:scale-105"
                >
                  Done
                </button>
              </div>
            )
          : (
              <>
                <h2 className="mb-6 text-xl font-bold text-black">Today's Classes</h2>

                {error && <p className="mb-4 text-red-500">{error}</p>}

                {loading
                  ? <p className="py-16 text-center text-gray-500">Loading...</p>
                  : classes.length === 0
                    ? <p className="py-16 text-center text-gray-400">No classes scheduled for today.</p>
                    : (
                        <div className="space-y-3">
                          {classes.map(c => (
                            <button
                              key={c.scheduleId}
                              type="button"
                              onClick={() => handleCheckin(c.scheduleId, c.className)}
                              disabled={checkingIn === c.scheduleId}
                              className="flex w-full cursor-pointer items-center justify-between rounded-2xl border-2 border-gray-200 px-6 py-5 text-left transition-all hover:border-black hover:bg-gray-50 active:scale-95 disabled:opacity-50"
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
                              <span className="text-lg font-semibold text-black">
                                {checkingIn === c.scheduleId ? '...' : 'Check In →'}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
              </>
            )}
      </main>
    </div>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { use, useState } from 'react';
import { OrgContext } from '@/lib/useOrgContext';

export function PhoneEntry() {
  const router = useRouter();
  const org = use(OrgContext);
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const formatPhone = (digits: string) => {
    const d = digits.replace(/\D/g, '').slice(0, 10);
    if (d.length <= 3) {
      return d;
    }
    if (d.length <= 6) {
      return `(${d.slice(0, 3)}) ${d.slice(3)}`;
    }
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  };

  const digits = phone.replace(/\D/g, '');

  const handleSubmit = async () => {
    if (digits.length !== 10 || !org) {
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/member-portal/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: digits, orgSlug: org.orgSlug }),
      });
      const data = await res.json();

      if (!data.found || !data.members?.length) {
        setError(data.error ?? 'No member found with this phone number.');
        setLoading(false);
        return;
      }

      // Store lookup result for the verify page
      const memberId = data.members[0].id;
      sessionStorage.setItem('mp_memberId', memberId);
      sessionStorage.setItem('mp_orgId', data.orgId);
      sessionStorage.setItem('mp_phone', digits);

      // Send OTP
      const otpRes = await fetch('/api/member-portal/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId }),
      });
      const otpData = await otpRes.json();

      if (otpRes.status === 429) {
        setError('Too many attempts. Please wait a few minutes.');
        setLoading(false);
        return;
      }

      if (otpData.sent) {
        sessionStorage.setItem('mp_maskedEmail', otpData.maskedEmail ?? '');
        router.push(`/${org.orgSlug}/verify`);
      }
      else {
        setError(otpData.error ?? 'Failed to send verification code.');
      }
    }
    catch {
      setError('Something went wrong. Please try again.');
    }
    setLoading(false);
  };

  const handleDigit = (d: string) => {
    if (digits.length < 10) {
      setPhone(formatPhone(digits + d));
      setError('');
    }
  };

  const handleBackspace = () => {
    if (digits.length > 0) {
      setPhone(formatPhone(digits.slice(0, -1)));
      setError('');
    }
  };

  const numpad = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'];

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-white p-6">
      <div className="w-full max-w-sm">
        <h1 className="mb-2 text-center text-3xl font-bold text-black">
          {org?.orgName ?? 'Member Portal'}
        </h1>
        <p className="mb-8 text-center text-lg text-gray-500">
          Enter your phone number to sign in
        </p>

        {/* Phone display */}
        <div className="mb-6 rounded-2xl border-2 border-gray-200 bg-gray-50 px-6 py-4 text-center">
          <span className={`text-2xl font-bold ${digits.length > 0 ? 'text-black' : 'text-gray-400'}`}>
            {digits.length > 0 ? formatPhone(digits) : '(555) 123-4567'}
          </span>
        </div>

        {error && <p className="mb-4 text-center text-red-500">{error}</p>}

        {/* Numpad */}
        <div className="mb-6 grid grid-cols-3 gap-3">
          {numpad.map((d, i) => {
            if (d === '') {
              return <div key={`pad-empty-${String(i)}`} />;
            }
            if (d === 'back') {
              return (
                <button
                  key="pad-back"
                  type="button"
                  onClick={handleBackspace}
                  disabled={loading}
                  className="flex min-h-14 cursor-pointer items-center justify-center rounded-2xl bg-gray-100 text-xl font-bold text-gray-600 transition-all active:scale-95 disabled:opacity-50"
                >
                  ←
                </button>
              );
            }
            return (
              <button
                key={`pad-${d}`}
                type="button"
                onClick={() => handleDigit(d)}
                disabled={loading || digits.length >= 10}
                className="flex min-h-14 cursor-pointer items-center justify-center rounded-2xl bg-gray-100 text-2xl font-bold text-black transition-all hover:bg-gray-200 active:scale-95 disabled:opacity-50"
              >
                {d}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={digits.length !== 10 || loading}
          className="min-h-14 w-full cursor-pointer rounded-2xl bg-black py-4 text-lg font-bold text-white transition-all hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'Sending code...' : 'Continue'}
        </button>
      </div>
    </div>
  );
}

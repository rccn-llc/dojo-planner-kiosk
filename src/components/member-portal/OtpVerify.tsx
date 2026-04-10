'use client';

import { useRouter } from 'next/navigation';
import { use, useEffect, useState } from 'react';
import { OrgContext } from '@/lib/useOrgContext';

export function OtpVerify() {
  const router = useRouter();
  const org = use(OrgContext);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [memberId, setMemberId] = useState('');
  const [orgId, setOrgId] = useState('');

  useEffect(() => {
    setMaskedEmail(sessionStorage.getItem('mp_maskedEmail') ?? '');
    setMemberId(sessionStorage.getItem('mp_memberId') ?? '');
    setOrgId(sessionStorage.getItem('mp_orgId') ?? '');
  }, []);

  const handleVerify = async (fullCode: string) => {
    if (fullCode.length !== 6 || !memberId) {
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/member-portal/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId, code: fullCode, orgId }),
      });
      const data = await res.json();

      if (data.verified) {
        // Clear session storage
        sessionStorage.removeItem('mp_memberId');
        sessionStorage.removeItem('mp_orgId');
        sessionStorage.removeItem('mp_phone');
        sessionStorage.removeItem('mp_maskedEmail');

        router.push(`/${org?.orgSlug ?? ''}/dashboard`);
      }
      else {
        setError(data.error ?? 'Invalid code. Please try again.');
        setCode('');
      }
    }
    catch {
      setError('Verification failed. Please try again.');
      setCode('');
    }
    setLoading(false);
  };

  const handleDigit = (d: string) => {
    if (code.length < 6) {
      const newCode = code + d;
      setCode(newCode);
      setError('');

      if (newCode.length === 6) {
        handleVerify(newCode);
      }
    }
  };

  const handleBackspace = () => {
    setCode(code.slice(0, -1));
    setError('');
  };

  const numpad = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'];

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-white p-6">
      <div className="w-full max-w-sm">
        <h1 className="mb-2 text-center text-3xl font-bold text-black">
          Enter Verification Code
        </h1>
        <p className="mb-8 text-center text-lg text-gray-500">
          We sent a 6-digit code to
          {' '}
          {maskedEmail || 'your email'}
        </p>

        {/* Code display */}
        <div className="mb-6 flex justify-center gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={`otp-${String(i)}`}
              className={`flex h-14 w-12 items-center justify-center rounded-xl border-2 text-2xl font-bold ${
                code[i]
                  ? 'border-black bg-gray-50 text-black'
                  : 'border-gray-200 text-gray-300'
              }`}
            >
              {code[i] ?? '·'}
            </div>
          ))}
        </div>

        {error && <p className="mb-4 text-center text-red-500">{error}</p>}
        {loading && <p className="mb-4 text-center text-gray-500">Verifying...</p>}

        {/* Numpad */}
        <div className="mb-6 grid grid-cols-3 gap-3">
          {numpad.map((d, i) => {
            if (d === '') {
              return <div key={`otp-pad-empty-${String(i)}`} />;
            }
            if (d === 'back') {
              return (
                <button
                  key="otp-back"
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
                key={`otp-${d}`}
                type="button"
                onClick={() => handleDigit(d)}
                disabled={loading || code.length >= 6}
                className="flex min-h-14 cursor-pointer items-center justify-center rounded-2xl bg-gray-100 text-2xl font-bold text-black transition-all hover:bg-gray-200 active:scale-95 disabled:opacity-50"
              >
                {d}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => {
            if (org) {
              router.push(`/${org.orgSlug}`);
            }
          }}
          className="w-full cursor-pointer text-center text-lg text-gray-500 transition-colors hover:text-black"
        >
          ← Back
        </button>
      </div>
    </div>
  );
}

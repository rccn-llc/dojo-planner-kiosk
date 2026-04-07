'use client';

import type { MemberEditFormErrors } from '../../lib/validation';
import type { ChildMembershipSeed } from './MembershipFlow';
import EditIcon from '@mui/icons-material/Edit';
import EmailIcon from '@mui/icons-material/Email';
import SaveIcon from '@mui/icons-material/Save';

import { useState } from 'react';
import { validateMemberEditForm } from '../../lib/validation';
import { KioskFlowHeader } from '../KioskFlowHeader';
import { KioskSelect } from '../KioskSelect';
import { TouchDatePicker } from '../TouchDatePicker';

interface MemberAreaFlowProps {
  onComplete: () => void;
  onBack: () => void;
  onAssignChildMembership?: (seed: ChildMembershipSeed) => void;
}

interface MemberResult {
  memberId: string;
  firstName: string;
  lastName: string;
  status: string;
  memberType: string;
}

interface AddressData {
  id: string;
  type: string;
  street: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  country: string | null;
  isDefault: boolean | null;
}

interface MembershipData {
  id: string;
  status: string;
  billingType: string | null;
  startDate: string | null;
  nextPaymentDate: string | null;
  planName: string;
  planCategory: string | null;
  planPrice: number;
  planFrequency: string | null;
  planContractLength: string | null;
  isTrial: boolean;
}

interface WaiverData {
  id: string;
  membershipPlanName: string | null;
  signedByName: string | null;
  signedAt: string | null;
}

interface TransactionData {
  id: string;
  transactionType: string | null;
  amount: number;
  status: string;
  paymentMethod: string | null;
  description: string | null;
  processedAt: string | null;
  createdAt: string | null;
  memberName: string | null;
}

interface FamilyMemberData {
  id: string;
  firstName: string;
  lastName: string;
  status: string;
  memberType: string;
  relationship: string;
  isHOH: boolean;
}

interface AttendanceData {
  id: string;
  attendanceDate: string | null;
  checkInTime: string | null;
  checkInMethod: string | null;
  className: string | null;
  startTime: string | null;
  endTime: string | null;
  room: string | null;
}

interface MemberDetail {
  member: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
    status: string;
    memberType: string;
    dateOfBirth: string | null;
    createdAt: string | null;
  };
  addresses: AddressData[];
  memberships: MembershipData[];
  waivers: WaiverData[];
  transactions: TransactionData[];
  attendance: AttendanceData[];
}

type View = 'search' | 'results' | 'otpVerify' | 'memberDetail' | 'addFamily' | 'createFamily';
type DetailTab = 'overview' | 'billing' | 'waivers' | 'attendance' | 'family';

export function MemberAreaFlow({ onBack, onAssignChildMembership }: MemberAreaFlowProps) {
  const [view, setView] = useState<View>('search');
  const [otpCode, setOtpCode] = useState('');
  const [otpError, setOtpError] = useState('');
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpMember, setOtpMember] = useState<{ memberId: string; firstName: string; emailHint: string } | null>(null);
  const [searchPhone, setSearchPhone] = useState('');
  const [searchName, setSearchName] = useState('');
  const [results, setResults] = useState<MemberResult[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [memberDetail, setMemberDetail] = useState<MemberDetail | null>(null);
  const [familyMembers, setFamilyMembers] = useState<FamilyMemberData[]>([]);
  const [activeTab, setActiveTab] = useState<DetailTab>('overview');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Track the parent member's info when navigating to a child's profile
  const [parentContext, setParentContext] = useState<{
    firstName: string;
    lastName: string;
    email: string;
  } | null>(null);

  // Edit member
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    dateOfBirth: '',
    street: '',
    city: '',
    state: '',
    zipCode: '',
    country: 'US',
  });
  const [saving, setSaving] = useState(false);
  const [editErrors, setEditErrors] = useState<MemberEditFormErrors>({});

  // Waiver email
  const [sendingWaiverId, setSendingWaiverId] = useState<string | null>(null);

  // Add family member
  const [familySearchPhone, setFamilySearchPhone] = useState('');
  const [familySearchName, setFamilySearchName] = useState('');
  const [familySearchResults, setFamilySearchResults] = useState<MemberResult[]>([]);
  const [familyRelationship, setFamilyRelationship] = useState('');
  const [familyLoading, setFamilyLoading] = useState(false);

  // Create new family member
  const [newFamilyFirst, setNewFamilyFirst] = useState('');
  const [newFamilyLast, setNewFamilyLast] = useState('');
  const [newFamilyEmail, setNewFamilyEmail] = useState('');
  const [newFamilyPhone, setNewFamilyPhone] = useState('');
  const [newFamilyDob, setNewFamilyDob] = useState('');
  const [newFamilyRelationship, setNewFamilyRelationship] = useState('');
  const [newFamilySetHOH, setNewFamilySetHOH] = useState(false);

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

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) {
      return '—';
    }
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  };

  const formatCurrency = (amount: number) => `$${amount.toFixed(2)}`;

  // ── Search handlers ──

  const handleSearchByPhone = async () => {
    const digits = searchPhone.replace(/\D/g, '');
    if (digits.length !== 10) {
      setError('Please enter a 10-digit phone number');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/members/lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: digits }) });
      const data = await res.json();
      if (!data.found || data.members.length === 0) {
        setResults([]);
        setError('No members found with this phone number');
      }
      else {
        setResults(data.members);
        setView('results');
      }
    }
    catch { setError('Search failed. Please try again.'); }
    setLoading(false);
  };

  const handleSearchByName = async () => {
    const name = searchName.trim();
    if (name.length < 2) {
      setError('Please enter at least 2 characters');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/members/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      const data = await res.json();
      if (!data.found || data.members.length === 0) {
        setResults([]);
        setError('No members found matching that name');
      }
      else {
        setResults(data.members);
        setView('results');
      }
    }
    catch { setError('Search failed. Please try again.'); }
    setLoading(false);
  };

  // ── Member detail loading ──

  const loadMemberDetail = async (memberId: string) => {
    setSelectedMemberId(memberId);
    setLoading(true);
    setActiveTab('overview');
    setView('memberDetail');
    try {
      const [detailRes, familyRes] = await Promise.all([
        fetch(`/api/members/${memberId}`),
        fetch(`/api/members/${memberId}/family`),
      ]);
      const detail = await detailRes.json();
      const family = await familyRes.json();
      setMemberDetail(detail);
      setFamilyMembers(family.familyMembers ?? []);
    }
    catch { setError('Failed to load member details'); }
    setLoading(false);
  };

  // ── OTP verification for member access ──

  const sendOtpToMember = async (m: MemberResult) => {
    setOtpLoading(true);
    setOtpError('');
    setOtpCode('');

    try {
      // Look up member's email hint via the member-portal lookup
      const lookupRes = await fetch('/api/member-portal/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: searchPhone.replace(/\D/g, ''), orgSlug: '_kiosk' }),
      });
      const lookupData = await lookupRes.json();

      // Find the matching member's email hint
      const match = lookupData.members?.find((lm: { memberId: string }) => lm.memberId === m.memberId);
      const emailHint = match?.emailHint ?? '***@***.***';

      // Send OTP
      await fetch('/api/member-portal/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId: m.memberId, orgSlug: '_kiosk' }),
      });

      setOtpMember({ memberId: m.memberId, firstName: m.firstName, emailHint });
      setView('otpVerify');
    }
    catch {
      setOtpError('Failed to send verification code. Please try again.');
    }
    setOtpLoading(false);
  };

  const verifyOtpAndLoadMember = async (code: string) => {
    if (!otpMember) {
      return;
    }
    setOtpLoading(true);
    setOtpError('');

    try {
      const res = await fetch('/api/member-portal/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId: otpMember.memberId, code, orgSlug: '_kiosk', isKiosk: true }),
      });
      const data = await res.json();

      if (!data.verified) {
        setOtpCode('');
        const reason = data.reason as 'not_found' | 'expired' | 'exhausted' | 'wrong_code' | undefined;
        const attemptsRemaining = typeof data.attemptsRemaining === 'number' ? data.attemptsRemaining : undefined;
        let message: string;
        if (reason === 'not_found') {
          message = 'No verification code found. Please request a new code.';
        }
        else if (reason === 'expired') {
          message = 'Your verification code expired. Please request a new code.';
        }
        else if (reason === 'exhausted' || attemptsRemaining === 0) {
          message = 'Too many attempts. Please request a new code.';
        }
        else if (typeof attemptsRemaining === 'number') {
          message = `Invalid code. ${attemptsRemaining} attempt${attemptsRemaining === 1 ? '' : 's'} remaining.`;
        }
        else {
          message = 'Invalid code. Please try again.';
        }
        setOtpError(message);
        setOtpLoading(false);
        return;
      }

      // OTP verified — load member detail
      await loadMemberDetail(otpMember.memberId);
    }
    catch {
      setOtpCode('');
      setOtpError('Verification failed. Please try again.');
    }
    setOtpLoading(false);
  };

  // ── Edit member ──

  const updateEditField = (field: keyof typeof editForm, value: string) => {
    setEditForm(f => ({ ...f, [field]: value }));
    setEditErrors((e) => {
      const n = { ...e };
      delete n[field];
      return n;
    });
  };

  const startEditing = () => {
    if (!memberDetail) {
      return;
    }
    const m = memberDetail.member;
    const addr = memberDetail.addresses.find(a => a.isDefault) ?? memberDetail.addresses[0];
    setEditForm({
      firstName: m.firstName,
      lastName: m.lastName,
      email: m.email,
      phone: m.phone ? formatPhone(m.phone) : '',
      dateOfBirth: m.dateOfBirth ? new Date(m.dateOfBirth).toISOString().split('T')[0] ?? '' : '',
      street: addr?.street ?? '',
      city: addr?.city ?? '',
      state: addr?.state ?? '',
      zipCode: addr?.zipCode ?? '',
      country: addr?.country ?? 'US',
    });
    setEditErrors({});
    setIsEditing(true);
  };

  const saveEdits = async () => {
    if (!selectedMemberId) {
      return;
    }
    const errors = validateMemberEditForm(editForm);
    if (Object.keys(errors).length > 0) {
      setEditErrors(errors);
      return;
    }
    setEditErrors({});
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/members/${selectedMemberId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: editForm.firstName,
          lastName: editForm.lastName,
          email: editForm.email,
          phone: editForm.phone,
          dateOfBirth: editForm.dateOfBirth || undefined,
          address: {
            street: editForm.street,
            city: editForm.city,
            state: editForm.state,
            zipCode: editForm.zipCode,
            country: editForm.country,
          },
        }),
      });
      if (!res.ok) {
        throw new Error('Update failed');
      }
      setIsEditing(false);
      await loadMemberDetail(selectedMemberId);
    }
    catch { setError('Failed to save changes'); }
    setSaving(false);
  };

  // ── Membership actions ──

  const [membershipActionLoading, setMembershipActionLoading] = useState<'cancel' | 'hold' | 'reactivate' | null>(null);

  const handleMembershipAction = async (action: 'cancel' | 'hold' | 'reactivate', memberMembershipId: string) => {
    if (!selectedMemberId) {
      return;
    }
    setMembershipActionLoading(action);
    setError('');
    try {
      const res = await fetch(`/api/members/${selectedMemberId}/membership`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberMembershipId, action }),
      });
      if (!res.ok) {
        throw new Error(`Failed to ${action} membership`);
      }
      await loadMemberDetail(selectedMemberId);
    }
    catch { setError(`Failed to ${action} membership`); }
    setMembershipActionLoading(null);
  };

  // ── Send waiver email ──

  const sendWaiverEmail = async (waiverId: string) => {
    if (!selectedMemberId) {
      return;
    }
    setSendingWaiverId(waiverId);
    setError('');
    try {
      const res = await fetch(`/api/members/${selectedMemberId}/waivers/${waiverId}/send`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? 'Send failed');
      }
      setError(`Waiver sent to ${data.sentTo}`);
    }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to send waiver'); }
    setSendingWaiverId(null);
  };

  // ── Family linking ──

  const handleFamilySearch = async (type: 'phone' | 'name') => {
    setFamilyLoading(true);
    setError('');
    try {
      let res;
      if (type === 'phone') {
        const digits = familySearchPhone.replace(/\D/g, '');
        res = await fetch('/api/members/lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: digits }) });
      }
      else {
        res = await fetch('/api/members/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: familySearchName.trim() }) });
      }
      const data = await res.json();
      setFamilySearchResults(data.members?.filter((m: MemberResult) => m.memberId !== selectedMemberId) ?? []);
      if (!data.found || data.members?.length === 0) {
        setError('No members found');
      }
    }
    catch { setError('Search failed'); }
    setFamilyLoading(false);
  };

  const resetCreateFamilyForm = () => {
    setNewFamilyFirst('');
    setNewFamilyLast('');
    setNewFamilyEmail('');
    setNewFamilyPhone('');
    setNewFamilyDob('');
    setNewFamilyRelationship('');
    setNewFamilySetHOH(false);
  };

  const handleCreateFamilyMember = async () => {
    if (!selectedMemberId || !newFamilyFirst.trim() || !newFamilyLast.trim() || !newFamilyEmail.trim() || !newFamilyRelationship) {
      setError('Please fill in all required fields');
      return;
    }
    setFamilyLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/members/${selectedMemberId}/create-family`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: newFamilyFirst.trim(),
          lastName: newFamilyLast.trim(),
          email: newFamilyEmail.trim(),
          phone: newFamilyPhone.replace(/\D/g, '') || undefined,
          dateOfBirth: newFamilyDob || undefined,
          relationship: newFamilyRelationship,
          setCurrentAsHOH: newFamilySetHOH,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error ?? 'Failed to create family member');
        setFamilyLoading(false);
        return;
      }
      // Reload family + detail
      await loadMemberDetail(selectedMemberId);
      setView('memberDetail');
      setActiveTab('family');
      resetCreateFamilyForm();
    }
    catch { setError('Failed to create family member'); }
    setFamilyLoading(false);
  };

  const handleLinkFamily = async (relatedMemberId: string) => {
    if (!familyRelationship.trim() || !selectedMemberId) {
      return;
    }
    setFamilyLoading(true);
    try {
      await fetch(`/api/members/${selectedMemberId}/link-family`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ relatedMemberId, relationship: familyRelationship }),
      });
      // Reload family + detail
      await loadMemberDetail(selectedMemberId);
      setView('memberDetail');
      setActiveTab('family');
      setFamilySearchPhone('');
      setFamilySearchName('');
      setFamilySearchResults([]);
      setFamilyRelationship('');
    }
    catch { setError('Failed to link family member'); }
    setFamilyLoading(false);
  };

  // ── OTP VERIFICATION VIEW ──

  if (view === 'otpVerify' && otpMember) {
    const handleOtpDigit = (digit: string) => {
      if (otpCode.length < 6) {
        const newCode = otpCode + digit;
        setOtpCode(newCode);
        setOtpError('');

        if (newCode.length === 6) {
          verifyOtpAndLoadMember(newCode);
        }
      }
    };

    const handleOtpBackspace = () => {
      setOtpCode(otpCode.slice(0, -1));
      setOtpError('');
    };

    const otpDigits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'];

    return (
      <Shell
        title="Verify Identity"
        onBack={() => {
          setView('results');
          setOtpCode('');
          setOtpError('');
          setOtpMember(null);
        }}
      >
        <div className="w-full max-w-sm">
          <h2 className="mb-2 text-center text-2xl font-bold text-black sm:text-3xl">
            Enter Code
          </h2>
          <p className="mb-8 text-center text-lg text-gray-500">
            Hi
            {' '}
            {otpMember.firstName}
            ! We sent a code to
            {' '}
            <span className="font-semibold text-black">{otpMember.emailHint}</span>
          </p>

          {/* Code display */}
          <div className="mb-6 flex justify-center gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={`otp-${String(i)}`}
                className={`flex h-14 w-12 items-center justify-center rounded-xl border-2 text-2xl font-bold ${
                  otpCode[i]
                    ? 'border-black bg-gray-50 text-black'
                    : 'border-gray-200 text-gray-300'
                }`}
              >
                {otpCode[i] ?? '·'}
              </div>
            ))}
          </div>

          {otpError && (
            <p className="mb-4 text-center text-red-500">{otpError}</p>
          )}

          {otpLoading && (
            <p className="mb-4 text-center text-gray-500">Verifying...</p>
          )}

          {/* Number pad */}
          <div className="grid grid-cols-3 gap-3">
            {otpDigits.map((d, i) => {
              if (d === '') {
                return <div key={`otp-pad-empty-${String(i)}`} />;
              }
              if (d === 'back') {
                return (
                  <button
                    key="otp-back"
                    type="button"
                    onClick={handleOtpBackspace}
                    disabled={otpLoading}
                    className="flex min-h-16 cursor-pointer items-center justify-center rounded-2xl bg-gray-100 text-xl font-bold text-gray-600 transition-all active:scale-95 disabled:opacity-50"
                  >
                    ←
                  </button>
                );
              }
              return (
                <button
                  key={`otp-${d}`}
                  type="button"
                  onClick={() => handleOtpDigit(d)}
                  disabled={otpLoading || otpCode.length >= 6}
                  className="flex min-h-16 cursor-pointer items-center justify-center rounded-2xl bg-gray-100 text-2xl font-bold text-black transition-all hover:bg-gray-200 active:scale-95 disabled:opacity-50"
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>
      </Shell>
    );
  }

  // ── SEARCH VIEW ──

  if (view === 'search') {
    return (
      <Shell title="Members" onBack={onBack}>
        <div className="w-full max-w-lg">
          <h2 className="mb-2 text-center text-2xl font-bold text-black sm:text-3xl">Find a Member</h2>
          <p className="mb-8 text-center text-lg text-gray-500">Search by phone number or name</p>

          <div className="mb-4">
            <label htmlFor="search-phone" className="mb-1 block text-sm font-semibold text-gray-500">Phone Number</label>
            <div className="flex gap-3">
              <input id="search-phone" type="tel" value={searchPhone} onChange={e => setSearchPhone(formatPhone(e.target.value))} placeholder="(555) 123-4567" className="flex-1 rounded-xl border-2 border-gray-200 px-4 py-3 text-lg text-black focus:border-black focus:outline-none" />
              <button type="button" onClick={handleSearchByPhone} disabled={loading || searchPhone.replace(/\D/g, '').length !== 10} className="cursor-pointer rounded-xl bg-black px-6 py-3 text-lg font-bold text-white transition-all hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50">{loading ? '...' : 'Search'}</button>
            </div>
          </div>

          <div className="mb-6">
            <label htmlFor="search-name" className="mb-1 block text-sm font-semibold text-gray-500">Or search by name</label>
            <div className="flex gap-3">
              <input id="search-name" type="text" value={searchName} onChange={e => setSearchName(e.target.value)} placeholder="First or last name" className="flex-1 rounded-xl border-2 border-gray-200 px-4 py-3 text-lg text-black focus:border-black focus:outline-none" />
              <button type="button" onClick={handleSearchByName} disabled={loading || searchName.trim().length < 2} className="cursor-pointer rounded-xl bg-black px-6 py-3 text-lg font-bold text-white transition-all hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50">{loading ? '...' : 'Search'}</button>
            </div>
          </div>

          {error && <p className="mb-4 text-center text-red-500">{error}</p>}
        </div>
      </Shell>
    );
  }

  // ── RESULTS VIEW ──

  if (view === 'results') {
    return (
      <Shell
        title="Members"
        onBack={() => {
          setView('search');
          setError('');
        }}
      >
        <div className="w-full max-w-lg">
          <h2 className="mb-2 text-center text-2xl font-bold text-black sm:text-3xl">
            {results.length}
            {' '}
            Member
            {results.length !== 1 ? 's' : ''}
            {' '}
            Found
          </h2>
          <p className="mb-8 text-center text-lg text-gray-500">Select a member to verify identity</p>
          <div className="space-y-3">
            {results.map(m => (
              <button key={m.memberId} type="button" onClick={() => sendOtpToMember(m)} disabled={otpLoading} className="flex w-full cursor-pointer items-center justify-between rounded-2xl border-2 border-gray-200 px-6 py-5 text-left transition-all hover:border-black hover:bg-gray-50 active:scale-95 disabled:opacity-50">
                <div>
                  <p className="text-xl font-bold text-black">
                    {m.firstName}
                    {' '}
                    {m.lastName}
                  </p>
                  <p className="text-sm text-gray-400 capitalize">{m.memberType.replace(/-/g, ' ')}</p>
                </div>
                <StatusBadge status={m.status} />
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setView('search')} className="mt-6 min-h-14 w-full cursor-pointer rounded-2xl border-2 border-gray-200 text-lg font-bold text-gray-500 transition-all hover:bg-gray-50 active:scale-95">Back to Search</button>
        </div>
      </Shell>
    );
  }

  // ── ADD FAMILY MEMBER VIEW ──

  // ── CREATE NEW FAMILY MEMBER VIEW ──
  if (view === 'createFamily' && selectedMemberId) {
    const inputClass = 'w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-lg text-black placeholder:text-gray-400 focus:border-black focus:outline-none';
    const labelClass = 'mb-1 block text-sm font-semibold text-gray-500';
    const isFormValid = newFamilyFirst.trim() && newFamilyLast.trim() && newFamilyEmail.trim() && newFamilyRelationship;

    return (
      <Shell
        title="Create New Family Member"
        onBack={() => {
          setView('addFamily');
          resetCreateFamilyForm();
          setError('');
        }}
      >
        <div className="w-full max-w-lg space-y-4">
          <div className="mb-2">
            <KioskSelect
              id="new-family-relationship"
              value={newFamilyRelationship}
              onChange={setNewFamilyRelationship}
              label="Relationship to current member"
              required
              placeholder="Select relationship..."
              options={[
                { value: 'child', label: 'Child' },
                { value: 'spouse', label: 'Spouse' },
                { value: 'parent', label: 'Parent' },
                { value: 'sibling', label: 'Sibling' },
                { value: 'other', label: 'Other' },
              ]}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="new-family-first" className={labelClass}>
                First Name
                {' '}
                <span className="text-red-500">*</span>
              </label>
              <input id="new-family-first" type="text" value={newFamilyFirst} onChange={e => setNewFamilyFirst(e.target.value)} placeholder="First name" className={inputClass} />
            </div>
            <div>
              <label htmlFor="new-family-last" className={labelClass}>
                Last Name
                {' '}
                <span className="text-red-500">*</span>
              </label>
              <input id="new-family-last" type="text" value={newFamilyLast} onChange={e => setNewFamilyLast(e.target.value)} placeholder="Last name" className={inputClass} />
            </div>
          </div>

          <div>
            <label htmlFor="new-family-email" className={labelClass}>
              Email
              {' '}
              <span className="text-red-500">*</span>
            </label>
            <input id="new-family-email" type="email" value={newFamilyEmail} onChange={e => setNewFamilyEmail(e.target.value)} placeholder="email@example.com" className={inputClass} />
          </div>

          <div>
            <label htmlFor="new-family-phone" className={labelClass}>Phone</label>
            <input id="new-family-phone" type="tel" value={newFamilyPhone} onChange={e => setNewFamilyPhone(formatPhone(e.target.value))} placeholder="(555) 123-4567" className={inputClass} />
          </div>

          <TouchDatePicker
            value={newFamilyDob}
            onChange={setNewFamilyDob}
            label="Date of Birth"
          />

          {/* Set current member as HOH */}
          {memberDetail && memberDetail.member.memberType !== 'head-of-household' && (
            <div
              role="checkbox"
              aria-checked={newFamilySetHOH}
              tabIndex={0}
              className={`flex cursor-pointer items-start gap-4 rounded-xl border-2 p-4 transition-colors ${newFamilySetHOH ? 'border-black bg-gray-50' : 'border-gray-200 bg-white'}`}
              onClick={() => setNewFamilySetHOH(!newFamilySetHOH)}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  setNewFamilySetHOH(!newFamilySetHOH);
                }
              }}
            >
              <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded border-2 transition-colors ${newFamilySetHOH ? 'border-black bg-black' : 'border-gray-400'}`}>
                {newFamilySetHOH && (
                  <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
              <div>
                <p className="text-lg font-semibold text-black">Set as Head of Household</p>
                <p className="text-sm text-gray-500">
                  Designate
                  {' '}
                  {memberDetail.member.firstName}
                  {' '}
                  {memberDetail.member.lastName}
                  {' '}
                  as the head of this household
                </p>
              </div>
            </div>
          )}

          {error && <p className="text-center text-red-500">{error}</p>}

          <button
            type="button"
            onClick={handleCreateFamilyMember}
            disabled={!isFormValid || familyLoading}
            className="min-h-14 w-full cursor-pointer rounded-2xl bg-black text-xl font-bold text-white transition-all hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {familyLoading ? 'Creating...' : 'Create & Link Family Member'}
          </button>
        </div>
      </Shell>
    );
  }

  if (view === 'addFamily' && selectedMemberId) {
    return (
      <Shell
        title="Add Family Member"
        onBack={() => {
          setView('memberDetail');
          setActiveTab('family');
          setFamilySearchResults([]);
          setError('');
        }}
      >
        <div className="w-full max-w-lg">
          <p className="mb-6 text-center text-lg text-gray-500">Search for an existing member or create a new one</p>

          <button
            type="button"
            onClick={() => {
              setView('createFamily');
              setError('');
            }}
            className="mb-6 min-h-14 w-full cursor-pointer rounded-2xl border-2 border-black bg-white text-xl font-bold text-black transition-all hover:bg-gray-50 active:scale-95"
          >
            + Create New Member
          </button>

          <div className="mb-6 flex items-center gap-4">
            <div className="h-px flex-1 bg-gray-200" />
            <span className="text-sm font-semibold text-gray-400">OR SEARCH EXISTING</span>
            <div className="h-px flex-1 bg-gray-200" />
          </div>

          <div className="mb-4">
            <KioskSelect
              id="family-relationship"
              value={familyRelationship}
              onChange={setFamilyRelationship}
              label="Relationship"
              placeholder="Select relationship..."
              options={[
                { value: 'spouse', label: 'Spouse' },
                { value: 'child', label: 'Child' },
                { value: 'parent', label: 'Parent' },
                { value: 'sibling', label: 'Sibling' },
                { value: 'other', label: 'Other' },
              ]}
            />
          </div>

          <div className="mb-4">
            <label htmlFor="family-search-phone" className="mb-1 block text-sm font-semibold text-gray-500">Search by phone</label>
            <div className="flex gap-3">
              <input id="family-search-phone" type="tel" value={familySearchPhone} onChange={e => setFamilySearchPhone(formatPhone(e.target.value))} placeholder="(555) 123-4567" className="flex-1 rounded-xl border-2 border-gray-200 px-4 py-3 text-lg text-black focus:border-black focus:outline-none" />
              <button type="button" onClick={() => handleFamilySearch('phone')} disabled={familyLoading || familySearchPhone.replace(/\D/g, '').length !== 10} className="cursor-pointer rounded-xl bg-black px-6 py-3 text-lg font-bold text-white transition-all hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50">{familyLoading ? '...' : 'Search'}</button>
            </div>
          </div>

          <div className="mb-6">
            <label htmlFor="family-search-name" className="mb-1 block text-sm font-semibold text-gray-500">Or search by name</label>
            <div className="flex gap-3">
              <input id="family-search-name" type="text" value={familySearchName} onChange={e => setFamilySearchName(e.target.value)} placeholder="First or last name" className="flex-1 rounded-xl border-2 border-gray-200 px-4 py-3 text-lg text-black focus:border-black focus:outline-none" />
              <button type="button" onClick={() => handleFamilySearch('name')} disabled={familyLoading || familySearchName.trim().length < 2} className="cursor-pointer rounded-xl bg-black px-6 py-3 text-lg font-bold text-white transition-all hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50">{familyLoading ? '...' : 'Search'}</button>
            </div>
          </div>

          {error && <p className="mb-4 text-center text-red-500">{error}</p>}

          {familySearchResults.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-semibold text-gray-500">
                {familySearchResults.length}
                {' '}
                result
                {familySearchResults.length !== 1 ? 's' : ''}
              </p>
              {familySearchResults.map(m => (
                <button key={m.memberId} type="button" onClick={() => handleLinkFamily(m.memberId)} disabled={!familyRelationship || familyLoading} className="flex w-full cursor-pointer items-center justify-between rounded-2xl border-2 border-gray-200 px-6 py-4 text-left transition-all hover:border-black hover:bg-gray-50 active:scale-95 disabled:opacity-50">
                  <div>
                    <p className="text-lg font-bold text-black">
                      {m.firstName}
                      {' '}
                      {m.lastName}
                    </p>
                    <p className="text-sm text-gray-400 capitalize">{m.memberType.replace(/-/g, ' ')}</p>
                  </div>
                  <span className="text-sm font-semibold text-black">Link →</span>
                </button>
              ))}
              {!familyRelationship && <p className="text-center text-sm text-amber-600">Select a relationship above before linking</p>}
            </div>
          )}
        </div>
      </Shell>
    );
  }

  // ── MEMBER DETAIL VIEW ──

  if (view === 'memberDetail' && memberDetail) {
    const m = memberDetail.member;
    const defaultAddr = memberDetail.addresses.find(a => a.isDefault) ?? memberDetail.addresses[0];
    const activeMembership = memberDetail.memberships.find(ms => ms.status === 'active')
      ?? memberDetail.memberships.find(ms => ms.status === 'hold')
      ?? memberDetail.memberships.find(ms => ms.status === 'cancelled');

    const tabs: { key: DetailTab; label: string }[] = [
      { key: 'overview', label: 'Overview' },
      { key: 'billing', label: 'Billing' },
      { key: 'waivers', label: 'Waivers' },
      { key: 'attendance', label: 'Attendance' },
      { key: 'family', label: 'Family' },
    ];

    return (
      <div className="flex min-h-screen flex-col bg-white">
        <KioskFlowHeader title={`${m.firstName} ${m.lastName}`} onBack={() => setView('results')} />

        {/* Tabs */}
        <div className="border-b border-gray-200 px-4 sm:px-6">
          <nav className="mx-auto flex max-w-4xl gap-1 overflow-x-auto">
            {tabs.map(t => (
              <button key={t.key} type="button" onClick={() => setActiveTab(t.key)} className={`cursor-pointer px-4 py-3 text-lg font-semibold whitespace-nowrap transition-all ${activeTab === t.key ? 'border-b-4 border-black text-black' : 'text-gray-400 hover:text-gray-600'}`}>
                {t.label}
              </button>
            ))}
          </nav>
        </div>

        <main className="flex-1 p-4 sm:p-6 md:p-8">
          <div className="mx-auto max-w-4xl">

            {/* ── OVERVIEW TAB ── */}
            {activeTab === 'overview' && (
              <div className="space-y-6">
                {/* Status + Type + Edit button */}
                <div className="flex flex-wrap items-center gap-3">
                  <StatusBadge status={m.status} />
                  <span className="rounded-lg bg-gray-100 px-3 py-1 text-sm font-semibold text-gray-600 capitalize">{(m.memberType ?? 'individual').replace(/-/g, ' ')}</span>
                  {m.createdAt && (
                    <span className="rounded-lg bg-gray-100 px-3 py-1 text-sm text-gray-500">
                      Member since
                      {' '}
                      {formatDate(m.createdAt)}
                    </span>
                  )}
                  <div className="ml-auto">
                    {isEditing
                      ? (
                          <div className="flex gap-2">
                            <button type="button" onClick={() => setIsEditing(false)} className="cursor-pointer rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-50">Cancel</button>
                            <button type="button" onClick={saveEdits} disabled={saving} className="flex cursor-pointer items-center gap-2 rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-gray-800 disabled:opacity-50">
                              <SaveIcon sx={{ fontSize: 16 }} />
                              {saving ? 'Saving...' : 'Save'}
                            </button>
                          </div>
                        )
                      : (
                          <button type="button" onClick={startEditing} className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-50">
                            <EditIcon sx={{ fontSize: 16 }} />
                            Edit
                          </button>
                        )}
                  </div>
                </div>

                {error && <p className="text-center text-red-500">{error}</p>}

                {/* Contact Info */}
                <Card title="Contact Information">
                  {isEditing
                    ? (
                        <div className="space-y-3">
                          <EditField label="First Name" value={editForm.firstName} error={editErrors.firstName} onChange={v => updateEditField('firstName', v)} />
                          <EditField label="Last Name" value={editForm.lastName} error={editErrors.lastName} onChange={v => updateEditField('lastName', v)} />
                          <EditField label="Email" value={editForm.email} error={editErrors.email} type="email" onChange={v => updateEditField('email', v)} />
                          <EditField label="Phone" value={editForm.phone} error={editErrors.phone} type="tel" onChange={v => updateEditField('phone', formatPhone(v))} />
                          <div>
                            <div className="flex items-center justify-between gap-4">
                              <span className="shrink-0 text-sm text-gray-500">Date of Birth</span>
                              <div className="w-2/3">
                                <TouchDatePicker
                                  value={editForm.dateOfBirth}
                                  onChange={v => updateEditField('dateOfBirth', v)}
                                  label="Date of Birth"
                                  error={editErrors.dateOfBirth}
                                  placeholder="Select date"
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    : (
                        <>
                          <InfoRow label="Email" value={m.email} />
                          <InfoRow label="Phone" value={m.phone ?? '—'} />
                          <InfoRow label="Date of Birth" value={formatDate(m.dateOfBirth)} />
                        </>
                      )}
                </Card>

                {/* Address */}
                <Card title="Address">
                  {isEditing
                    ? (
                        <div className="space-y-3">
                          <EditField label="Street" value={editForm.street} error={editErrors.street} onChange={v => updateEditField('street', v)} />
                          <EditField label="City" value={editForm.city} error={editErrors.city} onChange={v => updateEditField('city', v)} />
                          <EditField label="State" value={editForm.state} error={editErrors.state} onChange={v => updateEditField('state', v)} />
                          <EditField label="Zip Code" value={editForm.zipCode} error={editErrors.zipCode} onChange={v => updateEditField('zipCode', v)} />
                          <EditField label="Country" value={editForm.country} error={editErrors.country} onChange={v => updateEditField('country', v)} />
                        </div>
                      )
                    : defaultAddr
                      ? (
                          <>
                            <InfoRow label="Street" value={defaultAddr.street ?? '—'} />
                            <InfoRow label="City" value={defaultAddr.city ?? '—'} />
                            <InfoRow label="State" value={defaultAddr.state ?? '—'} />
                            <InfoRow label="Zip" value={defaultAddr.zipCode ?? '—'} />
                            <InfoRow label="Country" value={defaultAddr.country ?? '—'} />
                          </>
                        )
                      : <p className="text-gray-400">No address on file</p>}
                </Card>

                {/* Active Membership */}
                <Card title="Membership">
                  {activeMembership
                    ? (
                        <>
                          <InfoRow label="Plan" value={activeMembership.planName} />
                          <InfoRow label="Category" value={activeMembership.planCategory ?? '—'} />
                          <InfoRow label="Price" value={formatCurrency(activeMembership.planPrice)} />
                          <InfoRow label="Frequency" value={activeMembership.planFrequency ?? '—'} />
                          <InfoRow label="Contract" value={activeMembership.planContractLength ?? '—'} />
                          <InfoRow label="Billing Type" value={activeMembership.billingType ?? '—'} />
                          <InfoRow label="Start Date" value={formatDate(activeMembership.startDate)} />
                          <InfoRow label="Next Payment" value={formatDate(activeMembership.nextPaymentDate)} />
                          <div className="flex items-center justify-between">
                            <span className="text-gray-500">Status</span>
                            <StatusBadge status={activeMembership.status} />
                          </div>
                          {/* Membership action buttons */}
                          {activeMembership.status === 'active' && (
                            <div className="mt-4 flex gap-3">
                              <button
                                type="button"
                                onClick={() => handleMembershipAction('hold', activeMembership.id)}
                                disabled={membershipActionLoading !== null}
                                className="min-h-12 flex-1 cursor-pointer rounded-xl border-2 border-amber-400 bg-amber-50 text-base font-semibold text-amber-700 transition-all hover:bg-amber-100 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {membershipActionLoading === 'hold' ? 'Placing hold…' : 'Hold'}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleMembershipAction('cancel', activeMembership.id)}
                                disabled={membershipActionLoading !== null}
                                className="min-h-12 flex-1 cursor-pointer rounded-xl border-2 border-red-400 bg-red-50 text-base font-semibold text-red-700 transition-all hover:bg-red-100 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {membershipActionLoading === 'cancel' ? 'Cancelling…' : 'Cancel'}
                              </button>
                            </div>
                          )}
                          {activeMembership.status === 'hold' && (
                            <div className="mt-4 flex gap-3">
                              <button
                                type="button"
                                onClick={() => handleMembershipAction('reactivate', activeMembership.id)}
                                disabled={membershipActionLoading !== null}
                                className="min-h-12 flex-1 cursor-pointer rounded-xl border-2 border-green-400 bg-green-50 text-base font-semibold text-green-700 transition-all hover:bg-green-100 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {membershipActionLoading === 'reactivate' ? 'Reactivating…' : 'Reactivate'}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleMembershipAction('cancel', activeMembership.id)}
                                disabled={membershipActionLoading !== null}
                                className="min-h-12 flex-1 cursor-pointer rounded-xl border-2 border-red-400 bg-red-50 text-base font-semibold text-red-700 transition-all hover:bg-red-100 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {membershipActionLoading === 'cancel' ? 'Cancelling…' : 'Cancel'}
                              </button>
                            </div>
                          )}
                          {onAssignChildMembership && activeMembership.isTrial && activeMembership.status === 'active' && (
                            <button
                              type="button"
                              onClick={() => {
                                const addr = memberDetail.addresses.find(a => a.isDefault) ?? memberDetail.addresses[0];
                                onAssignChildMembership({
                                  childMemberId: m.id,
                                  firstName: m.firstName,
                                  lastName: m.lastName,
                                  email: m.email,
                                  phone: m.phone ?? '',
                                  dateOfBirth: m.dateOfBirth ? new Date(m.dateOfBirth).toISOString().split('T')[0] ?? '' : '',
                                  address: addr?.street ?? '',
                                  city: addr?.city ?? '',
                                  state: addr?.state ?? '',
                                  zip: addr?.zipCode ?? '',
                                  convertingTrialMembershipId: activeMembership.id,
                                  guardianFirstName: parentContext?.firstName ?? '',
                                  guardianLastName: parentContext?.lastName ?? '',
                                  guardianEmail: parentContext?.email ?? '',
                                });
                              }}
                              className="mt-2 min-h-12 w-full cursor-pointer rounded-xl bg-black text-base font-semibold text-white transition-all hover:bg-gray-800 active:scale-95"
                            >
                              Upgrade to Paid Membership
                            </button>
                          )}
                        </>
                      )
                    : (
                        <>
                          <p className="text-gray-400">No active membership</p>
                          {onAssignChildMembership && (
                            <button
                              type="button"
                              onClick={() => {
                                const addr = memberDetail.addresses.find(a => a.isDefault) ?? memberDetail.addresses[0];
                                onAssignChildMembership({
                                  childMemberId: m.id,
                                  firstName: m.firstName,
                                  lastName: m.lastName,
                                  email: m.email,
                                  phone: m.phone ?? '',
                                  dateOfBirth: m.dateOfBirth ? new Date(m.dateOfBirth).toISOString().split('T')[0] ?? '' : '',
                                  address: addr?.street ?? '',
                                  city: addr?.city ?? '',
                                  state: addr?.state ?? '',
                                  zip: addr?.zipCode ?? '',
                                  convertingTrialMembershipId: null,
                                  guardianFirstName: parentContext?.firstName ?? '',
                                  guardianLastName: parentContext?.lastName ?? '',
                                  guardianEmail: parentContext?.email ?? '',
                                });
                              }}
                              className="mt-4 min-h-12 w-full cursor-pointer rounded-xl bg-black text-base font-semibold text-white transition-all hover:bg-gray-800 active:scale-95"
                            >
                              Assign Membership
                            </button>
                          )}
                        </>
                      )}
                </Card>
              </div>
            )}

            {/* ── BILLING TAB ── */}
            {activeTab === 'billing' && (
              <div className="space-y-6">
                <Card title="Billing History">
                  {memberDetail.transactions.length > 0
                    ? (
                        <div className="space-y-3">
                          {memberDetail.transactions.map(t => (
                            <div key={t.id} className="flex items-center justify-between rounded-xl border border-gray-100 p-4">
                              <div>
                                <p className="font-semibold text-black">{t.description ?? t.transactionType?.replace(/_/g, ' ') ?? 'Payment'}</p>
                                {t.memberName && (
                                  <p className="text-sm font-medium text-amber-700">
                                    {t.memberName}
                                  </p>
                                )}
                                <p className="text-sm text-gray-400">
                                  {formatDate(t.processedAt ?? t.createdAt)}
                                  {' '}
                                  ·
                                  {' '}
                                  {t.paymentMethod ?? '—'}
                                </p>
                              </div>
                              <div className="text-right">
                                <p className="text-lg font-bold text-black">{formatCurrency(t.amount)}</p>
                                <StatusBadge status={t.status} />
                              </div>
                            </div>
                          ))}
                        </div>
                      )
                    : <p className="text-gray-400">No billing history</p>}
                </Card>
              </div>
            )}

            {/* ── WAIVERS TAB ── */}
            {activeTab === 'waivers' && (
              <div className="space-y-6">
                {error && <p className="text-center text-sm text-green-600">{error}</p>}
                <Card title="Signed Waivers">
                  {memberDetail.waivers.length > 0
                    ? (
                        <div className="space-y-3">
                          {memberDetail.waivers.map(w => (
                            <div key={w.id} className="flex items-center justify-between rounded-xl border border-gray-100 p-4">
                              <div>
                                <p className="font-semibold text-black">{w.membershipPlanName ?? 'Waiver'}</p>
                                <p className="text-sm text-gray-400">
                                  Signed by
                                  {' '}
                                  {w.signedByName ?? '—'}
                                  {' '}
                                  on
                                  {' '}
                                  {formatDate(w.signedAt)}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => sendWaiverEmail(w.id)}
                                disabled={sendingWaiverId === w.id}
                                className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-600 transition-colors hover:border-black hover:bg-gray-50 disabled:opacity-50"
                              >
                                <EmailIcon sx={{ fontSize: 16 }} />
                                {sendingWaiverId === w.id ? 'Sending...' : 'Send'}
                              </button>
                            </div>
                          ))}
                        </div>
                      )
                    : <p className="text-gray-400">No signed waivers</p>}
                </Card>
              </div>
            )}

            {/* ── ATTENDANCE TAB ── */}
            {activeTab === 'attendance' && (
              <div className="space-y-6">
                <Card title="Attendance History">
                  {(memberDetail.attendance ?? []).length > 0
                    ? (
                        <div className="space-y-3">
                          {memberDetail.attendance.map(a => (
                            <div key={a.id} className="flex items-center justify-between rounded-xl border border-gray-100 p-4">
                              <div>
                                <p className="font-semibold text-black">{a.className ?? 'Class'}</p>
                                <p className="text-sm text-gray-400">
                                  {formatDate(a.attendanceDate)}
                                  {a.startTime && (
                                    <>
                                      {' '}
                                      &middot;
                                      {' '}
                                      {a.startTime}
                                      {a.endTime ? `–${a.endTime}` : ''}
                                    </>
                                  )}
                                  {a.room && (
                                    <>
                                      {' '}
                                      &middot;
                                      {' '}
                                      {a.room}
                                    </>
                                  )}
                                </p>
                              </div>
                              <div className="text-right">
                                <p className="text-sm text-gray-500 capitalize">{(a.checkInMethod ?? 'kiosk').replace(/-/g, ' ')}</p>
                                {a.checkInTime && (
                                  <p className="text-xs text-gray-400">
                                    {new Date(a.checkInTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                                  </p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )
                    : <p className="text-gray-400">No attendance records</p>}
                </Card>
              </div>
            )}

            {/* ── FAMILY TAB ── */}
            {activeTab === 'family' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-bold text-black">Family Members</h3>
                  <button
                    type="button"
                    onClick={() => {
                      setView('addFamily');
                      setError('');
                      setFamilySearchResults([]);
                    }}
                    className="min-h-12 cursor-pointer rounded-xl bg-black px-6 py-3 text-lg font-bold text-white transition-all hover:scale-105 active:scale-95"
                  >
                    + Add Family Member
                  </button>
                </div>

                {familyMembers.length > 0
                  ? (
                      <div className="space-y-3">
                        {familyMembers.map(fm => (
                          <button
                            key={fm.id}
                            type="button"
                            onClick={() => {
                              if (memberDetail) {
                                setParentContext({
                                  firstName: memberDetail.member.firstName,
                                  lastName: memberDetail.member.lastName,
                                  email: memberDetail.member.email,
                                });
                              }
                              loadMemberDetail(fm.id);
                            }}
                            className="flex w-full cursor-pointer items-center justify-between rounded-2xl border-2 border-gray-200 px-6 py-4 text-left transition-all hover:border-black hover:bg-gray-50 active:scale-95"
                          >
                            <div>
                              <p className="text-lg font-bold text-black">
                                {fm.firstName}
                                {' '}
                                {fm.lastName}
                              </p>
                              <p className="text-sm text-gray-400 capitalize">
                                {fm.relationship}
                                {fm.isHOH ? ' (Head of Household)' : ''}
                              </p>
                            </div>
                            <StatusBadge status={fm.status} />
                          </button>
                        ))}
                      </div>
                    )
                  : <p className="text-gray-400">No family members linked. Tap "+ Add Family Member" to link one.</p>}

                {m.memberType !== 'head-of-household' && familyMembers.length === 0 && (
                  <Card title="Set as Head of Household">
                    <p className="mb-3 text-gray-500">Making this member the head of household allows you to link family members to their account.</p>
                    <button
                      type="button"
                      onClick={() => {
                        setView('addFamily');
                        setError('');
                        setFamilySearchResults([]);
                      }}
                      className="min-h-12 w-full cursor-pointer rounded-xl bg-black text-lg font-bold text-white transition-all hover:scale-105 active:scale-95"
                    >
                      Link First Family Member
                    </button>
                  </Card>
                )}
              </div>
            )}

          </div>
        </main>
      </div>
    );
  }

  // Loading state
  if (loading) {
    return (
      <Shell title="Members" onBack={onBack}>
        <p className="text-lg text-gray-400">Loading...</p>
      </Shell>
    );
  }

  return null;
}

// ── Shared sub-components ──

function Shell({ title, onBack, children }: { title: string; onBack: () => void; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <KioskFlowHeader title={title} onBack={onBack} />
      <main className="flex flex-1 items-start justify-center p-4 sm:p-6 md:p-8">{children}</main>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border-2 border-gray-200 p-6">
      <h3 className="mb-4 text-lg font-bold text-black">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-black">{value}</span>
    </div>
  );
}

function EditField({ label, value, onChange, type = 'text', error }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  error?: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <label className="shrink-0 text-sm text-gray-500">{label}</label>
        <input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          className={`w-2/3 rounded-xl border-2 px-4 py-3 text-base text-black focus:outline-none ${
            error ? 'border-red-400 focus:border-red-500' : 'border-gray-300 focus:border-black'
          }`}
        />
      </div>
      {error && <p className="mt-1 text-right text-xs text-red-500">{error}</p>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: 'bg-green-100 text-green-700',
    paid: 'bg-green-100 text-green-700',
    hold: 'bg-amber-100 text-amber-700',
    trial: 'bg-blue-100 text-blue-700',
    pending: 'bg-yellow-100 text-yellow-700',
    processing: 'bg-yellow-100 text-yellow-700',
    cancelled: 'bg-red-100 text-red-700',
    converted: 'bg-gray-100 text-gray-600',
    declined: 'bg-red-100 text-red-700',
    past_due: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`rounded-lg px-3 py-1 text-sm font-semibold capitalize ${colors[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status === 'hold' ? 'On Hold' : status.replace(/_/g, ' ')}
    </span>
  );
}

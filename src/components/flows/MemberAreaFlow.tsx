'use client';

import type { MemberEditFormErrors } from '../../lib/validation';
import EditIcon from '@mui/icons-material/Edit';
import EmailIcon from '@mui/icons-material/Email';
import SaveIcon from '@mui/icons-material/Save';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import { useEffect, useState } from 'react';
import { validateMemberEditForm } from '../../lib/validation';
import { KioskFlowHeader } from '../KioskFlowHeader';
import { TouchDatePicker } from '../TouchDatePicker';

interface MemberAreaFlowProps {
  onComplete: () => void;
  onBack: () => void;
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

type View = 'staffAuth' | 'search' | 'results' | 'memberDetail' | 'addFamily';
type DetailTab = 'overview' | 'billing' | 'waivers' | 'attendance' | 'family';

export function MemberAreaFlow({ onBack }: MemberAreaFlowProps) {
  const [view, setView] = useState<View>('staffAuth');
  const [totpCode, setTotpCode] = useState('');
  const [totpError, setTotpError] = useState('');
  const [totpLoading, setTotpLoading] = useState(false);
  const [searchPhone, setSearchPhone] = useState('');
  const [searchName, setSearchName] = useState('');
  const [results, setResults] = useState<MemberResult[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [memberDetail, setMemberDetail] = useState<MemberDetail | null>(null);
  const [familyMembers, setFamilyMembers] = useState<FamilyMemberData[]>([]);
  const [activeTab, setActiveTab] = useState<DetailTab>('overview');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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

  // Membership conversion
  const [isConverting, setIsConverting] = useState(false);
  const [availablePlans, setAvailablePlans] = useState<Array<{ id: string; name: string; price: number; frequency: string | null; category: string | null }>>([]);
  const [selectedNewPlanId, setSelectedNewPlanId] = useState('');
  const [convertLoading, setConvertLoading] = useState(false);
  const [prorationData, setProrationData] = useState<{
    currentPlan: { name: string; price: number; frequency: string | null } | null;
    newPlan: { name: string; price: number; frequency: string | null };
    proration: { credit: number; daysRemaining: number; totalDaysInPeriod: number; netAmountDue: number; remainingCredit: number };
  } | null>(null);
  const [prorationLoading, setProrationLoading] = useState(false);

  // Waiver email
  const [sendingWaiverId, setSendingWaiverId] = useState<string | null>(null);

  // Add family member
  const [familySearchPhone, setFamilySearchPhone] = useState('');
  const [familySearchName, setFamilySearchName] = useState('');
  const [familySearchResults, setFamilySearchResults] = useState<MemberResult[]>([]);
  const [familyRelationship, setFamilyRelationship] = useState('');
  const [familyLoading, setFamilyLoading] = useState(false);

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

  // ── Membership conversion ──

  useEffect(() => {
    if (!isConverting) {
      return;
    }
    fetch('/api/programs')
      .then(r => r.json())
      .then((data) => {
        const plans: typeof availablePlans = [];
        for (const group of Object.values(data.plansByProgram ?? {})) {
          for (const p of (group as Array<Record<string, unknown>>)) {
            if (!p.isTrial) {
              plans.push({
                id: p.id as string,
                name: p.name as string,
                price: p.price as number,
                frequency: p.frequency as string | null,
                category: p.category as string | null,
              });
            }
          }
        }
        setAvailablePlans(plans);
      })
      .catch(() => setError('Failed to load plans'));
  }, [isConverting]);

  // Fetch proration preview when a new plan is selected
  useEffect(() => {
    if (!selectedNewPlanId || !selectedMemberId || !isConverting) {
      setProrationData(null);
      return;
    }
    setProrationLoading(true);
    fetch(`/api/members/${selectedMemberId}/membership/proration`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPlanId: selectedNewPlanId }),
    })
      .then(r => r.json())
      .then(data => setProrationData(data))
      .catch(() => setProrationData(null))
      .finally(() => setProrationLoading(false));
  }, [selectedNewPlanId, selectedMemberId, isConverting]);

  const convertMembership = async () => {
    if (!selectedMemberId || !selectedNewPlanId) {
      return;
    }
    setConvertLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/members/${selectedMemberId}/membership`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newPlanId: selectedNewPlanId,
          prorationCredit: prorationData?.proration.credit ?? 0,
          previousPlanName: prorationData?.currentPlan?.name,
        }),
      });
      if (!res.ok) {
        throw new Error('Conversion failed');
      }
      setIsConverting(false);
      setProrationData(null);
      setSelectedNewPlanId('');
      await loadMemberDetail(selectedMemberId);
    }
    catch { setError('Failed to convert membership'); }
    setConvertLoading(false);
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

  // ── TOTP STAFF AUTH VIEW ──

  if (view === 'staffAuth') {
    const verifyTotp = async (code: string) => {
      setTotpLoading(true);
      setTotpError('');
      try {
        const res = await fetch('/api/staff/verify-totp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });
        const data = await res.json();

        if (res.status === 503) {
          setTotpError('Staff access not configured. Contact your administrator.');
          setTotpCode('');
          setTotpLoading(false);
          return;
        }

        if (data.verified) {
          setView('search');
        }
        else {
          setTotpError('Invalid code. Please try again.');
          setTotpCode('');
        }
      }
      catch {
        setTotpError('Verification failed. Please try again.');
        setTotpCode('');
      }
      setTotpLoading(false);
    };

    const handleTotpDigit = (digit: string) => {
      if (totpCode.length < 6) {
        const newCode = totpCode + digit;
        setTotpCode(newCode);
        setTotpError('');

        if (newCode.length === 6) {
          verifyTotp(newCode);
        }
      }
    };

    const handleTotpBackspace = () => {
      setTotpCode(totpCode.slice(0, -1));
      setTotpError('');
    };

    const totpDigits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'];

    return (
      <Shell
        title="Member Management"
        onBack={onBack}
      >
        <div className="w-full max-w-sm">
          <h2 className="mb-2 text-center text-2xl font-bold text-black sm:text-3xl">
            Staff Access
          </h2>
          <p className="mb-8 text-center text-lg text-gray-500">
            Enter your 6-digit code from your authenticator app
          </p>

          {/* Code display */}
          <div className="mb-6 flex justify-center gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={`totp-${String(i)}`}
                className={`flex h-14 w-12 items-center justify-center rounded-xl border-2 text-2xl font-bold ${
                  totpCode[i]
                    ? 'border-black bg-gray-50 text-black'
                    : 'border-gray-200 text-gray-300'
                }`}
              >
                {totpCode[i] ?? '·'}
              </div>
            ))}
          </div>

          {totpError && (
            <p className="mb-4 text-center text-red-500">{totpError}</p>
          )}

          {totpLoading && (
            <p className="mb-4 text-center text-gray-500">Verifying...</p>
          )}

          {/* Number pad */}
          <div className="grid grid-cols-3 gap-3">
            {totpDigits.map((d, i) => {
              if (d === '') {
                return <div key={`totp-pad-empty-${String(i)}`} />;
              }
              if (d === 'back') {
                return (
                  <button
                    key="totp-back"
                    type="button"
                    onClick={handleTotpBackspace}
                    disabled={totpLoading}
                    className="flex min-h-16 cursor-pointer items-center justify-center rounded-2xl bg-gray-100 text-xl font-bold text-gray-600 transition-all active:scale-95 disabled:opacity-50"
                  >
                    ←
                  </button>
                );
              }
              return (
                <button
                  key={`totp-${d}`}
                  type="button"
                  onClick={() => handleTotpDigit(d)}
                  disabled={totpLoading || totpCode.length >= 6}
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
          <p className="mb-8 text-center text-lg text-gray-500">Select a member to view details</p>
          <div className="space-y-3">
            {results.map(m => (
              <button key={m.memberId} type="button" onClick={() => loadMemberDetail(m.memberId)} className="flex w-full cursor-pointer items-center justify-between rounded-2xl border-2 border-gray-200 px-6 py-5 text-left transition-all hover:border-black hover:bg-gray-50 active:scale-95">
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
          <p className="mb-6 text-center text-lg text-gray-500">Search for an existing member to link as a family member</p>

          <div className="mb-4">
            <label htmlFor="family-relationship" className="mb-1 block text-sm font-semibold text-gray-500">Relationship</label>
            <select id="family-relationship" value={familyRelationship} onChange={e => setFamilyRelationship(e.target.value)} className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-lg text-black focus:border-black focus:outline-none">
              <option value="">Select relationship...</option>
              <option value="spouse">Spouse</option>
              <option value="child">Child</option>
              <option value="parent">Parent</option>
              <option value="sibling">Sibling</option>
              <option value="other">Other</option>
            </select>
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
    const activeMembership = memberDetail.memberships.find(ms => ms.status === 'active');

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
                          {!isConverting && (
                            <button type="button" onClick={() => setIsConverting(true)} className="mt-4 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-gray-200 py-3 text-base font-semibold text-gray-600 transition-all hover:border-black hover:bg-gray-50">
                              <SwapHorizIcon sx={{ fontSize: 20 }} />
                              Convert Membership
                            </button>
                          )}
                          {isConverting && (
                            <div className="mt-4 space-y-3 rounded-xl border-2 border-black bg-gray-50 p-4">
                              <p className="text-sm font-semibold text-black">Convert to a new plan</p>
                              <select
                                value={selectedNewPlanId}
                                onChange={e => setSelectedNewPlanId(e.target.value)}
                                className="w-full rounded-lg border-2 border-gray-300 bg-white px-4 py-3 text-base text-black focus:border-black focus:outline-none"
                              >
                                <option value="">Select a plan...</option>
                                {availablePlans.map(p => (
                                  <option key={p.id} value={p.id}>
                                    {p.name}
                                    {' '}
                                    — $
                                    {p.price.toFixed(2)}
                                    {p.frequency && p.frequency !== 'None' ? ` / ${p.frequency.toLowerCase()}` : ''}
                                    {p.category ? ` (${p.category})` : ''}
                                  </option>
                                ))}
                              </select>
                              {prorationLoading && <p className="text-center text-sm text-gray-400">Calculating proration...</p>}
                              {prorationData && !prorationLoading && (
                                <div className="space-y-2 rounded-lg border border-gray-200 bg-white p-3 text-sm">
                                  {prorationData.currentPlan && (
                                    <div className="flex justify-between">
                                      <span className="text-gray-500">Current plan</span>
                                      <span className="font-medium text-black">
                                        {prorationData.currentPlan.name}
                                        {' '}
                                        ($
                                        {prorationData.currentPlan.price.toFixed(2)}
                                        )
                                      </span>
                                    </div>
                                  )}
                                  {prorationData.proration.credit > 0 && (
                                    <>
                                      <div className="flex justify-between">
                                        <span className="text-gray-500">Days remaining in period</span>
                                        <span className="text-black">
                                          {prorationData.proration.daysRemaining}
                                          {' '}
                                          of
                                          {' '}
                                          {prorationData.proration.totalDaysInPeriod}
                                        </span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-gray-500">Pro-rated credit</span>
                                        <span className="font-medium text-green-600">
                                          -$
                                          {prorationData.proration.credit.toFixed(2)}
                                        </span>
                                      </div>
                                    </>
                                  )}
                                  <div className="flex justify-between">
                                    <span className="text-gray-500">New plan price</span>
                                    <span className="font-medium text-black">
                                      $
                                      {prorationData.newPlan.price.toFixed(2)}
                                      {prorationData.newPlan.frequency && prorationData.newPlan.frequency !== 'None' ? ` / ${prorationData.newPlan.frequency.toLowerCase()}` : ''}
                                    </span>
                                  </div>
                                  <div className="flex justify-between border-t border-gray-200 pt-2">
                                    <span className="font-semibold text-black">Net amount due</span>
                                    <span className="font-bold text-black">
                                      $
                                      {prorationData.proration.netAmountDue.toFixed(2)}
                                    </span>
                                  </div>
                                  {prorationData.proration.remainingCredit > 0 && (
                                    <p className="text-xs text-amber-600">
                                      $
                                      {prorationData.proration.remainingCredit.toFixed(2)}
                                      {' '}
                                      excess credit will not be applied
                                    </p>
                                  )}
                                </div>
                              )}
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setIsConverting(false);
                                    setSelectedNewPlanId('');
                                    setProrationData(null);
                                  }}
                                  className="flex-1 cursor-pointer rounded-lg border border-gray-300 py-2 text-sm font-semibold text-gray-600 hover:bg-white"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  onClick={convertMembership}
                                  disabled={!selectedNewPlanId || convertLoading || prorationLoading}
                                  className="flex-1 cursor-pointer rounded-lg bg-black py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
                                >
                                  {convertLoading ? 'Converting...' : 'Confirm'}
                                </button>
                              </div>
                            </div>
                          )}
                        </>
                      )
                    : (
                        <>
                          <p className="text-gray-400">No active membership</p>
                          <button type="button" onClick={() => setIsConverting(true)} className="mt-4 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-gray-200 py-3 text-base font-semibold text-gray-600 transition-all hover:border-black hover:bg-gray-50">
                            <SwapHorizIcon sx={{ fontSize: 20 }} />
                            Assign Membership
                          </button>
                          {isConverting && (
                            <div className="mt-4 space-y-3 rounded-xl border-2 border-black bg-gray-50 p-4">
                              <p className="text-sm font-semibold text-black">Select a membership plan</p>
                              <select
                                value={selectedNewPlanId}
                                onChange={e => setSelectedNewPlanId(e.target.value)}
                                className="w-full rounded-lg border-2 border-gray-300 bg-white px-4 py-3 text-base text-black focus:border-black focus:outline-none"
                              >
                                <option value="">Select a plan...</option>
                                {availablePlans.map(p => (
                                  <option key={p.id} value={p.id}>
                                    {p.name}
                                    {' '}
                                    — $
                                    {p.price.toFixed(2)}
                                    {p.frequency && p.frequency !== 'None' ? ` / ${p.frequency.toLowerCase()}` : ''}
                                  </option>
                                ))}
                              </select>
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setIsConverting(false);
                                    setSelectedNewPlanId('');
                                    setProrationData(null);
                                  }}
                                  className="flex-1 cursor-pointer rounded-lg border border-gray-300 py-2 text-sm font-semibold text-gray-600 hover:bg-white"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  onClick={convertMembership}
                                  disabled={!selectedNewPlanId || convertLoading}
                                  className="flex-1 cursor-pointer rounded-lg bg-black py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
                                >
                                  {convertLoading ? 'Assigning...' : 'Confirm'}
                                </button>
                              </div>
                            </div>
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
                                    {new Date(a.checkInTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })}
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
                    className="cursor-pointer rounded-xl bg-black px-5 py-2 text-sm font-bold text-white transition-all hover:scale-105 active:scale-95"
                  >
                    + Add Family Member
                  </button>
                </div>

                {familyMembers.length > 0
                  ? (
                      <div className="space-y-3">
                        {familyMembers.map(fm => (
                          <div key={fm.id} className="flex items-center justify-between rounded-2xl border-2 border-gray-200 px-6 py-4">
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
                          </div>
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
      {status.replace(/_/g, ' ')}
    </span>
  );
}

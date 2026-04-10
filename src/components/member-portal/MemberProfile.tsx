'use client';

import { use, useEffect, useState } from 'react';
import { OrgContext } from '@/lib/useOrgContext';
import { MemberNav } from './MemberNav';

interface ProfileData {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  dateOfBirth: string | null;
  status: string;
}

export function MemberProfile() {
  const org = use(OrgContext);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({ firstName: '', lastName: '', email: '', phone: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    fetch('/api/member-portal/me')
      .then(r => r.json())
      .then((data) => {
        if (data.member) {
          setProfile(data.member);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const startEditing = () => {
    if (!profile) {
      return;
    }
    setEditForm({
      firstName: profile.firstName,
      lastName: profile.lastName,
      email: profile.email,
      phone: profile.phone ?? '',
    });
    setIsEditing(true);
    setError('');
    setSuccess('');
  };

  const saveProfile = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/member-portal/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      if (!res.ok) {
        throw new Error('Update failed');
      }
      setIsEditing(false);
      setSuccess('Profile updated successfully');
      // Reload profile
      const meRes = await fetch('/api/member-portal/me');
      const meData = await meRes.json();
      if (meData.member) {
        setProfile(meData.member);
      }
    }
    catch {
      setError('Failed to save changes');
    }
    setSaving(false);
  };

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="bg-black p-6">
        <h1 className="text-center text-2xl font-bold text-white">{org?.orgName ?? 'Profile'}</h1>
      </header>
      <MemberNav />
      <main className="mx-auto w-full max-w-2xl flex-1 p-6">
        {loading
          ? <p className="py-16 text-center text-gray-500">Loading...</p>
          : profile && (
            <div className="rounded-2xl border border-gray-200 p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-bold text-black">Your Profile</h2>
                {!isEditing && (
                  <button type="button" onClick={startEditing} className="cursor-pointer text-sm font-semibold text-black hover:underline">Edit</button>
                )}
              </div>

              {error && <p className="mb-4 text-red-500">{error}</p>}
              {success && <p className="mb-4 text-green-600">{success}</p>}

              {isEditing
                ? (
                    <div className="space-y-4">
                      <div>
                        <label htmlFor="prof-first" className="mb-1 block text-sm font-semibold text-gray-500">First Name</label>
                        <input id="prof-first" type="text" value={editForm.firstName} onChange={e => setEditForm(f => ({ ...f, firstName: e.target.value }))} className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-lg text-black focus:border-black focus:outline-none" />
                      </div>
                      <div>
                        <label htmlFor="prof-last" className="mb-1 block text-sm font-semibold text-gray-500">Last Name</label>
                        <input id="prof-last" type="text" value={editForm.lastName} onChange={e => setEditForm(f => ({ ...f, lastName: e.target.value }))} className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-lg text-black focus:border-black focus:outline-none" />
                      </div>
                      <div>
                        <label htmlFor="prof-email" className="mb-1 block text-sm font-semibold text-gray-500">Email</label>
                        <input id="prof-email" type="email" value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-lg text-black focus:border-black focus:outline-none" />
                      </div>
                      <div>
                        <label htmlFor="prof-phone" className="mb-1 block text-sm font-semibold text-gray-500">Phone</label>
                        <input id="prof-phone" type="tel" value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-lg text-black focus:border-black focus:outline-none" />
                      </div>
                      <div className="flex gap-3">
                        <button type="button" onClick={saveProfile} disabled={saving} className="cursor-pointer rounded-xl bg-black px-6 py-3 font-bold text-white transition-all hover:scale-105 disabled:opacity-50">{saving ? 'Saving...' : 'Save'}</button>
                        <button type="button" onClick={() => setIsEditing(false)} className="cursor-pointer rounded-xl border-2 border-gray-200 px-6 py-3 font-bold text-gray-600 transition-all hover:bg-gray-50">Cancel</button>
                      </div>
                    </div>
                  )
                : (
                    <div className="space-y-3">
                      <div className="flex justify-between border-b border-gray-100 py-2">
                        <span className="text-gray-500">Name</span>
                        <span className="font-semibold text-black">
                          {profile.firstName}
                          {' '}
                          {profile.lastName}
                        </span>
                      </div>
                      <div className="flex justify-between border-b border-gray-100 py-2">
                        <span className="text-gray-500">Email</span>
                        <span className="font-semibold text-black">{profile.email}</span>
                      </div>
                      <div className="flex justify-between border-b border-gray-100 py-2">
                        <span className="text-gray-500">Phone</span>
                        <span className="font-semibold text-black">{profile.phone ?? '—'}</span>
                      </div>
                      <div className="flex justify-between py-2">
                        <span className="text-gray-500">Status</span>
                        <span className={`rounded-lg px-3 py-1 text-sm font-semibold capitalize ${
                          profile.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                        }`}
                        >
                          {profile.status}
                        </span>
                      </div>
                    </div>
                  )}
            </div>
          )}
      </main>
    </div>
  );
}

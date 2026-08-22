'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Modal from '@/components/Modal';
import { Spinner } from '@/components/Icon';
import type { User } from '@/lib/types';
import { LabeledInput } from './shared';

// Edit any user account: email/full name, password, disable, delete; for
// clients also the worker's weekly job quota for them.
export default function EditUserModal({
  user,
  onClose,
  jobsPerWeek,
  onQuotaChange,
}: {
  user: User;
  onClose: () => void;
  jobsPerWeek?: number;
  onQuotaChange?: (n: number) => void;
}) {
  const router = useRouter();
  const [email, setEmail] = useState(user.email);
  const [fullName, setFullName] = useState(user.full_name);
  const [quota, setQuota] = useState(jobsPerWeek ?? 20);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSaved, setPwSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isDisabled = !!user.disabled_at;
  const isClient = user.role === 'client';

  async function toggleDelete() {
    const ok = typeof window === 'undefined' ? true : window.confirm(
      user.role === 'worker'
        ? `Permanently delete worker ${user.full_name || user.email}? This cannot be undone.`
        : `Delete client profile ${user.full_name || user.email}? Their jobs stay intact but the profile is hidden.`
    );
    if (!ok) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/users/${user.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Delete failed');
      }
      router.refresh();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setDeleting(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSavedAt(null);
    try {
      const res = await fetch('/api/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: user.id, email, full_name: fullName }),
      });
      // Check res.ok BEFORE reading JSON so an HTML error body doesn't crash.
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(d?.error || 'Save failed');
      }
      // Save the weekly quota to the client's profile (clients only).
      if (isClient && user.profile_id && quota !== jobsPerWeek) {
        const q = await fetch('/api/profiles', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: user.profile_id, jobs_per_week: Number(quota) }),
        });
        if (!q.ok) {
          const qj = await q.json().catch(() => ({}));
          throw new Error(qj.error || 'Could not save weekly quota');
        }
        onQuotaChange?.(Number(quota));
      }
      setSavedAt(Date.now());
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  }

  async function savePassword() {
    if (!pw) return;
    setPwSaving(true);
    setPwError(null);
    setPwSaved(false);
    try {
      const res = await fetch('/api/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: user.id, password: pw }),
      });
      // Check res.ok BEFORE reading JSON so an HTML error body doesn't crash.
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(d?.error || 'Failed');
      }
      setPw('');
      setPwSaved(true);
      setTimeout(() => setPwSaved(false), 1800);
      router.refresh();
    } catch (e) {
      setPwError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setPwSaving(false);
    }
  }

  async function toggleDisable() {
    const action = isDisabled ? 'enable' : 'disable';
    const ok = typeof window === 'undefined' ? true : window.confirm(
      isDisabled
        ? `Re-enable ${user.email}?`
        : `Disable ${user.email}? They won't be able to log in (their jobs stay intact).`
    );
    if (!ok) return;
    setError(null);
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      // Check res.ok BEFORE reading JSON so an HTML error body doesn't crash.
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(d?.error || 'Failed');
      }
      router.refresh();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit ${user.full_name || user.email}`}
      subtitle={`${user.role[0].toUpperCase()}${user.role.slice(1)} account`}
      wide
      footer={
        <>
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-md text-navy-300 hover:bg-navy-800">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-md bg-brand-greenDark text-white hover:bg-brand-green disabled:opacity-50"
          >
            {saving ? <Spinner /> : null}
            {savedAt ? '✓ Saved' : 'Save changes'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {isDisabled && (
          <div className="text-sm text-brand-yellow bg-yellow-500/10 border border-yellow-500/30 rounded-md px-3 py-2">
            This account is disabled ({user.disabled_at ? `since ${new Date(user.disabled_at).toLocaleDateString()}` : ''}).
            They can&apos;t log in until re-enabled.
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <LabeledInput label="Email" value={email} onChange={setEmail} />
          <LabeledInput label="Full name" value={fullName} onChange={setFullName} />
        </div>

        {isClient && (
          <div>
            <label className="block th-uppercase mb-1">Weekly job quota</label>
            <input
              type="number"
              min={1}
              value={quota}
              onChange={(e) => setQuota(Number(e.target.value))}
              className="w-full bg-navy-950 border border-navy-700 rounded-md px-3 py-2 text-sm text-navy-100 focus:outline-none focus:border-brand-blue"
            />
            <p className="text-xs text-navy-500 mt-1">
              Max jobs the assigned worker should apply for this client per week (Mon–Sun).
            </p>
          </div>
        )}

        {error && (
          <div className="text-sm text-brand-red bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
            {error}
          </div>
        )}

        {/* Reset password */}
        <div className="border-t border-navy-700 pt-4">
          <button
            onClick={() => setPwOpen((v) => !v)}
            className="text-sm text-brand-blue hover:underline"
          >
            {pwOpen ? 'Cancel password change' : 'Reset password…'}
          </button>
          {pwOpen && (
            <div className="mt-3 flex items-end gap-2">
              <div className="flex-1">
                <LabeledInput
                  label="New password"
                  value={pw}
                  onChange={setPw}
                  type="password"
                  placeholder="new password"
                />
              </div>
              <button
                onClick={savePassword}
                disabled={pwSaving || !pw}
                className="mb-0.5 inline-flex items-center gap-2 px-3 py-2 text-sm rounded-md bg-navy-800 text-navy-200 hover:bg-navy-750 disabled:opacity-50"
              >
                {pwSaving ? <Spinner /> : null}
                Set password
              </button>
            </div>
          )}
          {pwError && (
            <div className="mt-2 text-sm text-brand-red bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
              {pwError}
            </div>
          )}
          {pwSaved && (
            <p className="mt-2 text-xs text-brand-green">Password updated.</p>
          )}
        </div>

        {/* Disable / enable */}
        <div className="border-t border-navy-700 pt-4">
          <button
            onClick={toggleDisable}
            className={`text-sm rounded-md px-3 py-1.5 ${
              isDisabled
                ? 'bg-brand-green/15 text-brand-green hover:bg-brand-green/25'
                : 'bg-red-500/15 text-brand-red hover:bg-red-500/25'
            }`}
          >
            {isDisabled ? 'Re-enable account' : 'Disable account'}
          </button>
        </div>

        {/* Delete */}
        <div className="border-t border-navy-700 pt-4">
          <button
            onClick={toggleDelete}
            disabled={deleting}
            className="inline-flex items-center gap-2 text-sm rounded-md px-3 py-1.5 bg-red-500/15 text-brand-red hover:bg-red-500/25 disabled:opacity-50"
          >
            {deleting ? <Spinner /> : null}
            {user.role === 'worker' ? 'Delete worker' : 'Delete profile'}
          </button>
          <p className="text-xs text-navy-500 mt-1.5">
            {user.role === 'worker'
              ? 'Permanently removes the account.'
              : 'Soft-deletes the client profile. Their jobs stay intact but are hidden.'}
          </p>
        </div>
      </div>
    </Modal>
  );
}
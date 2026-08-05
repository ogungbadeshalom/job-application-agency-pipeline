'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Modal from '@/components/Modal';
import { Spinner } from '@/components/Icon';
import type { User } from '@/lib/types';
import { LabeledInput } from './shared';

// Edit any user: change email + full name, reset password, disable/re-enable.
// Disabled users keep their FK'd history but cannot log in.
export default function EditUserModal({ user, onClose }: { user: User; onClose: () => void }) {
  const router = useRouter();
  const [email, setEmail] = useState(user.email);
  const [fullName, setFullName] = useState(user.full_name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSaved, setPwSaved] = useState(false);

  const isDisabled = !!user.disabled_at;

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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
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
      title="Edit user"
      subtitle={user.role}
      wide
      footer={
        <>
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-md text-navy-300 hover:bg-navy-800">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-md bg-brand-greenDark text-white hover:bg-emerald-700 disabled:opacity-50"
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

        <div className="grid grid-cols-2 gap-3">
          <LabeledInput label="Email" value={email} onChange={setEmail} />
          <LabeledInput label="Full name" value={fullName} onChange={setFullName} />
        </div>

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
                ? 'bg-emerald-600/20 text-brand-green hover:bg-emerald-600/30'
                : 'bg-red-500/15 text-brand-red hover:bg-red-500/25'
            }`}
          >
            {isDisabled ? 'Re-enable account' : 'Disable account'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
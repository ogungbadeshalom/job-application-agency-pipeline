'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Modal from '@/components/Modal';
import { Spinner } from '@/components/Icon';
import type { ScrapeRun, User } from '@/lib/types';
import { LabeledInput } from './shared';
import AIConfigPanel from './AIConfigPanel';

export default function SettingsTab({ users, scrapeRuns }: { users: User[]; scrapeRuns: ScrapeRun[] }) {
  const [resetTarget, setResetTarget] = useState<User | null>(null);

  return (
    <div className="space-y-6">
      <AIConfigPanel />

      <section className="panel overflow-hidden">
        <div className="p-3 border-b border-navy-700">
          <h3 className="text-sm font-semibold text-navy-200">Team</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-navy-700">
              <th className="th-uppercase text-left px-3 py-2">Name</th>
              <th className="th-uppercase text-left px-3 py-2">Email</th>
              <th className="th-uppercase text-left px-3 py-2">Role</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-navy-800">
                <td className="px-3 py-2.5 text-navy-100">{u.full_name}</td>
                <td className="px-3 py-2.5 text-navy-400">{u.email}</td>
                <td className="px-3 py-2.5 capitalize text-navy-300">{u.role}</td>
                <td className="px-3 py-2.5 text-right">
                  <button
                    onClick={() => setResetTarget(u)}
                    className="px-2.5 py-1 text-xs rounded-md bg-navy-800 text-navy-200 hover:bg-navy-750"
                  >
                    Reset password
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel overflow-hidden">
        <div className="p-3 border-b border-navy-700">
          <h3 className="text-sm font-semibold text-navy-200">Scrape Run History</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-navy-700">
              <th className="th-uppercase text-left px-3 py-2">Status</th>
              <th className="th-uppercase text-left px-3 py-2">Sites</th>
              <th className="th-uppercase text-left px-3 py-2">Terms</th>
              <th className="th-uppercase text-left px-3 py-2">Found</th>
              <th className="th-uppercase text-left px-3 py-2">Added</th>
              <th className="th-uppercase text-left px-3 py-2">Date</th>
            </tr>
          </thead>
          <tbody>
            {scrapeRuns.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-navy-500">No scrape runs yet.</td>
              </tr>
            )}
            {scrapeRuns.map((r) => (
              <tr key={r.id} className="border-b border-navy-800">
                <td className="px-3 py-2.5">
                  <ScrapeStatus status={r.status} />
                </td>
                <td className="px-3 py-2.5 text-navy-400">{(r.sites || []).join(', ')}</td>
                <td className="px-3 py-2.5 text-navy-500 text-xs">{(r.search_terms || []).join(', ')}</td>
                <td className="px-3 py-2.5 text-navy-300">{r.jobs_found}</td>
                <td className="px-3 py-2.5 text-brand-green">{r.jobs_added}</td>
                <td className="px-3 py-2.5 text-navy-500 text-xs">
                  {r.created_at ? new Date(r.created_at).toLocaleString() : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {resetTarget && (
        <ResetPasswordModal user={resetTarget} onClose={() => setResetTarget(null)} />
      )}
    </div>
  );
}

function ResetPasswordModal({ user, onClose }: { user: User; onClose: () => void }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: user.id, password }),
      });
      // Check res.ok BEFORE reading JSON so an HTML error body doesn't crash.
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(d?.error || 'Failed');
      }
      onClose();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Reset password — ${user.email}`}
      footer={
        <>
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-md text-navy-300 hover:bg-navy-800">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={loading || !password}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-md bg-brand-greenDark text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {loading ? <Spinner /> : null}
            Set password
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <LabeledInput
          label="New password"
          value={password}
          onChange={setPassword}
          placeholder="temporary password"
        />
        {error && (
          <div className="text-sm text-brand-red bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}

function ScrapeStatus({ status }: { status: ScrapeRun['status'] }) {
  const map: Record<ScrapeRun['status'], { c: string; t: string }> = {
    pending: { c: 'bg-navy-700 text-navy-300', t: 'Pending' },
    running: { c: 'bg-blue-500/15 text-brand-blue', t: 'Running' },
    completed: { c: 'bg-emerald-500/15 text-brand-green', t: 'Completed' },
    failed: { c: 'bg-red-500/15 text-brand-red', t: 'Failed' },
  };
  // Guard against any unexpected/null legacy value so an unknown status can't
  // crash the whole Settings tab (map[status] would be undefined -> `.c` throws).
  const s = map[status] ?? { c: 'bg-navy-700 text-navy-300', t: String(status) };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${s.c}`}>{s.t}</span>;
}
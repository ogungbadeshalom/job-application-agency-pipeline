'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Modal from '@/components/Modal';
import { Spinner } from '@/components/Icon';
import type { ScrapeRun, User } from '@/lib/types';
import { LabeledInput } from './shared';
import AIConfigPanel from './AIConfigPanel';
import MaintenancePanel from './MaintenancePanel';

export default function SettingsTab({ users, scrapeRuns }: { users: User[]; scrapeRuns: ScrapeRun[] }) {
  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const router = useRouter();

  async function deleteRun(r: ScrapeRun) {
    const label =
      `${(r.sites || []).join(', ') || 'no sites'} · ${(r.search_terms || []).join(', ')}`.trim() ||
      r.id;
    if (!window.confirm(`Delete this scrape run?\n\n${label}\n\nJobs added by it stay in the queue — only the history entry is removed.`)) {
      return;
    }
    setDeletingId(r.id);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/scrape-runs/${r.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(d?.error || `Delete failed (${res.status})`);
      }
      router.refresh();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <AIConfigPanel />
      <MaintenancePanel />

      <section className="panel overflow-hidden">
        <div className="p-3 border-b border-navy-700">
          <h3 className="text-sm font-semibold text-navy-200">Team</h3>
        </div>
        {/* Mobile cards */}
        <div className="md:hidden divide-y divide-navy-800">
          {users.map((u) => (
            <div key={u.id} className="p-3.5 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium text-navy-100">{u.full_name}</div>
                <div className="text-sm text-navy-400 truncate">{u.email}</div>
                <div className="text-xs capitalize text-navy-500">{u.role}</div>
              </div>
              <button
                onClick={() => setResetTarget(u)}
                className="shrink-0 px-2.5 py-1 text-xs rounded-md bg-navy-800 text-navy-200 hover:bg-navy-750"
              >
                Reset password
              </button>
            </div>
          ))}
        </div>
        {/* Desktop table */}
        <div className="hidden md:block">
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
        </div>
      </section>

      <section className="panel overflow-hidden">
        <div className="p-3 border-b border-navy-700">
          <h3 className="text-sm font-semibold text-navy-200">Scrape Run History</h3>
        </div>
        {deleteError && (
          <div className="mx-3 mt-3 text-sm text-brand-red bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
            {deleteError}
          </div>
        )}
        {/* Mobile cards */}
        <div className="md:hidden divide-y divide-navy-800">
          {scrapeRuns.length === 0 && <p className="p-4 text-center text-navy-500 text-sm">No runs yet.</p>}
          {scrapeRuns.map((r) => (
            <div key={r.id} className="p-3.5 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className={`text-xs px-2 py-0.5 rounded capitalize ${
                  r.status === 'completed' ? 'bg-emerald-500/15 text-brand-green'
                  : r.status === 'running' ? 'bg-amber-500/15 text-amber-200'
                  : r.status === 'failed' ? 'bg-red-500/15 text-brand-red'
                  : 'bg-navy-800 text-navy-400'
                }`}>{r.status}</span>
                <span className="text-xs text-navy-400">
                  {new Date(r.started_at || Date.now()).toLocaleDateString()}
                </span>
              </div>
              <div className="text-xs text-navy-400 truncate">
                {(r.sites || []).join(', ') || '—'} · {(r.search_terms || []).join(', ')}
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-navy-300">
                  {r.jobs_found ?? 0} found · {r.jobs_added ?? 0} added
                </div>
                <button
                  onClick={() => deleteRun(r)}
                  disabled={deletingId === r.id}
                  className="shrink-0 px-2 py-1 text-xs rounded-md text-navy-500 hover:text-brand-red hover:bg-red-500/10 disabled:opacity-40"
                >
                  {deletingId === r.id ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          ))}
        </div>
        {/* Desktop table */}
        <div className="hidden md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-navy-700">
              <th className="th-uppercase text-left px-3 py-2">Status</th>
              <th className="th-uppercase text-left px-3 py-2">Sites</th>
              <th className="th-uppercase text-left px-3 py-2">Terms</th>
              <th className="th-uppercase text-left px-3 py-2">Found</th>
              <th className="th-uppercase text-left px-3 py-2">Added</th>
              <th className="th-uppercase text-left px-3 py-2">Date</th>
              <th className="th-uppercase text-right px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {scrapeRuns.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-navy-500">No scrape runs yet.</td>
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
                <td className="px-3 py-2.5 text-right">
                  <button
                    onClick={() => deleteRun(r)}
                    disabled={deletingId === r.id}
                    className="px-2.5 py-1 text-xs rounded-md text-navy-500 hover:text-brand-red hover:bg-red-500/10 disabled:opacity-40"
                  >
                    {deletingId === r.id ? 'Deleting…' : 'Delete'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
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
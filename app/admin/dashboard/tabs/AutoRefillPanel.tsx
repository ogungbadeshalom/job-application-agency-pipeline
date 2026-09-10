'use client';

import { useEffect, useState, useCallback } from 'react';
import { Spinner } from '@/components/Icon';

interface Status {
  active: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  totalProfiles: number;
  doneProfiles: number;
  totalJobsAdded: number;
  currentName: string | null;
  currentStep: string;
  currentJobsFound: number;
  message: string;
  trigger: 'cron' | 'manual';
}

const IDLE: Status = {
  active: false,
  startedAt: null,
  finishedAt: null,
  totalProfiles: 0,
  doneProfiles: 0,
  totalJobsAdded: 0,
  currentName: null,
  currentStep: 'Idle',
  currentJobsFound: 0,
  message: 'Idle',
  trigger: 'cron',
};

// Admin control for the daily AUTO-REFILL of workers' queues. Toggles the
// nightly run + time, and shows the SAME live status workers see, so the admin
// knows exactly when it's running and how many jobs each profile got.
export default function AutoRefillPanel() {
  const [enabled, setEnabled] = useState(false);
  const [time, setTime] = useState('09:00');
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(IDLE);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/auto-refill');
      if (!r.ok) return;
      const d = await r.json();
      setEnabled(d.enabled ?? false);
      setTime(d.time || '09:00');
      setLastRunAt(d.lastRunAt || null);
      if (d.status) setStatus(d.status);
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  // Live poll while running (same cadence the worker UI uses).
  useEffect(() => {
    let dead = false;
    const poll = async () => {
      if (dead) return;
      try {
        const r = await fetch('/api/auto-refill/status');
        if (r.ok) setStatus((await r.json()) as Status);
      } catch {}
      if (!dead) setTimeout(poll, 2500);
    };
    poll();
    return () => { dead = true; };
  }, []);

  async function save() {
    setSaving(true); setError(null); setNotice(null);
    try {
      const res = await fetch('/api/auto-refill', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, time }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) throw new Error(d?.error || `Save failed (${res.status})`);
      setNotice(d?.message || 'Saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally { setSaving(false); }
  }

  async function runNow() {
    setBusy(true); setError(null); setNotice(null);
    try {
      const res = await fetch('/api/auto-refill', { method: 'POST' });
      const d = await res.json().catch(() => null);
      if (!res.ok) throw new Error(d?.error || `Start failed (${res.status})`);
      setStatus((s) => ({ ...s, active: true, ...(d?.status || {}) }));
      setNotice('Auto-refill started — progress updates live below.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Start failed');
    } finally { setBusy(false); }
  }

  const running = status.active;

  return (
    <section className="panel overflow-hidden">
      <div className="p-3 border-b border-navy-700 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-navy-200">Auto-refill (daily)</h3>
        {running && (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-green">
            <Spinner className="h-3.5 w-3.5" /> RUNNING
          </span>
        )}
      </div>

      <div className="p-4 space-y-4">
        <p className="text-sm text-navy-400 leading-relaxed">
          When enabled, every worker&apos;s queue is automatically refilled with
          fresh remote jobs at the chosen time each day. If a worker taps
          &quot;Refill&quot; while it&apos;s running, they&apos;ll see an
          &quot;auto-refill in progress&quot; notice instead of stacking a second
          scrape (which caused duplicate entries).
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm text-navy-200">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="accent-[var(--accent)] h-4 w-4"
            />
            Enable daily auto-refill
          </label>
          <label className="flex items-center gap-2 text-sm text-navy-200">
            <span>Daily time</span>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="bg-navy-800 border border-navy-700 rounded-md px-2 py-1 text-sm text-navy-100"
            />
          </label>
        </div>

        {lastRunAt && !running && (
          <div className="text-xs text-navy-400">
            Last run: <span className="text-navy-200">{new Date(lastRunAt).toLocaleString()}</span>
          </div>
        )}

        {/* Live status block */}
        <div className={`rounded-md border p-3 text-sm ${running ? 'border-brand-green/40 bg-brand-green/5' : 'border-navy-700 bg-navy-800/40'}`}>
          {running ? (
            <div className="space-y-1">
              <div className="font-medium text-brand-green">
                {status.currentName || 'Auto-refill'} — {status.currentStep}
              </div>
              <div className="text-navy-300">
                Profile {Math.min(status.doneProfiles + 1, status.totalProfiles)}/{status.totalProfiles} · {status.currentJobsFound} jobs found · {status.totalJobsAdded} added so far
              </div>
            </div>
          ) : (
            <div className="text-navy-300">{status.message || 'Idle'}</div>
          )}
        </div>

        {error && <div className="text-sm text-brand-red">{error}</div>}
        {notice && <div className="text-sm text-brand-green">{notice}</div>}

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="px-3 py-1.5 rounded-md bg-brand-green text-navy-950 text-sm font-semibold disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save settings'}
          </button>
          <button
            onClick={runNow}
            disabled={busy || running}
            className="px-3 py-1.5 rounded-md bg-navy-800 text-navy-100 text-sm hover:bg-navy-750 disabled:opacity-50"
          >
            {running ? 'Running…' : 'Run now'}
          </button>
        </div>
      </div>
    </section>
  );
}
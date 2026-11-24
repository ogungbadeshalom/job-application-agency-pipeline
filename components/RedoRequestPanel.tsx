'use client';

import { useState } from 'react';
import type { Job } from '@/lib/types';
import { REDO_REASONS, REDO_REASON_LABELS, type RedoReason } from '@/lib/types';
import { Spinner } from './Icon';

// Client-facing "this application needs redoing" control.
//
// Rendered in the client's job modal. A redo is a FLAG on the job, not a status
// change, so the client still sees that the application was submitted — they
// are reporting a problem with it, not erasing it.
//
// States:
//   open flag    -> show reason + note + "waiting on your agent"
//   none         -> "Request a redo" button opening a small reason picker
//   resolved     -> show when it was reworked, allow re-flagging
export default function RedoRequestPanel({
  job,
  onFlagged,
}: {
  job: Job;
  onFlagged?: (updated: Job) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<RedoReason>('wrong_resume');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOpen = Boolean(job.redo_requested_at) && !job.redo_resolved_at;
  const isResolved = Boolean(job.redo_requested_at) && Boolean(job.redo_resolved_at);

  // Only a submitted application can be redone — mirrors the server check so
  // the button never appears for work that was never sent.
  const canFlag = Boolean(job.submitted_at) || ['applied', 'confirmed', 'interview'].includes(job.status);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/client/jobs/${job.id}/redo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, note }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Could not flag this job');
      setOpen(false);
      setNote('');
      onFlagged?.(data.job);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  }

  if (isOpen) {
    return (
      <div className="rounded-md border border-amber-400/40 bg-amber-400/10 px-4 py-3">
        <div className="text-sm font-semibold text-amber-300">Redo requested</div>
        <div className="mt-1 text-sm text-navy-300">
          {job.redo_reason ? REDO_REASON_LABELS[job.redo_reason as RedoReason] ?? job.redo_reason : 'Flagged for rework'}
          {job.redo_note ? <span className="block mt-1 text-navy-400">&ldquo;{job.redo_note}&rdquo;</span> : null}
        </div>
        <p className="mt-2 text-xs text-navy-500">
          Your agent has been notified and will rework this application.
        </p>
      </div>
    );
  }

  if (!canFlag) return null;

  if (isResolved) {
    return (
      <div className="rounded-md border border-navy-700 bg-navy-900 px-4 py-3">
        <div className="text-sm font-semibold text-navy-200">Previously redone</div>
        <p className="mt-1 text-xs text-navy-400">
          You asked for this to be redone and your agent has since reworked it.
        </p>
        {!open && (
          <button
            onClick={() => setOpen(true)}
            className="mt-2 text-xs text-brand-blue hover:underline"
          >
            Request another redo
          </button>
        )}
        {open && renderPicker()}
      </div>
    );
  }

  return (
    <div>
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 border border-amber-400/30"
        >
          Something wrong? Request a redo
        </button>
      ) : (
        renderPicker()
      )}
      {error && (
        <div className="mt-2 text-sm text-brand-red bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
          {error}
        </div>
      )}
    </div>
  );

  function renderPicker() {
    return (
      <div className="rounded-md border border-navy-700 bg-navy-900 p-3 space-y-3">
        <div>
          <label htmlFor="redo-reason" className="block th-uppercase mb-1">
            What was wrong?
          </label>
          <select
            id="redo-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value as RedoReason)}
            className="w-full bg-navy-950 border border-navy-700 rounded-md px-2.5 py-1.5 text-sm text-navy-100 focus:outline-none focus:border-brand-blue"
          >
            {REDO_REASONS.map((r) => (
              <option key={r} value={r}>
                {REDO_REASON_LABELS[r]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="redo-note" className="block th-uppercase mb-1">
            Anything else? (optional)
          </label>
          <textarea
            id="redo-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1000}
            rows={2}
            placeholder="e.g. the resume sent was for a different role"
            className="w-full bg-navy-950 border border-navy-700 rounded-md px-2.5 py-1.5 text-sm text-navy-100 focus:outline-none focus:border-brand-blue resize-y"
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={submit}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-amber-400/20 text-amber-200 hover:bg-amber-400/30 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? <Spinner /> : null}
            Send redo request
          </button>
          <button
            onClick={() => {
              setOpen(false);
              setError(null);
            }}
            disabled={busy}
            className="px-3 py-1.5 text-sm rounded-md bg-navy-800 text-navy-300 hover:bg-navy-750 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }
}

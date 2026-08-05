'use client';

import { useState } from 'react';
import type { Job, JobStatus } from '@/lib/types';
import { STATUS_OPTIONS } from './StatusBadge';

const SECONDARY: JobStatus[] = ['rejected', 'interview', 'offer', 'withdrawn'];

export default function SubmissionPanel({
  job,
  onUpdated,
}: {
  job: Job;
  onUpdated?: (patch: Partial<Job>) => void;
}) {
  const [status, setStatus] = useState<JobStatus>(job.status);
  const [notes, setNotes] = useState(job.notes ?? '');
  const [proof, setProof] = useState(job.proof_of_submission ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function patch(body: Partial<Job>) {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Update failed');
      }
      const updated = await res.json();
      onUpdated?.(updated.job ?? body);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      return updated.job as Job;
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(s: JobStatus) {
    setStatus(s);
    const body: Partial<Job> = { status: s };
    if (s === 'applied' && !job.submitted_at) body.submitted_at = new Date().toISOString();
    await patch(body);
  }

  async function saveDetails() {
    await patch({ notes, proof_of_submission: proof });
  }

  return (
    <div className="space-y-4">
      <div className="panel p-4 space-y-3">
        <div>
          <label className="block th-uppercase mb-1">Status</label>
          <div className="flex flex-wrap gap-2">
            <select
              value={status}
              onChange={(e) => changeStatus(e.target.value as JobStatus)}
              className="bg-navy-950 border border-navy-700 rounded-md px-2.5 py-1.5 text-sm text-navy-100 focus:outline-none focus:border-brand-blue"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <button
              onClick={() => changeStatus('applied')}
              className="px-3 py-1.5 text-sm rounded-md bg-emerald-600/20 text-brand-green hover:bg-emerald-600/30"
            >
              Mark Applied
            </button>
            {SECONDARY.map((s) => (
              <button
                key={s}
                onClick={() => changeStatus(s)}
                className="px-3 py-1.5 text-sm rounded-md bg-navy-800 text-navy-300 hover:bg-navy-750 capitalize"
              >
                {s}
              </button>
            ))}
          </div>
          <p className="text-xs text-navy-500 mt-1.5">
            Applied date: {job.submitted_at ? new Date(job.submitted_at).toLocaleString() : '—'}
          </p>
        </div>
      </div>

      <div className="panel p-4 space-y-3">
        <div>
          <label className="block th-uppercase mb-1">Proof of submission</label>
          <textarea
            value={proof}
            onChange={(e) => setProof(e.target.value)}
            placeholder="Paste confirmation email snippet…"
            className="w-full h-24 bg-navy-950 border border-navy-700 rounded-md p-2.5 text-sm text-navy-100 focus:outline-none focus:border-brand-blue"
          />
        </div>
        <div>
          <label className="block th-uppercase mb-1">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Recruiter contact, follow-ups…"
            className="w-full h-20 bg-navy-950 border border-navy-700 rounded-md p-2.5 text-sm text-navy-100 focus:outline-none focus:border-brand-blue"
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={saveDetails}
            disabled={saving}
            className="px-3 py-1.5 text-sm rounded-md bg-navy-800 text-navy-200 hover:bg-navy-750 disabled:opacity-50"
          >
            Save details
          </button>
          {saved && <span className="text-xs text-brand-green">✓ Saved</span>}
        </div>
      </div>
    </div>
  );
}

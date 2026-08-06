'use client';

import { useRef, useState } from 'react';
import type { Job, JobStatus } from '@/lib/types';
import { STATUS_OPTIONS } from './StatusBadge';
import { Spinner } from './Icon';

// SubmissionTracking panel:
//   - status saved/tailored/applied/skipped (+ Mark Applied + Skip/Unskip)
//   - proof of submission as an IMAGE upload (stored on disk, shown to clients)
//   - internal notes
export default function SubmissionPanel({
  job,
  onUpdated,
}: {
  job: Job;
  onUpdated?: (patch: Partial<Job>) => void;
}) {
  const [status, setStatus] = useState<JobStatus>(job.status);
  const [notes, setNotes] = useState(job.notes ?? '');
  const [proofUrl, setProofUrl] = useState(job.proof_of_submission ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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

  // Upload a proof-of-submission image to local disk, then store its path on the job.
  async function uploadProof(file: File) {
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('job_id', job.id);
      const res = await fetch('/api/upload-proof', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      const path = data.path as string;
      setProofUrl(path);
      await patch({ proof_of_submission: path });
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function saveDetails() {
    await patch({ notes, proof_of_submission: proofUrl });
  }

  const isSkipped = status === 'skipped';

  return (
    <div className="space-y-4">
      <div className="panel p-4 space-y-3">
        <div>
          <label className="block th-uppercase mb-1">Status</label>
          <div className="flex flex-wrap gap-2 items-center">
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
              disabled={status === 'applied'}
              className="px-3 py-1.5 text-sm rounded-md bg-emerald-600/20 text-brand-green hover:bg-emerald-600/30 disabled:opacity-40"
            >
              Mark Applied
            </button>
            {isSkipped ? (
              <button
                onClick={() => changeStatus('tailored')}
                className="px-3 py-1.5 text-sm rounded-md bg-emerald-600/20 text-brand-green hover:bg-emerald-600/30"
              >
                Unskip
              </button>
            ) : (
              <button
                onClick={() => changeStatus('skipped')}
                className="px-3 py-1.5 text-sm rounded-md bg-navy-800 text-navy-300 hover:bg-navy-750"
              >
                Skip
              </button>
            )}
          </div>
          <p className="text-xs text-navy-500 mt-1.5">
            Applied date: {job.submitted_at ? new Date(job.submitted_at).toLocaleString() : '—'}
          </p>
        </div>
      </div>

      <div className="panel p-4 space-y-3">
        <div>
          <label className="block th-uppercase mb-1.5">Proof of submission</label>
          {proofUrl ? (
            <div className="flex flex-col gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/files/${proofUrl.split('/').filter(Boolean).join('/')}`}
                alt="Proof of submission"
                className="max-w-xs rounded-md border border-navy-700"
              />
              <button
                onClick={() => fileRef.current?.click()}
                className="self-start px-2.5 py-1 text-xs rounded-md bg-navy-800 text-navy-200 hover:bg-navy-750"
              >
                Replace image
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-md border border-dashed border-navy-600 text-navy-300 hover:border-brand-blue hover:text-navy-100 disabled:opacity-50"
            >
              {uploading ? <Spinner /> : null}
              {uploading ? 'Uploading…' : 'Upload proof (image)'}
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadProof(f);
              e.target.value = '';
            }}
          />
          {uploadError && (
            <div className="mt-2 text-sm text-brand-red bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
              {uploadError}
            </div>
          )}
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
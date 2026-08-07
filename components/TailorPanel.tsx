'use client';

import { useState } from 'react';
import { Copy, Download, Spinner } from './Icon';
import type { Job, Profile } from '@/lib/types';

export default function TailorPanel({
  job,
  profile,
  onSaved,
}: {
  job: Job;
  profile: Profile;
  onSaved?: (tailored: string) => void;
}) {
  const [output, setOutput] = useState(job.tailored_resume ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  async function tailor() {
    setLoading(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch('/api/tailor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: job.id }),
      });
      // Check res.ok BEFORE res.json() so an HTML error page doesn't throw
      // "Unexpected token '<'" instead of surfacing the real error.
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(d?.error || 'Tailor failed');
      }
      // Parse defensively so an HTML/oddly-empty body can't throw
      // "Unexpected token '<'".
      const data = (await res.json().catch(() => null)) ?? {};
      if (typeof data.tailored_resume !== 'string') {
        throw new Error('Tailor returned no resume text. Please try again.');
      }
      setOutput(data.tailored_resume);
      onSaved?.(data.tailored_resume);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tailored_resume: output }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(d?.error || 'Save failed');
      }
      setSaved(true);
      onSaved?.(output);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  async function downloadPdf() {
    setError(null);
    try {
      const safeTitle = job.title || 'job';
      const safeCompany = job.company || 'resume';
      const res = await fetch('/api/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: output, filename: `${safeCompany}-${safeTitle}-resume.txt` }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(d?.error || 'PDF generation failed');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeCompany}-tailored.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    }
  }

  async function copy() {
    setError(null);
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Clipboard unavailable — copy the text manually from the box below.');
    }
  }

  return (
    <div className="space-y-4">
      <div className="panel p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-navy-200">Base resume</h3>
          <span className="text-xs text-navy-500">{profile.name}</span>
        </div>
        <pre className="text-xs text-navy-400 whitespace-pre-wrap font-mono max-h-40 overflow-y-auto">
          {profile.base_resume_text || 'No base resume uploaded for this client.'}
        </pre>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={tailor}
          disabled={loading || !profile.base_resume_text}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-md bg-emerald-600/20 text-brand-green hover:bg-emerald-600/30 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? <Spinner /> : null}
          {output ? 'Re-tailor for this job' : 'Tailor for this job'}
        </button>
        {output && (
          <>
            <button
              onClick={copy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-navy-800 text-navy-200 hover:bg-navy-750"
            >
              <Copy size={14} /> {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              onClick={downloadPdf}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-navy-800 text-navy-200 hover:bg-navy-750"
            >
              <Download size={14} /> PDF
            </button>
            <button
              onClick={save}
              disabled={loading}
              className="px-3 py-1.5 text-sm rounded-md bg-navy-800 text-navy-200 hover:bg-navy-750 disabled:opacity-50"
            >
              {saved ? '✓ Saved' : 'Save'}
            </button>
          </>
        )}
      </div>

      {error && (
        <div className="text-sm text-brand-red bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {output && (
        <div className="panel p-4">
          <h3 className="text-sm font-semibold text-navy-200 mb-2">Tailored resume</h3>
          <textarea
            value={output}
            onChange={(e) => {
              setOutput(e.target.value);
              setSaved(false);
            }}
            className="w-full h-72 bg-navy-950 border border-navy-700 rounded-md p-3 text-sm font-mono text-navy-100 focus:outline-none focus:border-brand-blue resize-y"
          />
        </div>
      )}
    </div>
  );
}

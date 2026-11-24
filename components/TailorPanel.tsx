'use client';

import { useState } from 'react';
import { Copy, Download, Spinner } from './Icon';
import { copyText } from '@/lib/copy';
import type { Job, Profile } from '@/lib/types';

// Live stage -> button label, mirroring the server's tailor_status values.
const STAGE_LABEL: Record<string, string> = {
  generating: 'Generating…',
  'ats-scoring': 'ATS scoring…',
  improving: 'Improving…',
  finalizing: 'Finalizing…',
};

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
  const [pdfUrl, setPdfUrl] = useState<string | null>(job.tailored_resume_pdf_url ?? null);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  // Persist the current tailored resume to the job (server-side) so it's
  // visible to clients/admin immediately. Reused by both the Tailor action
  // (auto-save) and the manual Save button.
  async function persist(text: string): Promise<void> {
    const res = await fetch(`/api/jobs/${job.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tailored_resume: text }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      throw new Error(d?.error || 'Save failed');
    }
  }

  async function tailor() {
    setLoading(true);
    setError(null);
    setSaved(false);
    try {
      // POST only STARTS the run (a tailor makes 2-4 AI calls and can take
      // 60-180s, longer than the edge/proxy timeout allows for one request).
      // Then poll GET /api/tailor until the run reports done.
      const res = await fetch('/api/tailor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: job.id }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(d?.error || 'Tailor failed to start');
      }

      // Poll every 2s. A run is "done" when tailor_status clears; the result
      // (or the failure reason) arrives on the same payload.
      const deadline = Date.now() + 15 * 60 * 1000;
      for (;;) {
        await new Promise((r) => setTimeout(r, 2000));
        if (Date.now() > deadline) throw new Error('Tailoring timed out. Please try again.');

        const poll = await fetch(`/api/tailor?jobId=${job.id}`, { cache: 'no-store' });
        if (!poll.ok) {
          const d = await poll.json().catch(() => null);
          throw new Error(d?.error || 'Lost track of the tailor run');
        }
        const d = (await poll.json()) as {
          done: boolean;
          tailor_status: string | null;
          tailor_error: string | null;
          tailored_resume: string | null;
          tailored_resume_pdf_url: string | null;
        };
        if (d.tailor_status) {
          // Mirror the live stage in the button label.
          setStage(d.tailor_status);
        }
        if (!d.done) continue;

        setStage(null);
        if (d.tailor_error) throw new Error(d.tailor_error);
        if (typeof d.tailored_resume !== 'string' || !d.tailored_resume.trim()) {
          throw new Error('Tailor returned no resume text. Please try again.');
        }
        setOutput(d.tailored_resume);
        setPdfUrl(d.tailored_resume_pdf_url ?? null);
        setSaved(true); // the server already persisted the result
        onSaved?.(d.tailored_resume);
        break;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setStage(null);
      setLoading(false);
    }
  }

  async function save() {
    setLoading(true);
    setError(null);
    try {
      await persist(output);
      setSaved(true);
      onSaved?.(output);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  function downloadPdf() {
    setError(null);
    if (!pdfUrl) {
      setError('No formatted PDF yet — click Tailor first to generate one.');
      return;
    }
    try {
      const a = document.createElement('a');
      a.href = `/api/files/${pdfUrl}`;
      a.download = `${job.company || 'tailored'}-${job.title || 'resume'}.pdf`.replace(/[^\w\-.]/g, '_');
      a.click();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    }
  }

  async function copy() {
    setError(null);
    try {
      const ok = await copyText(output);
      if (!ok) throw new Error('copy failed');
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
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-md bg-brand-green/15 text-brand-green hover:bg-brand-green/25 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? <Spinner /> : null}
          {loading
            ? STAGE_LABEL[stage ?? ''] ?? 'Tailoring…'
            : output
              ? 'Re-tailor for this job'
              : 'Tailor for this job'}
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
              disabled={!pdfUrl}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-navy-800 text-navy-200 hover:bg-navy-750 disabled:opacity-50 disabled:cursor-not-allowed"
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

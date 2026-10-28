'use client';

import { useState } from 'react';

// Client-facing "Test resume generation" — paste a job description and the app
// tailors the client's OWN base resume to it, showing the result + ATS score.
// Self-contained: NO queue, NO worker, NO submission. Just a live demo.
export default function ResumeLabTest() {
  const [jd, setJd] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const [regenScore, setRegenScore] = useState<number | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    const raw = jd.trim();
    if (!raw) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setScore(null);
    setRegenScore(null);
    setStatus('Tailoring your resume to this job description…');
    let title = 'Role';
    let description = raw;
    const nl = raw.indexOf('\n');
    if (nl > -1) {
      title = raw.slice(0, nl).trim() || 'Role';
      description = raw.slice(nl + 1).trim();
    }
    try {
      const res = await fetch('/api/client/tailor-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description, title }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setStatus(null);
        setError((data && data.error) || `Request failed (${res.status})`);
        return;
      }
      setScore(typeof data.atsScore === 'number' ? data.atsScore : null);
      setRegenScore(typeof data.atsScoreAfterRegen === 'number' ? data.atsScoreAfterRegen : null);
      if (data.text) {
        setResult(data.text);
        setStatus(null);
      } else {
        setStatus(null);
        setError('No resume returned.');
      }
    } catch (e) {
      setStatus(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel p-4 mb-4">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <h2 className="text-sm font-semibold text-navy-100">Test resume generation</h2>
        {score != null && (
          <span
            className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border ${
              score >= 70
                ? 'text-brand-green border-brand-green/40 bg-brand-green/10'
                : score >= 45
                  ? 'text-amber-400 border-amber-400/40 bg-amber-400/10'
                  : 'text-brand-red border-red-400/40 bg-red-400/10'
            }`}
          >
            ATS {score}/100
          </span>
        )}
      </div>
      <p className="text-sm text-navy-400 mb-3">
        Paste any job description and see how your resume would be tailored to match it — no application is
        submitted, this is just a preview. Put the role title on the first line.
      </p>
      <textarea
        value={jd}
        onChange={(e) => setJd(e.target.value)}
        rows={5}
        placeholder={'Senior DevOps Engineer\ne.g. We are hiring a Senior DevOps Engineer with AWS, Kubernetes, Terraform and CI/CD…'}
        className="w-full bg-navy-950 border border-navy-700 rounded-md px-3 py-2 text-sm text-navy-100 focus:outline-none focus:border-brand-blue resize-y"
      />
      <div className="mt-2 flex items-center gap-3">
        <button
          onClick={generate}
          disabled={busy || !jd.trim()}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-md bg-brand-greenDark text-white hover:bg-brand-green disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? 'Tailoring…' : 'Generate tailored resume'}
        </button>
        {regenScore != null && (
          <span className="text-xs text-navy-400">auto-regen to {regenScore}/100</span>
        )}
        {status && <span className="text-xs text-brand-blue animate-pulse">{status}</span>}
        {error && <span className="text-xs text-brand-red">{error}</span>}
      </div>

      {result && (
        <pre className="mt-3 text-xs text-navy-300 whitespace-pre-wrap font-mono bg-navy-950 border border-navy-800 rounded-md p-3 max-h-96 overflow-y-auto">
          {result}
        </pre>
      )}
    </div>
  );
}
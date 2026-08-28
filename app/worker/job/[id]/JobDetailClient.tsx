'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/DashboardLayout';
import StatusBadge from '@/components/StatusBadge';
import TailorPanel from '@/components/TailorPanel';
import QuestionPanel from '@/components/QuestionPanel';
import SubmissionPanel from '@/components/SubmissionPanel';
import { External } from '@/components/Icon';
import type { Job, Profile, User } from '@/lib/types';

type Tab = 'tailor' | 'question' | 'submission';

export default function JobDetailClient({
  user,
  nav,
  job: initialJob,
  profile,
}: {
  user: User;
  nav: { href: string; label: string; badge?: number }[];
  job: Job;
  profile: Profile;
}) {
  const router = useRouter();
  const [job, setJob] = useState(initialJob);
  const [tab, setTab] = useState<Tab>('tailor');

  // Mark this job as "last viewed" so the worker's queue can point them back
  // here ("Continue where I left off"). Fire-and-forget.
  useEffect(() => {
    if (!initialJob.id || initialJob.status === 'applied' || initialJob.status === 'skipped') return;
    fetch(`/api/jobs/${initialJob.id}/view`, { method: 'POST' }).catch(() => {});
  }, [initialJob.id, initialJob.status]);

  // Update local state AND refresh the server tree so the queue reflect changes
  // immediately (no hard reload needed).
  function updateJob(patch: Partial<Job>) {
    setJob((prev) => ({ ...prev, ...patch }));
    router.refresh();
  }

  // ATS fitness scan: ask the AI to score the resume against this job's JD,
  // then persist + display the result. One at a time, capped.
  const [atsBusy, setAtsBusy] = useState(false);
  const [atsError, setAtsError] = useState<string | null>(null);
  async function runAtsScan() {
    setAtsBusy(true);
    setAtsError(null);
    try {
      const res = await fetch('/api/ats-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: job.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Scan failed (${res.status})`);
      updateJob({ ats_score: data?.score?.overallScore, ats_feedback: data?.score ?? null });
    } catch (e) {
      setAtsError(e instanceof Error ? e.message : 'Scan failed.');
      setAtsBusy(false);
    } finally {
      setAtsBusy(false);
    }
  }

  // Navigate back to the queue WITHOUT auto-scrolling to top. The queue's
  // scroll-restore hook reads sessionStorage and puts the worker back where
  // they left off. Without scroll:false, Next resets to the top (job #1).
  // We also include the job's client in the URL so the queue reopens on THAT
  // client, not the "All" aggregate (the queue reads ?client= on mount).
  function backToQueue() {
    const qs = profile ? `?client=${profile.id}` : '';
    router.push(`/worker/queue${qs}`, { scroll: false });
  }

  // Guard against malformed dates: a throw from toLocaleDateString on an
  // Invalid Date would crash the whole job detail page.
  function fmtLocalDate(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'tailor', label: 'Tailor Resume' },
    { key: 'question', label: 'Answer Question' },
    { key: 'submission', label: 'Submission Tracking' },
  ];

  return (
    <DashboardLayout user={user} nav={nav} active="/worker/queue">
      <div className="mb-4">
        <a
          href="/worker/queue"
          onClick={(e) => {
            e.preventDefault();
            backToQueue();
          }}
          className="text-sm text-navy-400 hover:text-navy-200"
        >
          ← Back to queue
        </a>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* LEFT: job details */}
        <div className="panel p-5 space-y-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <StatusBadge status={job.status} />
              <span className="text-xs text-navy-500 capitalize">{job.board}</span>
            </div>
            <h1 className="text-xl font-semibold text-navy-100">{job.title}</h1>
            <p className="text-sm text-navy-400">
              {job.company}
              {job.location ? ` · ${job.location}` : ''}
            </p>

            {/* ATS fitness scan — resume-vs-JD score + tips (client-facing value) */}
            <div className="mt-3 rounded-md border border-navy-700 bg-navy-800/60 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-navy-400">
                  ATS Fit
                </span>
                <button
                  onClick={runAtsScan}
                  disabled={atsBusy}
                  className="px-2.5 py-1 text-xs font-semibold rounded-md bg-brand-green/20 text-brand-green border border-brand-green/30 hover:bg-brand-green/30 disabled:opacity-50"
                >
                  {atsBusy ? 'Scanning…' : job.ats_score != null ? 'Re-scan' : 'Scan ATS'}
                </button>
              </div>

              {atsError && (
                <p className="mt-2 text-xs text-brand-red">{atsError}</p>
              )}

              {job.ats_score != null && (
                <div className="mt-2">
                  <div className="flex items-center gap-2">
                    <div
                      className={`text-2xl font-bold ${
                        job.ats_score >= 70
                          ? 'text-brand-green'
                          : job.ats_score >= 45
                            ? 'text-amber-400'
                            : 'text-brand-red'
                      }`}
                    >
                      {job.ats_score}
                      <span className="text-xs text-navy-500 font-normal">/100</span>
                    </div>
                    <div className="h-2 flex-1 rounded bg-navy-700 overflow-hidden">
                      <div
                        className="h-full rounded"
                        style={{
                          width: `${job.ats_score}%`,
                          background:
                            job.ats_score >= 70
                              ? 'var(--brand-green)'
                              : job.ats_score >= 45
                                ? 'var(--amber-400)'
                                : 'var(--brand-red)',
                        }}
                      />
                    </div>
                  </div>
                  {job.ats_feedback?.overallScore != null && (
                    <div className="mt-2 space-y-2">
                      {job.ats_feedback.booleanSearchResult && (
                        <div className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${
                          job.ats_feedback.booleanSearchResult === 'pass'
                            ? 'text-brand-green border-brand-green/40 bg-brand-green/10'
                            : job.ats_feedback.booleanSearchResult === 'borderline'
                              ? 'text-amber-400 border-amber-400/40 bg-amber-400/10'
                              : 'text-brand-red border-red-400/40 bg-red-400/10'
                        }`}>
                          Boolean search: {job.ats_feedback.booleanSearchResult.toUpperCase()}
                        </div>
                      )}
                      {job.ats_feedback.missingSkills && job.ats_feedback.missingSkills.length > 0 && (
                        <div>
                          <div className="text-[11px] font-semibold text-brand-red uppercase tracking-wide">Missing skills</div>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {job.ats_feedback.missingSkills.slice(0, 8).map((s, i) => (
                              <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 border border-red-400/30 text-brand-red">{s}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {job.ats_feedback.missingKeywords && job.ats_feedback.missingKeywords.length > 0 && (
                        <div>
                          <div className="text-[11px] font-semibold text-amber-400 uppercase tracking-wide">Missing keywords</div>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {job.ats_feedback.missingKeywords.slice(0, 8).map((k, i) => (
                              <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-amber-400/10 border border-amber-400/30 text-amber-400">{k}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {job.ats_feedback.matchingSkills && job.ats_feedback.matchingSkills.length > 0 && (
                        <div className="text-[11px] text-navy-400">
                          <span className="text-brand-green font-semibold">✓ {job.ats_feedback.matchingSkills.length}</span> skills matched
                        </div>
                      )}
                      {job.ats_feedback.yearsOfExperience != null && (
                        <div className="text-[11px] text-navy-400">
                          Experience: <span className="text-navy-100 font-semibold">{job.ats_feedback.yearsOfExperience}y</span> vs required{' '}
                          <span className="text-navy-100 font-semibold">{job.ats_feedback.yearsRequired ?? 'n/a'}y</span>
                        </div>
                      )}
                      {job.ats_feedback.keyRecommendations && job.ats_feedback.keyRecommendations.length > 0 && (
                        <div className="mt-1 border-t border-navy-700 pt-2">
                          {job.ats_feedback.keyRecommendations.slice(0, 3).map((r, i) => (
                            <p key={i} className="text-[11px] text-navy-300 leading-snug">• {r}</p>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <Detail label="Compensation">
              {job.compensation_min && job.compensation_max
                ? `$${(job.compensation_min / 1000).toFixed(0)}k–$${(job.compensation_max / 1000).toFixed(0)}`
                : '—'}
            </Detail>
            <Detail label="Currency">{job.compensation_currency || 'USD'}</Detail>
            <Detail label="Created">
              {fmtLocalDate(job.created_at)}
            </Detail>
            <Detail label="Submitted">
              {fmtLocalDate(job.submitted_at)}
            </Detail>
          </div>

          {job.url && (
            <a
              href={job.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-brand-blue hover:underline"
            >
              Open original posting <External size={13} />
            </a>
          )}

          <div>
            <h3 className="th-uppercase mb-2">Job Description</h3>
            <div className="text-sm text-navy-300 whitespace-pre-wrap max-h-[420px] overflow-y-auto pr-2">
              {job.description || 'No description available.'}
            </div>
          </div>

          {job.notes && (
            <div>
              <h3 className="th-uppercase mb-1">Notes</h3>
              <p className="text-sm text-navy-400 whitespace-pre-wrap">{job.notes}</p>
            </div>
          )}
        </div>

        {/* RIGHT: 3 tabs */}
        <div className="panel p-5">
          <div className="flex items-center gap-1 border-b border-navy-700 mb-4 -mt-1 overflow-x-auto -mx-1 px-1">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-3 py-2 text-sm border-b-2 -mb-px whitespace-nowrap transition-colors ${
                  tab === t.key
                    ? 'border-brand-green text-navy-100'
                    : 'border-transparent text-navy-400 hover:text-navy-200'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'tailor' && (
            <TailorPanel
              job={job}
              profile={profile}
              onSaved={(tailored) => updateJob({ tailored_resume: tailored })}
            />
          )}
          {tab === 'question' && <QuestionPanel profileId={profile.id} jobId={job.id} />}
          {tab === 'submission' && (
            <SubmissionPanel job={job} onUpdated={updateJob} />
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-navy-950 border border-navy-800 rounded-md p-2.5">
      <div className="th-uppercase mb-0.5">{label}</div>
      <div className="text-navy-200">{children}</div>
    </div>
  );
}

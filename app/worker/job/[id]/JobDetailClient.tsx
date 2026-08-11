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

  // Navigate back to the queue WITHOUT auto-scrolling to top. The queue's
  // scroll-restore hook reads sessionStorage and puts the worker back where
  // they left off. Without scroll:false, Next resets to the top (job #1).
  function backToQueue() {
    router.push('/worker/queue', { scroll: false });
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
            <TailorPanel job={job} profile={profile} onSaved={() => updateJob({ tailored_resume: 'saved' })} />
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

'use client';

import { useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import JobTable from '@/components/JobTable';
import Modal from '@/components/Modal';
import StatusBadge from '@/components/StatusBadge';
import { Download, External } from '@/components/Icon';
import type { Job, Profile, User } from '@/lib/types';

export default function ClientJobsClient({
  user,
  jobs,
  profiles,
}: {
  user: User;
  jobs: Job[];
  profiles: Profile[];
}) {
  const [selected, setSelected] = useState<Job | null>(null);

  const nav = [{ href: '/client/jobs', label: 'My Applications', badge: jobs.length }];

  // Proof of submission can be a stored image path (proof/<profileId>/x.png) —
  // render that as an image served via /api/files. Fall back to plain text for
  // any legacy text-only values.
  function isImagePath(v: string): boolean {
    return /^proof\//.test(v);
  }

  async function downloadPdf(job: Job) {
    if (!job.tailored_resume) return;
    const res = await fetch('/api/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: job.tailored_resume }),
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${job.company || 'resume'}-tailored.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <DashboardLayout user={user} nav={nav} active="/client/jobs">
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-navy-100">My Applications</h1>
        <p className="text-sm text-navy-400">
          Jobs we&apos;ve applied to on your behalf. Read-only.
        </p>
      </div>

      <div className="panel p-4 mb-4 flex items-center gap-4">
        <div className="text-4xl font-bold text-brand-green">{jobs.length}</div>
        <div>
          <div className="font-semibold text-navy-100">jobs applied for you</div>
          <div className="text-sm text-navy-400">Landed {jobs.length > 0 ? 'so far' : 'yet — we are working on it'}.</div>
        </div>
      </div>

      <JobTable
        jobs={jobs}
        profiles={profiles}
        mode="client"
        onQuickAction={() => {}}
        onRowClick={setSelected}
      />

      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.title ?? ''}
        subtitle={selected ? `${selected.company} · ${selected.location ?? ''}` : ''}
        wide
      >
        {selected && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <StatusBadge status={selected.status} />
              <span className="text-xs text-navy-500 capitalize">{selected.board}</span>
              <span className="text-xs text-navy-500">
                Applied {selected.submitted_at ? new Date(selected.submitted_at).toLocaleDateString() : '—'}
              </span>
              <a
                href={selected.url}
                target="_blank"
                rel="noreferrer"
                className="ml-auto inline-flex items-center gap-1 text-sm text-brand-blue hover:underline"
              >
                View posting <External size={13} />
              </a>
            </div>

            {selected.tailored_resume && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-navy-200">Tailored Resume</h3>
                  <button
                    onClick={() => downloadPdf(selected)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md bg-navy-800 text-navy-200 hover:bg-navy-750"
                  >
                    <Download size={13} /> PDF
                  </button>
                </div>
                <pre className="text-xs text-navy-300 whitespace-pre-wrap font-mono bg-navy-950 border border-navy-800 rounded-md p-3 max-h-72 overflow-y-auto">
                  {selected.tailored_resume}
                </pre>
              </div>
            )}

            <div>
              <h3 className="th-uppercase mb-1">Job Description</h3>
              <div className="text-sm text-navy-400 whitespace-pre-wrap max-h-60 overflow-y-auto">
                {selected.description || '—'}
              </div>
            </div>

            {selected.proof_of_submission && (
              <div>
                <h3 className="th-uppercase mb-1">Proof of Submission</h3>
                {isImagePath(selected.proof_of_submission) ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={`/api/files/${selected.proof_of_submission.split('/').filter(Boolean).join('/')}`}
                    alt="Proof of submission"
                    className="max-w-md rounded-md border border-navy-700"
                  />
                ) : (
                  <p className="text-sm text-navy-400 whitespace-pre-wrap">{selected.proof_of_submission}</p>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
    </DashboardLayout>
  );
}

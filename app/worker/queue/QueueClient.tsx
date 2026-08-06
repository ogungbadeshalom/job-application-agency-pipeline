'use client';

import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/DashboardLayout';
import JobTable from '@/components/JobTable';
import type { Job, Profile, User } from '@/lib/types';

export default function QueueClient({
  user,
  nav,
  jobs,
  profiles,
  quota,
  weeklyApplied,
  weeklySkipped,
}: {
  user: User;
  nav: { href: string; label: string; badge?: number }[];
  jobs: Job[];
  profiles: Profile[];
  quota: number;
  weeklyApplied: number;
  weeklySkipped: number;
}) {
  const router = useRouter();

  async function quickAction(job: Job, action: 'applied' | 'skipped') {
    await fetch(`/api/jobs/${job.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: action,
        ...(action === 'applied' ? { submitted_at: new Date().toISOString() } : {}),
      }),
    });
    router.refresh();
  }

  return (
    <DashboardLayout user={user} nav={nav} active="/worker/queue">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-navy-100">My Queue</h1>
          <p className="text-sm text-navy-400">
            {jobs.length} jobs for{' '}
            <span className="text-navy-200">{profiles.find((p) => p.assigned_worker_id === user.id)?.name}</span>
          </p>
        </div>
      </div>

      {/* Weekly quota banner */}
      <div className="panel p-4 mb-4 grid grid-cols-3 gap-4">
        <div>
          <div className="th-uppercase">Applied this week</div>
          <div className={`text-2xl font-semibold ${weeklyApplied >= quota ? 'text-brand-green' : 'text-navy-100'}`}>
            {weeklyApplied}
          </div>
        </div>
        <div>
          <div className="th-uppercase">Weekly quota</div>
          <div className="text-2xl font-semibold text-navy-100">{quota}</div>
        </div>
        <div>
          <div className="th-uppercase">Skipped this week</div>
          <div className="text-2xl font-semibold text-navy-300">{weeklySkipped}</div>
        </div>
        <div className="col-span-3">
          <div className="h-2 rounded-full bg-navy-800 overflow-hidden">
            <div
              className={`h-full transition-all ${
                weeklyApplied >= quota ? 'bg-brand-green' : 'bg-brand-blue'
              }`}
              style={{ width: `${Math.min(100, (weeklyApplied / Math.max(1, quota)) * 100)}%` }}
            />
          </div>
          <p className="text-xs text-navy-500 mt-1">
            {weeklyApplied} of {quota} this week (Mon–Sun)
          </p>
        </div>
      </div>

      <JobTable
        jobs={jobs}
        profiles={profiles}
        mode="worker"
        onQuickAction={quickAction}
      />
    </DashboardLayout>
  );
}

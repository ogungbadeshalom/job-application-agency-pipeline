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
}: {
  user: User;
  nav: { href: string; label: string; badge?: number }[];
  jobs: Job[];
  profiles: Profile[];
}) {
  const router = useRouter();

  async function quickAction(job: Job, action: 'applied' | 'withdrawn') {
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
      <JobTable
        jobs={jobs}
        profiles={profiles}
        mode="worker"
        onQuickAction={quickAction}
      />
    </DashboardLayout>
  );
}

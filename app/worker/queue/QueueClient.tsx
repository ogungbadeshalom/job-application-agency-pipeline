'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import DashboardLayout from '@/components/DashboardLayout';
import JobTable from '@/components/JobTable';
import type { Job, Profile, User } from '@/lib/types';

const SCROLL_KEY = 'jobbidder_queue_scroll';

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
  const pathname = usePathname();

  // When leaving the queue to open a job, save the current scroll offset so a
  // return-to-queue can restore it.
  const saveScroll = () => {
    try {
      sessionStorage.setItem(SCROLL_KEY, String(window.scrollY));
    } catch { /* storage may be unavailable */ }
  };
  useEffect(() => {
    // Fire on route change / tab-switch / navigation-away.
    window.addEventListener('pagehide', saveScroll);
    return () => {
      window.removeEventListener('pagehide', saveScroll);
      saveScroll();
    };
  }, []);

  // Preserve scroll position when the worker jumps to a job and comes back,
  // so they don't lose their place in a long queue.
  // When the path becomes the queue (e.g. returning from a job page), restore
  // the previously saved scroll offset once the table is painted.
  useEffect(() => {
    if (pathname === '/worker/queue') {
      const y = Number(sessionStorage.getItem(SCROLL_KEY) || 0);
      requestAnimationFrame(() => {
        // free up so the app doesn't keep re-saving a stale value
        sessionStorage.removeItem(SCROLL_KEY);
        window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior });
      });
    }
  }, [pathname]);

  async function quickAction(job: Job, action: 'applied' | 'skipped' | 'saved') {
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

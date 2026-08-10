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

  // ---- Scroll preservation across queue <-> job navigation ----
  // Next.js App Router resets scroll to top on navigation BEFORE the queue
  // unmounts, so capturing scroll in unmount/pagehide gets a stale 0. Instead
  // we continuously persist the queue's scroll offset as the user scrolls
  // (cheap), then restore it on (a) full loads, (b) popstate/Back, and (c)
  // pathname re-entry to /worker/queue.
  const saveScroll = () => {
    try { sessionStorage.setItem(SCROLL_KEY, String(window.scrollY || 0)); }
    catch { /* storage may be unavailable */ }
  };
  const restoreScroll = () => {
    // The queue table renders asynchronously (esp. through a slow tunnel), so a
    // one-shot scrollTo often fires before the page is tall enough and gets
    // clamped to the top. Retry until the target is actually reachable or the
    // page stabilizes. Cheap: a handful of rAF ticks over ~600ms max.
    const y = Number(sessionStorage.getItem(SCROLL_KEY) || 0);
    sessionStorage.removeItem(SCROLL_KEY);
    let attempt = 0;
    const maxTicks = 24; // ~2s of rAF frames
    const tick = () => {
      attempt += 1;
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      if (y > 0 && attempt < maxTicks && maxScroll < y) {
        // Page not tall enough yet (table still loading) -> retry next frame.
        requestAnimationFrame(tick);
        return;
      }
      try { window.scrollTo({ top: Math.min(y, maxScroll), left: 0, behavior: 'instant' as ScrollBehavior }); } catch { /* ignore */ }
    };
    requestAnimationFrame(tick);
  };

  useEffect(() => {
    // Persist live scroll ONLY while we're on the queue, so a stale value from
    // the job page (scroll 0) can't overwrite the saved offset. Capture is
    // throttled via requestAnimationFrame for cheapness. We deliberately do
    // NOT save on pagehide/unmount — the router resets scroll to 0 before
    // those fire, which would clobber the correct value we already persisted.
    let scheduled = false;
    const onScroll = () => {
      if (pathname !== '/worker/queue') return;
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        saveScroll();
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('popstate', restoreScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('popstate', restoreScroll);
    };
  }, [pathname]);

  // Restore on normal (non-back) re-entry too, e.g. landing on the queue.
  useEffect(() => {
    if (pathname === '/worker/queue') {
      restoreScroll();
    }
  }, [pathname]);

  async function quickAction(job: Job, action: 'applied' | 'skipped' | 'saved') {
    try {
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: action,
          ...(action === 'applied' ? { submitted_at: new Date().toISOString() } : {}),
        }),
      });
      if (!res.ok) {
        // Surface failures instead of silently refreshing into a stale list.
        const d = await res.json().catch(() => null);
        console.warn('Queue action failed', d?.error || res.status);
      }
    } catch (e) {
      console.warn('Queue action error', e);
    }
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
      <div className="panel p-4 mb-4 grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
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

      {/* Weekly completion history */}
      <WeeklyHistory jobs={jobs} />

      <JobTable
        jobs={jobs}
        profiles={profiles}
        mode="worker"
        onQuickAction={quickAction}
      />
    </DashboardLayout>
  );
}

// ---- Weekly completion history -------------------------------------------
// Groups the worker's APPLIED jobs by the week they were submitted and shows
// each week's accomplished count plus the job titles, newest week first.
function WeeklyHistory({ jobs }: { jobs: Job[] }) {
  const applied = jobs.filter((j) => j.status === 'applied' && j.submitted_at);
  if (applied.length === 0) {
    return (
      <div className="panel mb-4">
        <div className="p-4">
          <div className="th-uppercase mb-1">Weekly completion history</div>
          <p className="text-sm text-navy-400">No applications done yet this week — your accomplished jobs will appear here.</p>
        </div>
      </div>
    );
  }

  // Key each applied job by the Monday of its submission week.
  const byWeek = new Map<string, Job[]>();
  for (const j of applied) {
    const d = new Date(j.submitted_at!);
    const day = (d.getDay() + 6) % 7; // Mon=0
    const mon = new Date(d);
    mon.setDate(d.getDate() - day);
    mon.setHours(0, 0, 0, 0);
    const key = mon.toISOString().slice(0, 10);
    if (!byWeek.has(key)) byWeek.set(key, []);
    byWeek.get(key)!.push(j);
  }
  const weeks = Array.from(byWeek.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));

  return (
    <div className="panel mb-4">
      <div className="p-4 border-b border-navy-700">
        <div className="th-uppercase">Weekly completion history</div>
        <p className="text-xs text-navy-500 mt-0.5">Jobs marked Applied, grouped by the week they were completed.</p>
      </div>
      <div className="divide-y divide-navy-800">
        {weeks.map(([key, list]) => {
          const mon = new Date(key + 'T00:00:00');
          const wkStart = mon.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
          const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
          const wkEnd = sun.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
          const isCurrent = new Date().getTime() - mon.getTime() >= 0 && new Date().getTime() < sun.getTime() + 86400000;
          return (
            <div key={key} className="px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm flex items-center gap-2">
                  <span className="text-navy-200 font-medium">{wkStart}</span>
                  <span className="text-navy-500 text-xs">{wkStart} – {wkEnd}</span>
                  {isCurrent && <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand-green/20 text-brand-green">Current</span>}
                </div>
                <span className="text-sm font-semibold text-navy-100">{list.length} applied</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {list.map((j) => (
                  <span key={j.id} className="text-xs px-2 py-0.5 rounded bg-navy-800 text-navy-300 truncate max-w-[220px]">
                    {j.company ? `${j.company} · ` : ''}{j.title}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

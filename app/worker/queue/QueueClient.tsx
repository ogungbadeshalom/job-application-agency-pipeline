'use client';

import { useEffect, useState } from 'react';
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
  clientProfiles,
  quota,
  weeklyApplied,
  weeklySkipped,
  clientStats,
}: {
  user: User;
  nav: { href: string; label: string; badge?: number }[];
  jobs: Job[];
  profiles: Profile[];
  clientProfiles?: Profile[];
  quota: number;
  weeklyApplied: number;
  weeklySkipped: number;
  /** Per-client weekly stats (applied/skipped/quota) so the switcher can show
   *  the selected client's numbers. Optional for backward compat. */
  clientStats?: Record<string, { applied: number; skipped: number; quota: number }>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [clientId, setClientId] = useState('all');
  // Pagination-aware "Jump to my spot": {id, nonce} handed to JobTable, which
  // navigates to the job's page and scrolls to the row. A fresh nonce per click
  // ensures repeat clicks on the same job re-trigger the effect.
  const [pendingJump, setPendingJump] = useState<{ id: string; n: number } | null>(null);

  function requestJump(jobId: string) {
    setPendingJump({ id: jobId, n: Date.now() });
  }

  const filteredJobs = clientId === 'all'
    ? jobs
    : jobs.filter((j) => j.profile_id === clientId);

  // Weekly cards follow the switcher: 'all' shows the aggregate, a specific
  // client shows that client's own applied/skipped/quota for the week.
  const selected = clientStats?.[clientId];
  const cardQuota = selected ? selected.quota : quota;
  const cardApplied = selected ? selected.applied : weeklyApplied;
  const cardSkipped = selected ? selected.skipped : weeklySkipped;

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
    // Guard against a missing/corrupt stored value (NaN/negative) so scrollTo
    // is never called with an invalid target.
    const raw = sessionStorage.getItem(SCROLL_KEY) || '0';
    sessionStorage.removeItem(SCROLL_KEY);
    const parsed = Number(raw);
    const y = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    if (y <= 0) return;
    let attempt = 0;
    const maxTicks = 24; // ~2s of rAF frames
    const tick = () => {
      attempt += 1;
      const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      if (attempt < maxTicks && maxScroll < y) {
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
      <div className="mb-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-navy-100">My Queue</h1>
          {/* Client switcher — shown only when this worker handles >1 client */}
          {(clientProfiles ?? []).length > 1 && (
            <div className="flex items-center gap-1 rounded-md border border-navy-700 p-0.5">
              <button
                onClick={() => setClientId('all')}
                className={`px-2.5 py-1 text-xs font-medium rounded ${
                  clientId === 'all' ? 'bg-brand-green/15 text-brand-green' : 'text-navy-400 hover:text-navy-200'
                }`}
              >
                All
              </button>
              {(clientProfiles ?? []).map((cp) => (
                <button
                  key={cp.id}
                  onClick={() => setClientId(cp.id)}
                  className={`px-2.5 py-1 text-xs font-medium rounded ${
                    clientId === cp.id ? 'bg-brand-green/15 text-brand-green' : 'text-navy-400 hover:text-navy-200'
                  }`}
                >
                  {cp.name}
                </button>
              ))}
            </div>
          )}
          <p className="text-sm text-navy-400">
            {filteredJobs.length} jobs
            {clientId !== 'all' && (
              <span className="text-navy-300">
                {' '}for <span className="text-navy-200">{clientProfiles?.find((p) => p.id === clientId)?.name}</span>
              </span>
            )}
          </p>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-xs px-2 py-1 rounded-md bg-brand-green/15 text-brand-green">
            💡 Tip
          </span>
          <p className="text-sm text-navy-400">
            Switch between the <span className="text-navy-200 font-medium">Queue</span> and{' '}
            <span className="text-navy-200 font-medium">History</span> tabs in the top nav. Use{' '}
            <span className="text-navy-200">Queue</span> to apply to jobs, and{' '}
            <span className="text-navy-200">History</span> to see everything you have completed, grouped by week.
          </p>
        </div>
      </div>

      {/* Weekly quota banner — reflects the selected client (or all) */}
      <div className="panel p-4 mb-4 grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <div>
          <div className="th-uppercase">
            Applied this week
            {clientId !== 'all' && <span className="text-navy-500"> · {clientProfiles?.find((p) => p.id === clientId)?.name}</span>}
          </div>
          <div className={`text-2xl font-semibold ${cardApplied >= cardQuota ? 'text-brand-green' : 'text-navy-100'}`}>
            {cardApplied}
          </div>
        </div>
        <div>
          <div className="th-uppercase">Weekly quota</div>
          <div className="text-2xl font-semibold text-navy-100">{cardQuota}</div>
        </div>
        <div>
          <div className="th-uppercase">Skipped this week</div>
          <div className="text-2xl font-semibold text-navy-300">{cardSkipped}</div>
        </div>
        <div className="col-span-3">
          <div className="h-2 rounded-full bg-navy-800 overflow-hidden">
            <div
              className={`h-full transition-all ${
                cardApplied >= cardQuota ? 'bg-brand-green' : 'bg-brand-blue'
              }`}
              style={{ width: `${Math.min(100, (cardApplied / Math.max(1, cardQuota)) * 100)}%` }}
            />
          </div>
          <p className="text-xs text-navy-500 mt-1">
            {cardApplied} of {cardQuota} this week (Mon–Sun)
          </p>
        </div>
      </div>

      <ContinueBanner jobs={filteredJobs} onJump={requestJump} />

      <JobTable
        jobs={filteredJobs}
        profiles={profiles}
        mode="worker"
        onQuickAction={quickAction}
        gotoJobId={pendingJump?.id}
        gotoJobNonce={pendingJump?.n ?? 0}
      />
    </DashboardLayout>
  );
}

// ---- Continue where I left off -------------------------------------------
// The worker's most-recently-viewed (saved) job. A "Jump to my spot" button
// tells the parent + JobTable to scroll the queue to that row — JobTable owns
// the scroll because pagination may need to flip to the job's page first.
function ContinueBanner({ jobs, onJump }: { jobs: Job[]; onJump: (jobId: string) => void }) {
  const viewed = jobs
    .filter((j) => j.last_viewed_at && !['applied', 'skipped'].includes(j.status))
    .sort((a, b) => Date.parse(b.last_viewed_at!) - Date.parse(a.last_viewed_at!));
  const last = viewed[0];

  if (!last) return null;
  return (
    <div className="panel mb-4 p-3 flex flex-wrap items-center justify-between gap-2 border-brand-green/30">
      <div className="text-sm text-navy-200 flex items-center gap-2">
        <span className="text-brand-green">▶</span>
        <span>
          Continue where you left off:{' '}
          <span className="text-navy-100 font-medium">
            {last.title || 'Untitled'}{last.company ? ` — ${last.company}` : ''}
          </span>
        </span>
      </div>
      <button
        onClick={() => onJump(last.id)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-brand-green/20 text-brand-green hover:bg-brand-green/30"
      >
        Jump to my spot
      </button>
    </div>
  );
}

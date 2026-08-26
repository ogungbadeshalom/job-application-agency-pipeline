'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import DashboardLayout from '@/components/DashboardLayout';
import JobTable from '@/components/JobTable';
import type { Job, Profile, User } from '@/lib/types';

const SCROLL_KEY = 'jobbidder_queue_scroll';

// Boards available to the worker's self-serve refill. Only boards that reliably
// return STRICT remote jobs. LinkedIn excluded (its free/guest scrape has no
// remote/onsite signal and yields ~0 strict-remote). Others excluded: dead/banned.
const REFILL_BOARDS = [
  { site: 'greenhouse', label: 'Greenhouse' },
  { site: 'builtin', label: 'BuiltIn' },
  { site: 'jobicy', label: 'Jobicy' },
  { site: 'workingnomads', label: 'WorkingNomads' },
];

export default function QueueClient({
  user,
  nav,
  jobs,
  profiles,
  clientProfiles,
  initialClientId = 'all',
  quota,
  weeklyApplied,
  weeklySkipped,
  clientStats,
  weeklyEarnings,
  earningsByClient,
  clientRoles,
}: {
  user: User;
  nav: { href: string; label: string; badge?: number }[];
  jobs: Job[];
  profiles: Profile[];
  clientProfiles?: Profile[];
  /** Client to start on, from ?client= in the URL (validated server-side). Passed
   *  down so the switcher survives a refresh / browser back. */
  initialClientId?: string;
  quota: number;
  weeklyApplied: number;
  weeklySkipped: number;
  /** Per-client weekly stats (applied/skipped/quota) so the switcher can show
   *  the selected client's numbers. Optional for backward compat. */
  clientStats?: Record<string, { applied: number; skipped: number; quota: number }>;
  /** Aggregated weekly earnings pool across the worker's clients. */
  weeklyEarnings?: { earnedNaira: number; weeklyCapNaira: number; countThisWeek: number };
  /** Earnings per client (for the client switcher). */
  earningsByClient?: Record<string, { earnedNaira: number; weeklyCapNaira: number; countThisWeek: number }>;
  /** Role guide per assigned client (which roles the resume supports). */
  clientRoles?: Record<string, {
    headline: string;
    families: { id: string; label: string; exampleTitles: string[]; skipNote: string }[];
    exampleTitles: string[];
    skipNote: string;
  }>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [clientId, setClientId] = useState(initialClientId);
  const [actionError, setActionError] = useState<string | null>(null);
  // Worker self-refill state
  const [refillState, setRefillState] = useState<{
    preset: string; boards: string[]; busy: boolean; msg: string | null; error: string | null; done: boolean;
  }>({
    preset: '',
    boards: [],
    busy: false,
    msg: null,
    error: null,
    done: false,
  });
  // Local copy of the jobs list used for OPTIMISTIC quick-actions: flipping a
  // job's status re-renders instantly instead of waiting for a full
  // server round-trip + router.refresh(). Re-seed whenever the server sends a
  // fresh list (e.g. after a refresh reconciles weekly-stats on another action).
  const [jobsState, setJobsState] = useState<Job[]>(jobs);
  useEffect(() => {
    setJobsState(jobs);
  }, [jobs]);
  // On initial mount with a specific client, default the preset to its
  // "General" preset so the one-click broad refill is preselected.
  useEffect(() => {
    if (clientId === 'all' || !clientId) return;
    const profile = (clientProfiles ?? []).find((p) => p.id === clientId);
    const general = (profile?.presets ?? []).find((p: { name: string }) => p.name === 'General');
    if (general?.id) {
      setRefillState((s) => (s.preset ? s : { ...s, preset: general.id }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientProfiles, clientId]);
  // Pagination-aware "Jump to my spot": {id, nonce} handed to JobTable, which
  // navigates to the job's page and scrolls to the row. A fresh nonce per click
  // ensures repeat clicks on the same job re-trigger the effect.
  const [pendingJump, setPendingJump] = useState<{ id: string; n: number } | null>(null);

  const requestJump = useCallback((jobId: string) => {
    setPendingJump({ id: jobId, n: Date.now() });
  }, []);

  // Switch the active client AND mirror it into the URL (?client=<id>) so the
  // selection survives a refresh, browser back, or a later "Back to queue".
  function switchClient(id: string) {
    setClientId(id);
    // Auto-select the client's "General" preset by default so the one-click
    // broad refill is the immediate action (workers can still pick a specific
    // role-family preset from the dropdown).
    const profile = (clientProfiles ?? []).find((p) => p.id === id);
    const general = (profile?.presets ?? []).find((p: { name: string }) => p.name === 'General');
    setRefillState((s) => ({ ...s, preset: general?.id ?? '', error: null, msg: null, done: false }));
    const qs = id === 'all' ? '' : `?client=${id}`;
    router.replace(`/worker/queue${qs}`, { scroll: false });
  }

  const filteredJobs = clientId === 'all'
    ? jobsState
    : jobsState.filter((j) => j.profile_id === clientId);

  // Internal queue tabs: which subset of the client-filtered jobs show.
  const [queueTab, setQueueTab] = useState<'working' | 'applied' | 'skipped'>('working');
  // working = unworked (saved/tailored); applied = applied only; skipped = skipped only.
  const tabJobs =
    queueTab === 'applied'
      ? filteredJobs.filter((j) => j.status === 'applied')
      : queueTab === 'skipped'
        ? filteredJobs.filter((j) => j.status === 'skipped')
        : filteredJobs.filter((j) => j.status !== 'applied' && j.status !== 'skipped');

  // Role guide for the currently selected client. On the 'all' aggregate, show
  // the guide when the worker has exactly ONE client (defaults to 'all' but the
  // guide still makes sense); hide it only when mixing multiple clients.
  const activeRoleGuide =
    clientRoles == null
      ? undefined
      : clientId !== 'all'
        ? clientRoles[clientId]
        : (clientProfiles ?? []).length === 1
          ? clientRoles[clientProfiles![0].id]
          : undefined;

  // Weekly cards follow the switcher: 'all' shows the aggregate, a specific
  // client shows that client's own applied/skipped/quota for the week.
  const selected = clientStats?.[clientId];
  const cardQuota = selected ? selected.quota : quota;
  const cardApplied = selected ? selected.applied : weeklyApplied;
  const cardSkipped = selected ? selected.skipped : weeklySkipped;
  // Earnings pool for the selected client (or the aggregate). Only worker-safe
  // fields (naira + cap + count) ever reach the client. `clientId` is the
  // profile id; 'all' falls back to the aggregate.
  const selectedEarn = clientId !== 'all' && earningsByClient?.[clientId]
    ? earningsByClient[clientId]
    : weeklyEarnings;
  const cardEarnings = {
    earned: selectedEarn?.earnedNaira ?? 0,
    cap: selectedEarn?.weeklyCapNaira ?? 0,
    count: selectedEarn?.countThisWeek ?? 0,
    pct: selectedEarn && selectedEarn.weeklyCapNaira > 0
      ? Math.min(100, (selectedEarn.earnedNaira / selectedEarn.weeklyCapNaira) * 100)
      : 0,
    maxed: !!selectedEarn && selectedEarn.earnedNaira >= selectedEarn.weeklyCapNaira && selectedEarn.weeklyCapNaira > 0,
  };
  function naira(v: number): string {
    return `₦${Math.round(v).toLocaleString('en-US')}`;
  }

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

  const quickAction = useCallback(async (job: Job, action: 'applied' | 'skipped' | 'saved') => {
    setActionError(null);
    const prevStatus = job.status;
    const prevSubmitted = job.submitted_at;
    // Optimistic flip: repaint the row NOW so the UI feels instant, then do the
    // PATCH in the background. Revert + show the error if the server disagrees.
    setJobsState((prev) =>
      prev.map((j) =>
        j.id === job.id
          ? {
              ...j,
              status: action,
              submitted_at: action === 'applied' ? (j.submitted_at ?? new Date().toISOString()) : j.submitted_at,
            }
          : j
      )
    );
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
        // Revert the optimistic change and surface the real error.
        const d = await res.json().catch(() => null);
        console.warn('Queue action failed', d?.error || res.status);
        setJobsState((prev) =>
          prev.map((j) =>
            j.id === job.id
              ? { ...j, status: prevStatus, submitted_at: prevSubmitted }
              : j
          )
        );
        setActionError(d?.error || `Action failed (${res.status}) — please retry.`);
        return; // don't refresh on failure — the row was reverted
      }
    } catch (e) {
      console.warn('Queue action error', e);
      // Revert + surface the network error.
      setJobsState((prev) =>
        prev.map((j) => (j.id === job.id ? { ...j, status: prevStatus, submitted_at: prevSubmitted } : j))
      );
      setActionError('Action failed — network error. Please retry.');
      return;
    }
    // Success: reconcile in the background so the weekly-stat banner stays
    // accurate, without blocking the row's already-instant repaint.
    router.refresh();
  }, []);

  // Worker self-refill: POST /api/worker-refill with the selected client + preset.
  // For a single-client worker, the default 'all' view maps to that one client.
  // Rate-limited server-side (30 min).
  async function doRefill() {
    const refillProfileId =
      clientId !== 'all' && clientId
        ? clientId
        : (clientProfiles ?? []).length === 1
          ? clientProfiles![0].id
          : null;
    if (!refillProfileId) {
      setRefillState((s) => ({ ...s, error: 'Select a client first.', msg: null }));
      return;
    }
    setRefillState((s) => ({ ...s, busy: true, error: null, msg: null, done: false }));
    try {
      const res = await fetch('/api/worker-refill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
        profileId: refillProfileId,
        presetId: refillState.preset || undefined,
        sites: refillState.boards.length ? refillState.boards : undefined,
      }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRefillState((s) => ({ ...s, error: data?.error || `Refill failed (${res.status})`, busy: false, done: true }));
        return;
      }
      const added = data?.jobs_added ?? 0;
      setRefillState((s) => ({
        ...s,
        busy: false,
        msg: added > 0
          ? `✓ Added ${added} new job${added === 1 ? '' : 's'}${data?.deduped_by_company ? ' (kept 1 per company)' : ''}.`
          : 'No new jobs found this round — try a different board or preset.',
        error: null,
        done: true,
      }));
      router.refresh();
    } catch (e) {
      setRefillState((s) => ({ ...s, busy: false, error: 'Network error — please retry.', msg: null, done: true }));
    }
  }

  const selProfile = clientId !== 'all' ? clientProfiles?.find((p) => p.id === clientId) : undefined;
  const presets = ((selProfile?.presets ?? []) as { id: string; name: string }[]).slice().sort((a, b) => {
    // General first — it's the broad one-click refill most workers want; the
    // specific role-family presets come after for targeted refinement.
    const ga = a.name === 'General' ? 0 : 1;
    const gb = b.name === 'General' ? 0 : 1;
    return ga - gb;
  });

  return (
    <DashboardLayout user={user} nav={nav} active="/worker/queue">
      <div className="mb-4">
        {actionError && (
          <div className="mb-4 text-sm text-brand-red bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
            {actionError}
          </div>
        )}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-xl font-semibold text-pretty text-navy-100">My Queue</h1>
          {/* Client switcher — shown only when this worker handles >1 client */}
          {(clientProfiles ?? []).length > 1 && (
            <div className="flex flex-wrap items-center gap-1 rounded-md border border-navy-700 p-0.5 w-fit">
              <button
                onClick={() => switchClient('all')}
                className={`px-2.5 py-1 text-xs font-medium rounded ${
                  clientId === 'all' ? 'bg-brand-green/15 text-brand-green' : 'text-navy-400 hover:text-navy-200'
                }`}
              >
                All
              </button>
              {(clientProfiles ?? []).map((cp) => (
                <button
                  key={cp.id}
                  onClick={() => switchClient(cp.id)}
                  className={`px-2.5 py-1 text-xs font-medium rounded ${
                    clientId === cp.id ? 'bg-brand-green/15 text-brand-green' : 'text-navy-400 hover:text-navy-200'
                  }`}
                >
                  {cp.name}
                </button>
              ))}
            </div>
          )}
          {/* Worker self-refill — shown when a specific client is selected, or
              when the worker has exactly ONE client (defaults to 'all' but the
              refill is against that single client, so show it). */}
          {(clientId !== 'all' || (clientProfiles ?? []).length === 1) && (
            <div className="flex flex-col items-stretch sm:items-end gap-1.5 w-full sm:w-auto">
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-xs text-navy-500">Preset</label>
                <select
                  value={refillState.preset}
                  onChange={(e) => setRefillState((s) => ({ ...s, preset: e.target.value, error: null, msg: null }))}
                  className="rounded-md bg-navy-800 border border-navy-700 px-2 py-1.5 text-xs text-navy-100 flex-1 min-w-[120px]"
                >
                  <option value="">Default settings</option>
                  {presets.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <button
                  onClick={doRefill}
                  disabled={refillState.busy}
                  className="px-3 py-1.5 text-xs font-semibold rounded-md bg-brand-green/20 text-brand-green border border-brand-green/30 hover:bg-brand-green/30 disabled:opacity-50"
                >
                  {refillState.busy ? 'Refilling…' : 'Refill'}
                </button>
              </div>
              {/* Board selector: workers pick which boards to scrape. */}
              <div className="flex items-center gap-1 flex-wrap justify-end">
                <span className="text-[10px] uppercase text-navy-500 mr-1">Boards</span>
                {REFILL_BOARDS.map((b) => {
                  const on = refillState.boards.includes(b.site);
                  return (
                    <button
                      key={b.site}
                      type="button"
                      onClick={() =>
                        setRefillState((s) => ({
                          ...s,
                          boards: on ? s.boards.filter((x) => x !== b.site) : [...s.boards, b.site],
                        }))
                      }
                      className={`px-2 py-0.5 text-[10px] rounded-full border transition-colors ${
                        on
                          ? 'bg-brand-green/20 text-brand-green border-brand-green/40'
                          : 'bg-navy-800 text-navy-400 border-navy-700 hover:border-navy-600'
                      }`}
                    >
                      {b.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {/* Refill feedback: loading bar while busy, then success / 0-new / error */}
          {refillState.busy && (
            <div className="mt-2 w-full sm:w-72">
              <div className="flex items-center gap-2 text-xs text-navy-300">
                <span className="inline-block h-3 w-3 rounded-full border-2 border-brand-green/40 border-t-brand-green animate-spin" />
                Refilling… fetching jobs (can take 1–3 min)
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-navy-800 overflow-hidden">
                <div className="h-full bg-brand-green width-indeterminate" />
              </div>
            </div>
          )}
          {refillState.done && !refillState.busy && refillState.msg && !refillState.error && (
            <div className="mt-2 w-full sm:w-96 text-xs rounded-md border px-3 py-2 bg-brand-green/10 border-brand-green/30 text-brand-green">
              {refillState.msg}
            </div>
          )}
          {refillState.done && !refillState.busy && refillState.error && (
            <div className="mt-2 w-full sm:w-96 text-xs rounded-md border px-3 py-2 bg-red-500/10 border-red-500/30 text-brand-red">
              {refillState.error}
            </div>
          )}
          <p className="text-sm text-navy-400">
            {tabJobs.length} jobs
            {clientId !== 'all' && (
              <span className="text-navy-300">
                {' '}for <span className="text-navy-200">{clientProfiles?.find((p) => p.id === clientId)?.name}</span>
              </span>
            )}
          </p>
        </div>
        {/* Roles you can apply for — guides the worker so valid titles aren't skipped recklessly */}
        {activeRoleGuide && (
          <div className="mt-3 rounded-md border border-brand-green/30 bg-brand-green/5 px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-brand-green">
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span className="text-xs font-semibold uppercase tracking-wide">Roles you can apply for</span>
              {activeRoleGuide.headline && (
                <span className="ml-1 normal-case tracking-normal text-[11px] text-navy-300 font-normal">
                  — {activeRoleGuide.headline}
                </span>
              )}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {activeRoleGuide.families.map((f) => (
                <span key={f.id} className="rounded-full bg-brand-green/15 text-brand-green border border-brand-green/30 px-2 py-0.5 text-[11px] font-medium">
                  {f.label}
                </span>
              ))}
            </div>
            {activeRoleGuide.exampleTitles.length > 0 && (
              <p className="mt-1.5 text-[11px] text-navy-300">
                <span className="text-navy-200 font-medium">Example titles: </span>
                {activeRoleGuide.exampleTitles.join(' · ')}
              </p>
            )}
            {activeRoleGuide.skipNote && (
              <p className="mt-1 text-[11px] text-navy-400">
                <span className="text-navy-300 font-medium">Skip if: </span>
                {activeRoleGuide.skipNote}
              </p>
            )}
          </div>
        )}
        {/* Internal queue tabs: Working (excludes applied) vs Applied */}
        <div className="mt-2 flex items-center gap-1">
          {(
            [
              { id: 'working' as const, label: 'Working' },
              { id: 'applied' as const, label: 'Applied' },
              { id: 'skipped' as const, label: 'Skipped' },
            ]
          ).map((t) => {
            const count =
              t.id === 'applied'
                ? filteredJobs.filter((j) => j.status === 'applied').length
                : t.id === 'skipped'
                  ? filteredJobs.filter((j) => j.status === 'skipped').length
                  : filteredJobs.filter((j) => j.status !== 'applied' && j.status !== 'skipped').length;
            const active = queueTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setQueueTab(t.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  active
                    ? 'bg-brand-green/20 text-brand-green border border-brand-green/40'
                    : 'text-navy-400 border border-transparent hover:text-navy-200 hover:bg-navy-800/60'
                }`}
              >
                {t.label} <span className="opacity-70">({count})</span>
              </button>
            );
          })}
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

      {/* Earnings pool meter — worker's weekly naira, privacy-safe (no rate) */}
      <div className="panel p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="th-uppercase">Weekly earnings pool</span>
          <span className="text-xs text-navy-500">
            resets every Monday{cardEarnings.maxed ? ' · maxed' : ''}
          </span>
        </div>
        <div className="flex items-end gap-3">
          <div
            className={`text-3xl sm:text-4xl font-bold tabular-nums transition-colors ${
              cardEarnings.maxed ? 'text-brand-green' : 'text-brand-blue'
            }`}
          >
            {naira(cardEarnings.earned)}
          </div>
          <div className="text-sm text-navy-400 pb-1">
            of <span className="text-navy-200 font-medium">{naira(cardEarnings.cap)}</span> this week
          </div>
        </div>
        {/* Fill meter with animated gradient + milestone ticks */}
        <div className="relative h-4 rounded-full bg-navy-900 overflow-hidden mt-2">
          <div
            className="earns-fill h-full transition-all duration-700"
            style={{ width: `${cardEarnings.pct}%` }}
          />
        </div>
        <div className="flex justify-between text-[11px] text-navy-500 mt-1">
          <span>{naira(0)}</span>
          <span>{naira(cardEarnings.cap)}</span>
        </div>
        {cardEarnings.maxed && (
          <p className="text-xs text-brand-green mt-1">🎉 Week maxed — see you next Monday!</p>
        )}
      </div>

      <ContinueBanner jobs={tabJobs} onJump={requestJump} />

      <JobTable
        jobs={tabJobs}
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

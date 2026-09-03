import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { isUuid } from '@/lib/validate';
import { runJobSpy, dedupeAndMap, scrapeProgress, latestRunByWorker } from '@/lib/scrape';
import { filterJobsByResume } from '@/lib/aiJobMatch';
import type { Job, ProfilePreset, ScrapeResultJob } from '@/lib/types';

// Worker-initiated refill for their own queue, using a saved profile preset (or
// the profile's default scrape settings). Safety rails:
//  - worker only, and only for their OWN assigned profile
//  - always remote-only
//  - single-flight (only one refill scrape at a time across workers)
//  - capped result size
//  - 1 job per company enforced after insertion
const RESULTS_WANTED = 120;
// Pull a full week (168h) of postings so a refill exposes jobs that slipped
// past the dedupe window and isn't limited to the last 3 days only.
const HOURS_OLD = 168;
// Boards that actually produce US-remote jobs from this server. LinkedIn is
// EXCLUDED here: its free/guest scrape returns no remote/onsite signal (city
// locations only; descriptions blocked), so it yields ~0 strict-remote jobs and
// wastes a worker refill. Lever/Indeed/RemoteOK/Remotive also excluded (dead/banned).
// Expanded board set (was greenhouse/builtin/jobicy): adding ashby + workingnomads
// + dice + hiringcafe gives workers far more supply so a refill isn't deduped to
// a handful by the three-board default.
const DEFAULT_SITES = ['greenhouse', 'builtin', 'jobicy', 'ashby', 'workingnomads', 'dice'];
// Boards the worker may select. hiringcafe is heavy/headless (one launch per
// batch) but yields unique aggregation too, so it's available on explicit pick.
const AVAILABLE_BOARDS = ['greenhouse', 'builtin', 'jobicy', 'workingnomads', 'ashby', 'dice', 'hiringcafe'];

// Single-flight: only one worker-refill scrape may run at a time across workers,
// so two people sharing a profile (e.g. Erry) can't stack concurrent JobSpy
// subprocesses. Concurrent callers get a 409 until the current run finishes.
let refillInFlight = false;

async function acquireLock(): Promise<void> {
  if (refillInFlight) {
    throw new RefillBusyError('Another refill is already running — wait a moment and retry.');
  }
  refillInFlight = true;
}
class RefillBusyError extends Error {}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== 'worker') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const profileId = typeof body.profileId === 'string' ? body.profileId : '';
  const presetId = typeof body.presetId === 'string' ? body.presetId : '';
  // Optional: worker-selected boards. Must be non-empty and only known boards.
  const rawSites: unknown = body.sites;
  const requestedSites: string[] = Array.isArray(rawSites)
    ? rawSites.filter((s): s is string => typeof s === 'string').slice(0, 8)
    : [];
  const chosenSites = requestedSites.filter((s) => AVAILABLE_BOARDS.includes(s));

  if (!profileId || !isUuid(profileId)) {
    return NextResponse.json({ error: 'Select a profile.' }, { status: 400 });
  }

  // Ownership: only refill a profile assigned to this worker.
  const mine = await db.listProfilesByWorker(session.user.id);
  const profile = mine.find((p) => p.id === profileId);
  if (!profile) {
    return NextResponse.json({ error: 'Not your profile.' }, { status: 403 });
  }

  // Single-flight: reject if another refill is already scraping (avoids 2
    // workers stacking concurrent JobSpy subprocesses on a shared profile).
    // IMPORTANT: the lock must be released on EVERY path out of the handler
    // after this point — the `finally` below covers it, so do not `return`
    // between here and the end without letting control fall through to the
    // finally (early returns leak the lock forever and deadlock every worker
    // refill until the process restarts).
    try {
      await acquireLock();
    } catch (e) {
      if (e instanceof RefillBusyError) {
        return NextResponse.json({ error: e.message }, { status: 409 });
      }
      throw e;
    }

    // `refillInFlight` is released in the `finally` of this single try block no
    // matter which path (success, early return, DB error) runs. Previously the
    // release only lived on the inner second block, so a throw in preset
    // resolution or `createScrapeRun` (both BELOW the lock but OUTSIDE that
    // finally) permanently leaked the lock.
    try {
      // Resolve the preset (or fall back to the profile defaults).
      const presets: ProfilePreset[] = (profile.presets ?? []) as ProfilePreset[];
      const preset = presetId ? presets.find((p) => p.id === presetId) : undefined;
      const searchTerms = preset?.search_terms?.length ? preset.search_terms : profile.scrape_search_terms;
      // Broaden the search set so consecutive refills aren't re-running the
      // exact same queries (which just refind already-seen postings that the
      // URL dedupe then drops). Each base term is expanded into nearby
      // variants; the expanded list is the effective search space. This
      // materially widens supply at no extra cost (one JobSpy call per term).
      const EXPANSIONS: Record<string, string[]> = {
        'software engineer': ['software engineer', 'full stack engineer', 'fullstack', 'backend engineer', 'platform engineer', 'software developer'],
        'fullstack engineer': ['fullstack engineer', 'full stack engineer', 'software engineer', 'web developer', 'full stack developer'],
        'software engineer react': ['software engineer react', 'frontend engineer', 'react developer'],
        'backend engineer': ['backend engineer', 'back-end engineer', 'python backend', 'node.js developer'],
        'backend engineer node': ['backend engineer node', 'node.js developer', 'typescript developer'],
        'frontend engineer': ['frontend engineer', 'front-end engineer', 'react developer', 'typescript developer'],
        'ai engineer': ['ai engineer', 'ai ml engineer', 'machine learning engineer', 'llm engineer', 'ai platform engineer'],
        'ml engineer': ['ml engineer', 'machine learning engineer', 'mlops engineer', 'ai engineer'],
        'full stack engineer python': ['full stack engineer python', 'python developer', 'django developer'],
      };
      const expandedTerms = new Set<string>();
      // Deterministic rotation window: widen the dedupe-blind spot by running
      // variants; also cap total terms to keep each run bounded.
      for (const t of Array.from(new Set(searchTerms.filter(Boolean)))) {
        const variants = EXPANSIONS[(t || '').toLowerCase()] ?? [t];
        variants.forEach((v) => expandedTerms.add(v));
        // Always also keep the exact term so exact-match supply isn't lost.
        expandedTerms.add(t);
      }
      const termsForScrape = Array.from(expandedTerms).filter(Boolean).slice(0, 24);
      // Boards: worker-selected (if they picked any) > preset > profile default >
      // fallback board list. EVERY source is filtered through AVAILABLE_BOARDS so
      // dead/banned boards (lever/indeed/remotive/remoteok) can never be scraped.
      const chosen = (chosenSites.length
        ? chosenSites
        : preset?.sites?.length
          ? preset.sites
          : profile.scrape_sites?.length
            ? profile.scrape_sites
            : DEFAULT_SITES
      );
      const sites = chosen.filter((s) => AVAILABLE_BOARDS.includes(s));
      if (!sites.length) sites.push(...DEFAULT_SITES);
      const resultsWanted = Math.min(preset?.results_wanted || RESULTS_WANTED, 150);
      const location = preset?.location || 'Remote';
      const hoursOld = HOURS_OLD;

      if (!termsForScrape?.length) {
        return NextResponse.json({ error: 'This profile has no search terms configured yet.' }, { status: 400 });
      }

      const run = await db.createScrapeRun({
        triggered_by: session.user.id,
        profile_ids: [profileId],
        sites: sites || [],
        search_terms: termsForScrape,
        location,
        results_wanted: resultsWanted,
        hours_old: hoursOld,
        status: 'running',
        started_at: new Date().toISOString(),
      });

      try {
        const terms = Array.from(new Set(termsForScrape.filter(Boolean)));
        if (!terms.length) throw new Error('No search terms provided.');

        // Seed the live progress record so the UI can poll it the moment the
        // scrape starts. Written by onProgress as the subprocess streams steps.
        scrapeProgress[run.id] = {
          totalSteps: Math.max((sites || []).length * terms.length, 1),
          step: 0,
          current: 'Starting…',
          jobsFound: 0,
          done: false,
        };
        latestRunByWorker[session.user.id] = { runId: run.id, profileId };

        const allRaw: ScrapeResultJob[] = await runJobSpy(
          {
            sites: sites || [],
            search_terms: terms,
            location,
            results_wanted: resultsWanted,
            hours_old: hoursOld,
            is_remote: true, // worker refills are always remote-only
          },
          (p) => { scrapeProgress[run.id] = p; } // live overwrite as steps complete
        );

        // AI role-fit gate: only keep jobs that genuinely match the client's
        // resume (level + role family + skills), so off-target roles (Director/
        // PM/Sales/Compliance/adjacent) never enter the queue.
        let matched = allRaw;
        if (profile.base_resume_text) {
          matched = await filterJobsByResume(allRaw, profile.base_resume_text);
        }

        const fresh = await dedupeAndMap(matched, profileId, run.id);
        let added = 0;
        if (fresh.length) {
          // Bound a single refill so an expanded multi-term scrape can't flood
          // the queue past what the worker can realistically process in a
          // session. 30/day keeps volume useful without overwhelming the queue
          // (the old 3-board/3-day default rarely even reached ~20).
          const cap = 30;
          const batch = fresh.slice(0, cap);
          await db.createJobs(batch as Job[]);
          added = batch.length;
        }

        // Enforce 1 job per company in this profile's queue.
        const deduped = await db.dedupeQueueByCompany(profileId);

        await db.updateScrapeRun(run.id, {
          status: 'completed',
          jobs_found: allRaw.length,
          jobs_added: added,
          completed_at: new Date().toISOString(),
        });

        // Mark progress done so the poller shows completion, then let it expire.
        delete scrapeProgress[run.id];

        return NextResponse.json({
          scrape_run_id: run.id,
          jobs_found: allRaw.length,
          jobs_added: added,
          deduped_by_company: deduped,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        delete scrapeProgress[run.id];
        await db.updateScrapeRun(run.id, {
          status: 'failed',
          error_message: msg,
          completed_at: new Date().toISOString(),
        });
        return NextResponse.json({ error: msg }, { status: 500 });
      }
    } finally {
      // Always release the single-flight lock so the next refill can proceed,
      // even if the run failed before the scrape_run row was created.
      refillInFlight = false;
      if (session?.user?.id) delete latestRunByWorker[session.user.id];
    }
  }
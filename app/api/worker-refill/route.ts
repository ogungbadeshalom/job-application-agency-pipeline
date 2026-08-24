import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { isUuid } from '@/lib/validate';
import { runJobSpy, dedupeAndMap } from '@/lib/scrape';
import type { Job, ProfilePreset, ScrapeResultJob } from '@/lib/types';

// Worker-initiated refill for their own queue, using a saved profile preset (or
// the profile's default scrape settings). Safety rails:
//  - worker only, and only for their OWN assigned profile
//  - always remote-only
//  - single-flight (only one refill scrape at a time across workers)
//  - capped result size
//  - 1 job per company enforced after insertion
const RESULTS_WANTED = 80;
// Boards that actually produce US-remote jobs from this server. LinkedIn is
// EXCLUDED here: its free/guest scrape returns no remote/onsite signal (city
// locations only; descriptions blocked), so it yields ~0 strict-remote jobs and
// wastes a worker refill. Lever/Indeed/RemoteOK/Remotive also excluded (dead/banned).
const DEFAULT_SITES = ['greenhouse', 'builtin', 'jobicy'];
const AVAILABLE_BOARDS = ['greenhouse', 'builtin', 'jobicy', 'workingnomads'];

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
      const hoursOld = 72;

      if (!searchTerms?.length) {
        return NextResponse.json({ error: 'This profile has no search terms configured yet.' }, { status: 400 });
      }

      const run = await db.createScrapeRun({
        triggered_by: session.user.id,
        profile_ids: [profileId],
        sites: sites || [],
        search_terms: searchTerms,
        location,
        results_wanted: resultsWanted,
        hours_old: hoursOld,
        status: 'running',
        started_at: new Date().toISOString(),
      });

      try {
        const terms = Array.from(new Set(searchTerms.filter(Boolean)));
        if (!terms.length) throw new Error('No search terms provided.');

        const allRaw: ScrapeResultJob[] = await runJobSpy({
          sites: sites || [],
          search_terms: terms,
          location,
          results_wanted: resultsWanted,
          hours_old: hoursOld,
          is_remote: true, // worker refills are always remote-only
        });

        const fresh = await dedupeAndMap(allRaw, profileId, run.id);
        let added = 0;
        if (fresh.length) {
          await db.createJobs(fresh as Job[]);
          added = fresh.length;
        }

        // Enforce 1 job per company in this profile's queue.
        const deduped = await db.dedupeQueueByCompany(profileId);

        await db.updateScrapeRun(run.id, {
          status: 'completed',
          jobs_found: allRaw.length,
          jobs_added: added,
          completed_at: new Date().toISOString(),
        });

        return NextResponse.json({
          scrape_run_id: run.id,
          jobs_found: allRaw.length,
          jobs_added: added,
          deduped_by_company: deduped,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
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
    }
  }
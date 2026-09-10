// Admin-toggled nightly AUTO-REFILL for all workers.
//
// This module owns:
//   1. The SHARED in-memory run status (`autoRefillStatus`) that both the
//      admin dashboard and (critically) the WORKER queue read in real time to
//      show "auto-refill in progress" and disable the worker's manual Refill
//      button — so a worker can't stack a manual refill on top of the nightly
//      one (which would double-scrape and double-dedupe = the "mishap").
//   2. `runAutoRefill()`: loops every worker-assigned profile and scrapes
//      remote-only jobs into each queue, mirroring the exact same pipeline the
//      worker-refill route uses (runJobSpy + role-fit + dedupe + insert + 1-per-
//      company) so behavior is identical job-for-job.
//
// Concurrency note: JS is single-threaded, so the module-level
// `autoRefillStatus.active` flag is a real single-flight lock within one process.
// The status object is deliberately module-scoped (shared across all requests)
// so the status API + worker disable read the SAME state.
import { db } from '@/lib/db';
import { runJobSpy, dedupeAndMap } from '@/lib/scrape';
import { filterJobsByResume } from '@/lib/aiJobMatch';
import type { Job, ScrapeResultJob } from '@/lib/types';

export interface AutoRefillStatus {
  active: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  // overall progress across profiles
  totalProfiles: number;
  doneProfiles: number;
  totalJobsAdded: number;
  // current profile
  currentName: string | null;
  currentProfile: string | null;
  currentStep: string;
  currentJobsFound: number;
  perProfile: Record<
    string,
    { name: string; jobsAdded: number; jobsFound: number; error?: string }
  >;
  message: string;
  trigger: 'cron' | 'manual';
  error?: string;
}

export const autoRefillStatus: AutoRefillStatus = {
  active: false,
  startedAt: null,
  finishedAt: null,
  totalProfiles: 0,
  doneProfiles: 0,
  totalJobsAdded: 0,
  currentName: null,
  currentProfile: null,
  currentStep: 'Idle',
  currentJobsFound: 0,
  perProfile: {},
  message: 'Idle',
  trigger: 'cron',
};

export function isAutoRefillActive(): boolean {
  return autoRefillStatus.active;
}

// The worker-refill route + a "manual run now" both call this guard so a manual
// worker refill (or an admin "run now") is refused while the nightly scan runs.
export function assertNotBusy(): void {
  if (autoRefillStatus.active) {
    const err = new Error('Auto-refill is currently in progress — wait a moment and retry.');
    (err as Error & { status?: number }).status = 409;
    throw err;
  }
}

const DEFAULT_SITES = ['greenhouse', 'builtin', 'jobicy', 'ashby', 'workingnomads', 'dice'];
const RESULTS_WANTED = 120;
const HOURS_OLD = 168;

async function scrapeOneProfile(profileId: string, name: string, per: AutoRefillStatus['perProfile'][string]) {
  autoRefillStatus.currentProfile = profileId;
  autoRefillStatus.currentName = name;
  autoRefillStatus.currentStep = `Scraping ${name}…`;
  autoRefillStatus.currentJobsFound = 0;
  autoRefillStatus.message = `Auto-refilling ${name}…`;

  const profile = await db.getProfile(profileId);
  if (!profile) {
    per.error = 'profile missing';
    return;
  }

  const terms = profile.scrape_search_terms?.length ? profile.scrape_search_terms : ['software engineer'];
  const sites = profile.scrape_sites?.length
    ? profile.scrape_sites.filter((s) => ['greenhouse', 'builtin', 'jobicy', 'ashby', 'workingnomads', 'dice', 'hiringcafe'].includes(s))
    : DEFAULT_SITES;

  const raw: ScrapeResultJob[] = await runJobSpy({
    sites: sites?.length ? sites : DEFAULT_SITES,
    search_terms: terms.slice(0, 12),
    location: profile.scrape_location || 'Remote',
    results_wanted: Math.min(profile.scrape_results_wanted || RESULTS_WANTED, 150),
    hours_old: profile.scrape_hours_old || HOURS_OLD,
    is_remote: true, // worker refills are always remote-only
    remove_easy_apply: true,
  });
  per.jobsFound = raw.length;
  autoRefillStatus.currentJobsFound = raw.length;

  let matched: ScrapeResultJob[] = raw;
  if (profile.base_resume_text) {
    matched = await filterJobsByResume(raw, profile.base_resume_text);
  }

  const run = await db.createScrapeRun({
    triggered_by: null, // system / nightly
    profile_ids: [profileId],
    sites: sites || [],
    search_terms: terms.slice(0, 12),
    location: profile.scrape_location || 'Remote',
    results_wanted: Math.min(profile.scrape_results_wanted || RESULTS_WANTED, 150),
    hours_old: HOURS_OLD,
    status: 'running',
    started_at: new Date().toISOString(),
  });

  const { fresh, skippedDuplicates } = await dedupeAndMap(matched, profileId, run.id);
  let added = 0;
  if (fresh.length) {
    const batch = fresh.slice(0, 30);
    await db.createJobs(batch as Job[]);
    added = batch.length;
  }
  await db.dedupeQueueByCompany(profileId);

  await db.updateScrapeRun(run.id, {
    status: 'completed',
    jobs_found: raw.length,
    jobs_added: added,
    completed_at: new Date().toISOString(),
  });

  per.jobsAdded = added;
  autoRefillStatus.totalJobsAdded += added;
}

export async function runAutoRefill(opts: { trigger: 'cron' | 'manual' } = { trigger: 'cron' }): Promise<{
  ok: boolean;
  profiles: number;
  jobsAdded: number;
  message: string;
  error?: string;
}> {
  if (autoRefillStatus.active) {
    return { ok: false, profiles: 0, jobsAdded: 0, message: 'Auto-refill already in progress.' };
  }

  const profiles = await db.listProfiles();
  const errored: string[] = [];

  // Reset to a fresh state.
  autoRefillStatus.active = true;
  autoRefillStatus.startedAt = new Date().toISOString();
  autoRefillStatus.finishedAt = null;
  autoRefillStatus.totalProfiles = profiles.length;
  autoRefillStatus.doneProfiles = 0;
  autoRefillStatus.totalJobsAdded = 0;
  autoRefillStatus.currentName = null;
  autoRefillStatus.currentProfile = null;
  autoRefillStatus.currentStep = 'Starting…';
  autoRefillStatus.currentJobsFound = 0;
  autoRefillStatus.perProfile = {};
  autoRefillStatus.message = 'Starting auto-refill…';
  autoRefillStatus.trigger = opts.trigger;
  autoRefillStatus.error = undefined;

  if (!profiles.length) {
    autoRefillStatus.message = 'No client profiles found.';
    autoRefillStatus.active = false;
    autoRefillStatus.finishedAt = new Date().toISOString();
    return { ok: true, profiles: 0, jobsAdded: 0, message: 'No client profiles found.' };
  }

  for (const p of profiles) {
    const slug = p.id;
    autoRefillStatus.perProfile[slug] = { name: p.name, jobsAdded: 0, jobsFound: 0 };
    try {
      await scrapeOneProfile(slug, p.name, autoRefillStatus.perProfile[slug]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errored.push(`${p.name}: ${msg}`);
      if (autoRefillStatus.perProfile[slug]) autoRefillStatus.perProfile[slug].error = msg;
    }
    autoRefillStatus.doneProfiles += 1;
    autoRefillStatus.currentStep = `Finished ${p.name}`;
  }

  autoRefillStatus.active = false;
  autoRefillStatus.finishedAt = new Date().toISOString();
  autoRefillStatus.currentStep = 'Idle';
  autoRefillStatus.message = errored.length
    ? `Auto-refill done — added ${autoRefillStatus.totalJobsAdded} jobs (${errored.length} profile error${errored.length === 1 ? '' : 's'}).`
    : `Auto-refill done — added ${autoRefillStatus.totalJobsAdded} jobs across ${profiles.length} profiles.`;
  if (errored.length) autoRefillStatus.error = errored.join('; ');

  return {
    ok: errored.length ? false : true,
    profiles: profiles.length,
    jobsAdded: autoRefillStatus.totalJobsAdded,
    message: autoRefillStatus.message,
    error: errored.length ? autoRefillStatus.error : undefined,
  };
}
// Scheduled Job-River refill for ONE profile (Kevin Thai by default).
// Runs the $0 river (freehire + jobseek) through Pitchr's own gates:
//   allowed_roles -> resume fit -> URL dedupe -> insert as 'saved' -> auto-tailor.
// Light and fast (no heavy JobSpy board subprocess), so it can run on a cron
// every few hours to keep the queue topped up. Idempotent for safety (set
// RIVER_ONCE=0 to loop, or let the OS cron schedule it).
import { db } from '../lib/db';
import { riverJobs } from '../lib/jobRiver';
import { dedupeAndMap } from '../lib/scrape';
import { filterByAllowedRoles, filterJobsByResume } from '../lib/aiJobMatch';
import type { Job } from '../lib/types';

const PROFILE_ID = process.env.RIVER_PROFILE_ID || '22f82386-0b76-40b8-9dc6-d674f9843d10';
const PER_TERM = Number(process.env.RIVER_PER_TERM || '25');
const MAX_TOTAL = Number(process.env.RIVER_MAX || '60');
const INSERT_CAP = Number(process.env.RIVER_INSERT_CAP || '20');
const INTERVAL_S = Number(process.env.RIVER_INTERVAL || '0'); // 0 = run once

async function pass(): Promise<{ found: number; gated: number; added: number; tailored: number }> {
  const profile = await db.getProfile(PROFILE_ID);
  if (!profile) throw new Error('Profile not found: ' + PROFILE_ID);

  const terms = (profile.scrape_search_terms as string[])?.length
    ? (profile.scrape_search_terms as string[])
    : ['data engineer'];

  const river = await riverJobs(terms, { perTermLimit: PER_TERM, maxTotal: MAX_TOTAL });
  let matched = river;
  if (profile.allowed_roles?.length) matched = filterByAllowedRoles(matched, profile.allowed_roles);
  if (profile.base_resume_text) matched = await filterJobsByResume(matched, profile.base_resume_text);

  const run = await db.createScrapeRun({
    triggered_by: null,
    profile_ids: [PROFILE_ID],
    sites: ['freehire', 'jobseek'],
    search_terms: Array.from(new Set(terms)).slice(0, 12),
    location: profile.scrape_location || 'Remote',
    results_wanted: matched.length,
    hours_old: 168,
    status: 'running',
    started_at: new Date().toISOString(),
  });

  let added = 0;
  try {
    const { fresh } = await dedupeAndMap(matched, PROFILE_ID, run.id);
    added = fresh.length;
    if (fresh.length) {
      await db.createJobs(fresh.slice(0, INSERT_CAP) as Job[]);
      added = fresh.slice(0, INSERT_CAP).length;
    }
  } catch (e) {
    console.error('[river-refill] insert failed:', e instanceof Error ? e.message : e);
  }

  let tailored = 0;
  try {
    tailored = await db.autoTailorSavedJobs([PROFILE_ID]);
  } catch (e) {
    console.warn('[river-refill] autoTailor skipped:', e instanceof Error ? e.message : e);
  }

  await db.updateScrapeRun(run.id, {
    status: 'completed',
    jobs_found: matched.length,
    jobs_added: added,
    completed_at: new Date().toISOString(),
  });

  const msg = `[river-refill] found=${river.length} gated=${matched.length} added=${added} tailored=${tailored}`;
  console.log(msg);
  return { found: river.length, gated: matched.length, added, tailored };
}

async function main() {
  if (INTERVAL_S <= 0) {
    await pass();
    process.exit(0);
  }
  // optional daemon loop
  for (;;) {
    const t = new Date().toISOString();
    try {
      await pass();
    } catch (e) {
      console.error(`[${t}] pass failed:`, e instanceof Error ? e.message : e);
    }
    await new Promise((r) => setTimeout(r, INTERVAL_S * 1000));
  }
}

main().catch((e) => {
  console.error('fatal:', e instanceof Error ? e.message : e);
  process.exit(1);
});
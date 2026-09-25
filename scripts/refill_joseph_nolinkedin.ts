/* Non-LinkedIn, remote-only refill for Joseph brimel (Erry's client).
 * Uses the production runJobSpy + dedupeAndMap + createJobs chain. No LinkedIn.
 * Joseph = software/AI engineer (his configured scrape_search_terms).
 */
import { db } from '../db/repo';
import { runJobSpy, dedupeAndMap } from '../lib/scrape';
import { filterJobsByResume } from '../lib/aiJobMatch';

const PROFILE_ID = 'a67e1f18-1b01-4370-8f79-ed1a3be6cc19'; // joseph brimel (Erry's, has resume)

const TERMS = [
  'software engineer', 'AI engineer', 'ML engineer', 'backend engineer',
  'fullstack engineer', 'full stack engineer', 'LLM engineer', 'platform engineer',
  'machine learning engineer', 'python developer', 'Node.js developer',
  'frontend engineer', 'DevOps engineer', 'Site Reliability Engineer',
];
const SITES = [
  'greenhouse', 'builtin', 'jobicy', 'remoteok', 'weworkremotely',
  'workingnomads', 'ashby', 'dice', 'smart_recruiters',
]; // NO linkedin, NO lever (dead), NO hiringcafe (linkless)
const LOCATION = 'Remote';
const HOURS_OLD = 168;
const RESULTS_WANTED = 100;

async function main() {
  console.log(`[REFILL] Non-LinkedIn remote-only for joseph brimel (${PROFILE_ID})`);
  console.log(`  sites=${SITES.length} | terms=${TERMS.length} | location=Remote | hours=${HOURS_OLD}\n`);

  const raw = await runJobSpy({
    sites: SITES,
    search_terms: TERMS,
    location: LOCATION,
    results_wanted: RESULTS_WANTED,
    hours_old: HOURS_OLD,
    is_remote: true,
    remove_easy_apply: true,
  }).catch((e) => { console.error('scrape failed:', e); process.exit(1); });
  console.log(`stage 1 (scrape): ${raw.length} raw\n`);

  const { query } = await import('../db/pool');
  const perf = await query<{ base_resume_text: string | null }>(
    'select base_resume_text from profiles where id = $1', [PROFILE_ID]
  );
  const resumeText = perf.rows[0]?.base_resume_text ?? null;

  let fit: typeof raw = raw;
  if (resumeText && resumeText.trim().length > 0) {
    fit = await filterJobsByResume(raw, resumeText);
    console.log(`stage 2 (role-fit): ${fit.length} pass\n`);
  }

  const runRow = await query<{ id: string }>(
    `insert into scrape_runs (triggered_by, profile_ids, sites, search_terms,
       location, results_wanted, hours_old, status, jobs_found, jobs_added,
       error_message, started_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     returning id`,
    [null, [PROFILE_ID], SITES, TERMS, LOCATION, RESULTS_WANTED, HOURS_OLD,
     'running', raw.length, 0, null, new Date().toISOString()]
  );
  const scrapeRunId = runRow.rows[0].id;

  const { fresh } = await dedupeAndMap(fit, PROFILE_ID, scrapeRunId);
  console.log(`stage 3 (dedupe): ${fresh.length} new\n`);

  let added = 0;
  if (fresh.length > 0) {
    const created = await db.createJobs(fresh as any);
    added = created.length;
    console.log(`inserted ${added} jobs for joseph.`);
  } else {
    console.log('No fresh jobs (all duplicates).');
  }

  await query(
    `update scrape_runs set status=$1, jobs_found=$2, jobs_added=$3, completed_at=$4 where id=$5`,
    ['completed', raw.length, added, new Date().toISOString(), scrapeRunId]
  );
  console.log(`\nDONE. raw=${raw.length} | fit=${fit.length} | added=${added}`);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
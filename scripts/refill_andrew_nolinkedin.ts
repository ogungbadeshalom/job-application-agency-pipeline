/* Standalone refill for Andrew's profile — NON-LINKEDIN remote-only.
 * Mirrors refill_andrew.ts but drops the 'linkedin' board entirely (Shalom:
 * no LinkedIn jobs). Uses JobSpy's own remote filter (is_remote=true) across
 * trusted remote-signal boards: greenhouse, builtin, jobicy, workingnomads.
 * After insert, run scripts/verify_non_linkedin.ts (APPLY=1) to set
 * verified_remote on the fresh rows.
 *
 * Usage: npx tsx scripts/refill_andrew_nolinkedin.ts
 */
import { db } from '../db/repo';
import { runJobSpy, dedupeAndMap } from '../lib/scrape';
import { filterJobsByResume } from '../lib/aiJobMatch';

const PROFILE_ID = '022137cc-3978-4b4a-9e0a-54f3235f08d9'; // Andrew (data engineer)
// Remote-signal boards only — NO linkedin (Shalom's instruction).
const SITES = ['greenhouse', 'builtin', 'jobicy', 'workingnomads'];
const TERMS = [
  'data engineer',
  'senior data engineer',
  'data pipeline engineer',
  'analytics engineer',
  'data warehouse engineer',
  'ETL developer',
  'data platform engineer',
  'data architect',
  'big data engineer',
];
const LOCATION = 'Remote';
const HOURS_OLD = 168;
const RESULTS_WANTED = 60;

async function main() {
  console.log(`Non-LinkedIn remote refill for Andrew (${PROFILE_ID})`);
  console.log(`  sites=${SITES.join(',')}`);
  console.log(`  terms=${TERMS.length} | location=${LOCATION} | hours_old=${HOURS_OLD} | wanted/term=${RESULTS_WANTED}`);

  const raw = await runJobSpy({
    sites: SITES,
    search_terms: TERMS,
    location: LOCATION,
    results_wanted: RESULTS_WANTED,
    hours_old: HOURS_OLD,
    is_remote: true,
    remove_easy_apply: true,
  }).catch((e) => {
    console.error('scrape failed:', e);
    process.exit(1);
  });
  console.log(`\nraw jobs scraped: ${raw.length}`);

  const { query } = await import('../db/pool');
  const perf = await query<{ base_resume_text: string | null }>(
    'select base_resume_text from profiles where id = $1',
    [PROFILE_ID]
  );
  const resumeText = perf.rows[0]?.base_resume_text ?? null;

  let pool = raw;
  if (resumeText && resumeText.trim().length > 0) {
    pool = await filterJobsByResume(raw, resumeText);
    console.log(`after resume role-fit gate: ${pool.length}`);
  } else {
    console.log('no base resume on file — skipping role-fit gate');
  }

  const runRow = await query<{ id: string }>(
    `insert into scrape_runs
      (triggered_by, profile_ids, sites, search_terms, location,
       results_wanted, hours_old, status, jobs_found, jobs_added,
       error_message, started_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     returning id`,
    [
      null, [PROFILE_ID], SITES, TERMS, LOCATION, RESULTS_WANTED, HOURS_OLD,
      'running', raw.length, 0, null, new Date().toISOString(),
    ]
  );
  const scrapeRunId = runRow.rows[0].id;

  const { fresh } = await dedupeAndMap(pool, PROFILE_ID, scrapeRunId);
  console.log(`new (non-duplicate) jobs: ${fresh.length}`);

  let added = 0;
  if (fresh.length > 0) {
    const created = await db.createJobs(fresh as any);
    added = created.length;
    console.log(`inserted ${added} jobs for Andrew.`);
  } else {
    console.log('No fresh jobs to insert (all were duplicates).');
  }

  await query(
    `update scrape_runs set status=$1, jobs_found=$2, jobs_added=$3, completed_at=$4 where id=$5`,
    ['completed', raw.length, added, new Date().toISOString(), scrapeRunId]
  );
  console.log(`\nDONE. raw=${raw.length} | after-fit=${pool.length} | added=${added}`);
  console.log(`scrape_run_id=${scrapeRunId}`);
  console.log(`Next: APPLY=1 npx tsx scripts/verify_non_linkedin.ts  (sets verified_remote on these rows)`);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
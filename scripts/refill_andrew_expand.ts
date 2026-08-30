/* Expanded refill for Andrew (data engineer) — taps the boards the standard
 * refill_andrew.ts did NOT cover, so we pull genuinely fresh supply past the
 * saturated greenhouse/builtin/jobicy/workingnomads/linkedin set. Reuses the
 * exact production pipeline (runJobSpy + filterJobsByResume + dedupeAndMap +
 * db.createJobs) so behavior matches /api/scrape.
 *
 *   npx tsx scripts/refill_andrew_expand.ts
 */
import { db } from '../db/repo';
import { runJobSpy, dedupeAndMap } from '../lib/scrape';
import { filterJobsByResume } from '../lib/aiJobMatch';

const PROFILE_ID = '022137cc-3978-4b4a-9e0a-54f3235f08d9'; // Andrew Pendergrass
// Boards with fresh supply for "data engineer" not exhausted by prior runs.
// (Mubeng proxy is down on :8899, so we skip indeed/linkedin/glassdoor which
// need it — the ATS + custom boards below run direct.)
const SITES = ['dice', 'ashby', 'lever', 'hiringcafe', 'remoteok'];
const TERMS = [
  'data engineer',
  'senior data engineer',
  'data pipeline engineer',
  'analytics engineer',
  'data warehouse engineer',
  'data platform engineer',
];
const LOCATION = 'Remote';
const HOURS_OLD = 168; // last week
const RESULTS_WANTED = 60;

async function main() {
  console.log(`Expanded refill for Andrew (${PROFILE_ID})`);
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
      null,
      [PROFILE_ID],
      SITES,
      TERMS,
      LOCATION,
      RESULTS_WANTED,
      HOURS_OLD,
      'running',
      raw.length,
      0,
      null,
      new Date().toISOString(),
    ]
  );
  const scrapeRunId = runRow.rows[0].id;

  const fresh = await dedupeAndMap(pool, PROFILE_ID, scrapeRunId);
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
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
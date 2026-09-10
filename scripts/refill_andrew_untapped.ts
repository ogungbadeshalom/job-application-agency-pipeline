/* Untapped custom-board refill for Andrew — Lever + Sprout + fresh custom
 * greenhouse org feeds (per-company ATS, emits real job_urls, $0, DC-safe).
 * Andrew has ZERO lever/sprout rows, so this is genuinely fresh supply.
 * Usage: npx tsx scripts/refill_andrew_untapped.ts
 */
import { db } from '../db/repo';
import { runJobSpy, dedupeAndMap } from '../lib/scrape';
import { filterJobsByResume } from '../lib/aiJobMatch';

const PROFILE_ID = '022137cc-3978-4b4a-9e0a-54f3235f08d9'; // Andrew
const SITES = ['lever', 'sprout', 'greenhouse', 'ashby', 'dice']; // custom ATS feeds
const TERMS = [
  'data engineer', 'senior data engineer', 'data pipeline engineer',
  'analytics engineer', 'data warehouse engineer', 'ETL', 'data platform engineer',
  'data architect', 'big data', 'data engineering', 'data science', 'ml engineer',
];
const LOCATION = 'Remote';
const HOURS_OLD = 168;
const RESULTS_WANTED = 60;

async function main() {
  console.log(`Untapped custom-board refill for Andrew (${PROFILE_ID})`);
  console.log(`  sites=${SITES.join(',')} | terms=${TERMS.length} | remote`);

  const raw = await runJobSpy({
    sites: SITES,
    search_terms: TERMS,
    location: LOCATION,
    results_wanted: RESULTS_WANTED,
    hours_old: HOURS_OLD,
    is_remote: true,
    remove_easy_apply: true,
  }).catch((e) => { console.error('scrape failed:', e); process.exit(1); });
  console.log(`\nraw jobs scraped: ${raw.length}`);

  const { query } = await import('../db/pool');
  const perf = await query<{ base_resume_text: string | null }>(
    'select base_resume_text from profiles where id = $1', [PROFILE_ID]
  );
  const resumeText = perf.rows[0]?.base_resume_text ?? null;

  let pool = raw;
  if (resumeText && resumeText.trim().length > 0) {
    pool = await filterJobsByResume(raw, resumeText);
    console.log(`after resume role-fit gate: ${pool.length}`);
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

  const { fresh } = await dedupeAndMap(pool, PROFILE_ID, scrapeRunId);
  console.log(`new (non-duplicate) jobs: ${fresh.length}`);

  let added = 0;
  if (fresh.length > 0) {
    const created = await db.createJobs(fresh as any);
    added = created.length;
    console.log(`inserted ${added} jobs for Andrew.`);
  } else {
    console.log('No fresh jobs (all duplicates).');
  }

  await query(
    `update scrape_runs set status=$1, jobs_found=$2, jobs_added=$3, completed_at=$4 where id=$5`,
    ['completed', raw.length, added, new Date().toISOString(), scrapeRunId]
  );
  console.log(`\nDONE. raw=${raw.length} | after-fit=${pool.length} | added=${added}`);
  console.log(`scrape_run_id=${scrapeRunId}`);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
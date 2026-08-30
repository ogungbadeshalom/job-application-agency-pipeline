/* Ingest pre-scraped LinkedIn-US data-engineer jobs into Andrew's queue.
 *
 * The run_jobspy normal path already exhausted Andrew's active boards (saturation
 * — see refill_andrew.ts). To get a real full queue we scraped LinkedIn via the
 * project's UPSTREAM jobspy package with location="United States", which returns
 * real US data-engineer roles LinkedIn JOB_VIEW permalinks. These were captured to
 * a temp JSON file (ScrapeResultJob shape). This script runs them through the SAME
 * production pipeline the app uses: resume role-fit gate, URL dedupe, insert, and
 * a scrape_run audit row.
 *
 * Usage:
 *   npx tsx scripts/ingest_linkedin_andrew.ts
 */
import * as fs from 'fs';
import { db } from '../db/repo';
import { dedupeAndMap } from '../lib/scrape';
import { filterJobsByResume } from '../lib/aiJobMatch';
import { query } from '../db/pool';

const PROFILE_ID = '022137cc-3978-4b4a-9e0a-54f3235f08d9';
const SOURCE = process.env.SOURCE_JSON || '/tmp/lius_all.json';
const SITES = ['linkedin'];
const TERMS = ['data engineer', 'senior data engineer', 'data pipeline engineer',
  'ETL developer', 'data warehouse engineer', 'big data engineer',
  'data platform engineer', 'analytics engineer'];
const LOCATION = 'United States';
const HOURS_OLD = 144;

async function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error(`source ${SOURCE} not found`); process.exit(1);
  }
  const rawText = fs.readFileSync(SOURCE, 'utf-8')
    .replace(/-Infinity/g, 'null')
    .replace(/\bNaN\b/g, 'null')
    .replace(/\bInfinity\b/g, 'null');
  const raw = JSON.parse(rawText);
  console.log(`loaded ${raw.length} LinkedIn-US jobs`);

  // Drop obvious non-remote / non-submittable noise defensively.
  const valid = (raw as { job_url?: string }[]).filter(
    (r) => r && r.job_url && r.job_url.includes('linkedin.com/jobs/view/')
  );
  console.log(`with linkedin.com/jobs/view url: ${valid.length}`);

  // Role-fit gate against Andrew's base resume.
  const perf = await query<{ base_resume_text: string | null }>(
    'select base_resume_text from profiles where id = $1', [PROFILE_ID]
  );
  const resumeText = perf.rows[0]?.base_resume_text ?? null;
  let pool = valid;
  if (resumeText && resumeText.trim()) {
    pool = await filterJobsByResume(valid as any, resumeText);
    console.log(`after resume role-fit gate: ${pool.length}`);
  }

  // Audit scrape_run row.
  const runRow = await query<{ id: string }>(
    `insert into scrape_runs
      (triggered_by, profile_ids, sites, search_terms, location,
       results_wanted, hours_old, status, jobs_found, jobs_added, error_message, started_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
    [null, [PROFILE_ID], SITES, TERMS, LOCATION, 40, HOURS_OLD,
     'running', valid.length, 0, null, new Date().toISOString()]
  );
  const scrapeRunId = runRow.rows[0].id;

  const fresh = await dedupeAndMap(pool as any, PROFILE_ID, scrapeRunId);
  console.log(`new (non-duplicate): ${fresh.length}`);
  let added = 0;
  if (fresh.length) {
    added = (await db.createJobs(fresh as any)).length;
    console.log(`inserted ${added} jobs`);
  }
  await query(
    `update scrape_runs set status=$1, jobs_found=$2, jobs_added=$3, completed_at=$4 where id=$5`,
    ['completed', valid.length, added, new Date().toISOString(), scrapeRunId]
  );
  console.log(`\nDONE raw=${valid.length} after-fit=${pool.length} added=${added}`);
  console.log(`scrape_run_id=${scrapeRunId}`);
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
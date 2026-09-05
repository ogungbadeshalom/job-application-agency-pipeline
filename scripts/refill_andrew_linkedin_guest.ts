/*
 * Andrew LinkedIn-guest-API refill driver.
 *
 * 1. Runs scripts/refill_linkedin_guest.py (DC-safe free guest API, no proxy)
 * 2. Loads its JSON output
 * 3. Maps to JobSpy-style records and inserts through the SAME pipeline the app
 *    uses (dedupeAndMap + db.createJobs), so dedup + audit history work.
 *
 * Usage: npx tsx scripts/refill_andrew_linkedin_guest.ts
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { db } from '../db/repo';
import { dedupeAndMap } from '../lib/scrape';

const PROFILE_ID = '022137cc-3978-4b4a-9e0a-54f3235f08d9'; // Andrew Pendergrass
const OUT = path.join(__dirname, '..', 'tmp', 'linkedin_guest_out.json');
const TERMS = 'data engineer,senior data engineer,data pipeline engineer,data warehouse engineer,data platform engineer,analytics engineer,ETL developer,big data engineer';

async function main() {
  console.log('Running LinkedIn guest-API scrape (free, DC-safe)...');
  execSync(
    `python3 scripts/refill_linkedin_guest.py ${PROFILE_ID} --terms "${TERMS}" --max-pages 6 --sleep 6`,
    { cwd: path.join(__dirname, '..'), stdio: 'inherit' }
  );
  const rows = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  console.log(`guest API returned ${rows.length} unique jobs`);

  // Map to the JobSpy-style record shape that dedupeAndMap expects.
  // CRITICAL: dedupeAndMap reads r.job_url and r.site (JobSpy column names) —
  // passing url/board silently nulls both (past bug: board='unknown', url='').
  const mapped = rows.map((r: any) => ({
    title: r.title,
    company: r.company,
    job_url: r.url,
    site: r.board,
    location: r.location || 'United States (Remote)',
    description: `Remote data engineer role at ${r.company}.`,
    interval_amount: null,
    currency: 'USD',
  }));

  // Dedupe against existing jobs (by URL) + insert with a scrape_run row.
  const { query } = await import('../db/pool');
  const raw = rows.length;
  const run = await query<{ id: string }>(
    `insert into scrape_runs (triggered_by, profile_ids, sites, search_terms, location,
       results_wanted, hours_old, status, jobs_found, jobs_added, error_message, started_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
    [null, [PROFILE_ID], ['linkedin-guest'], ['data engineer'], 'United States (Remote)',
     1, 168, 'running', raw, 0, null, new Date().toISOString()]
  );
  const runId = run.rows[0].id;

  const fresh = await dedupeAndMap(mapped as any, PROFILE_ID, runId);
  let added = 0;
  if (fresh.length > 0) {
    const created = await db.createJobs(fresh as any);
    added = created.length;
  } else {
    console.log('all were duplicates — nothing new');
  }
  await query(
    `update scrape_runs set status=$1, jobs_found=$2, jobs_added=$3, completed_at=$4 where id=$5`,
    ['completed', raw, added, new Date().toISOString(), runId]
  );
  console.log(`DONE. guest=${raw} | deduped-new=${fresh.length} | added=${added}`);
  console.log(`scrape_run_id=${runId}`);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
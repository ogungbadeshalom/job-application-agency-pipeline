/* High-volume LinkedIn refill for Andrew (data engineer) using the UPSTREAM
 * jobspy LinkedIn scraper (python3.14) which returns real US companies — the
 * path the app's scrape_linkedin_upstream.py provides. Requires location as a
 * valid country name ("usa"), not "Remote" (upstream jobspy rejects "Remote").
 * Same production role-fit + dedupe + insert pipeline as /api/scrape.
 *
 *   npx tsx scripts/refill_andrew_linkedin.ts
 */
import { spawn } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { db } from '../db/repo';
import { dedupeAndMap } from '../lib/scrape';
import { filterJobsByResume } from '../lib/aiJobMatch';

const PROFILE_ID = '022137cc-3978-4b4a-9e0a-54f3235f08d9'; // Andrew Pendergrass
const TERMS = [
  'data engineer',
  'senior data engineer',
  'data pipeline engineer',
  'analytics engineer',
  'data warehouse engineer',
  'data platform engineer',
  'big data engineer',
  'data architect',
  'etl developer',
];
const LOCATION = 'usa'; // upstream jobspy needs a country, not "Remote"
const HOURS_OLD = 168;
const RESULTS_WANTED = 60;

// Runs scrape_linkedin_upstream.py (python3.14 + upstream jobspy) for one term,
// returns parsed JobSpy-style records.
function scrapeLinkedIn(term: string): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const tmpFile = path.join(os.tmpdir(), `li_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);
    const pyBin = '/usr/bin/python3.14';
    const script = path.join(process.cwd(), 'scripts', 'scrape_linkedin_upstream.py');
    const args = { term, location: LOCATION, results_wanted: RESULTS_WANTED, hours_old: HOURS_OLD, is_remote: true, site: 'linkedin' };
    const child = spawn(pyBin, [script, JSON.stringify(args), tmpFile], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', reject);
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`linkedin timeout: ${stderr.slice(0, 300)}`)); }, 120_000);
    child.on('close', async (code) => {
      clearTimeout(timer);
      if (code !== 0) { reject(new Error(`scrape_linkedin_upstream exited ${code}: ${stderr.slice(0, 400)}`)); return; }
      try {
        const raw = await fs.readFile(tmpFile, 'utf-8');
        // Sanitize non-JSON literals (NaN/-Infinity/Infinity) the same way
        // lib/scrape.ts runJobSpy does, so a single NaN doesn't break the batch.
        const safeText = raw
          .replace(/-Infinity/g, 'null')
          .replace(/\bNaN\b/g, 'null')
          .replace(/\bInfinity\b/g, 'null');
        const parsed = JSON.parse(safeText);
        await fs.rm(tmpFile, { force: true });
        resolve(Array.isArray(parsed) ? parsed : []);
      } catch (e) {
        await fs.rm(tmpFile, { force: true }).catch(() => {});
        reject(e);
      }
    });
  });
}

async function main() {
  console.log(`LinkedIn volume refill for Andrew (${PROFILE_ID})`);
  console.log(`  terms=${TERMS.length} | location=${LOCATION} | hours_old=${HOURS_OLD} | wanted/term=${RESULTS_WANTED}`);

  // Scrape each term sequentially (LinkedIn throttles; sequential is safer).
  const rawAll: Record<string, unknown>[] = [];
  for (const term of TERMS) {
    try {
      const recs = await scrapeLinkedIn(term);
      console.log(`  [ok] ${term}: ${recs.length} jobs`);
      rawAll.push(...recs);
    } catch (e) {
      console.log(`  [warn] ${term}: ${(e as Error).message.slice(0, 120)}`);
    }
  }
  console.log(`\nraw jobs scraped: ${rawAll.length}`);

  const { query } = await import('../db/pool');
  const perf = await query<{ base_resume_text: string | null }>(
    'select base_resume_text from profiles where id = $1',
    [PROFILE_ID]
  );
  const resumeText = perf.rows[0]?.base_resume_text ?? null;

  let pool = rawAll;
  if (resumeText && resumeText.trim().length > 0) {
    pool = await filterJobsByResume(rawAll, resumeText);
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
    [null, [PROFILE_ID], ['linkedin'], TERMS, LOCATION, RESULTS_WANTED, HOURS_OLD, 'running', rawAll.length, 0, null, new Date().toISOString()]
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
    ['completed', rawAll.length, added, new Date().toISOString(), scrapeRunId]
  );
  console.log(`\nDONE. raw=${rawAll.length} | after-fit=${pool.length} | added=${added}`);
  console.log(`scrape_run_id=${scrapeRunId}`);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
/* Non-LinkedIn remote refill for Olumuyiwa Ogungbade (Shalom's father, EMEA finance).
 * Production runJobSpy + dedupeAndMap + createJobs chain. Finance terms.
 */
import { db } from '../db/repo';
import { runJobSpy, dedupeAndMap } from '../lib/scrape';
import { filterJobsByResume } from '../lib/aiJobMatch';
import { query } from '../db/pool';

const PROFILE_ID = 'd342fb32-7e11-486c-b0e0-255c05ca909c'; // Olumuyiwa Ogungbade

const SITES = ['greenhouse', 'builtin', 'jobicy', 'workingnomads'];
const TERMS = [
  'financial controller', 'financial reporting manager', 'finance manager',
  'senior financial accountant', 'fixed asset accountant', 'accounts payable manager',
  'finance operations manager', 'internal control analyst', 'group accountant',
  'FP&A analyst', 'payroll manager', 'revenue accountant',
];
const LOCATION = 'Remote';
const HOURS_OLD = 168;
const RESULTS_WANTED = 50;

async function main() {
  console.log(`Refill for Olumuyiwa (${PROFILE_ID})`);
  const raw = await runJobSpy({
    sites: SITES, search_terms: TERMS, location: LOCATION,
    results_wanted: RESULTS_WANTED, hours_old: HOURS_OLD, is_remote: true,
  });
  console.log(`raw jobs: ${raw.length}`);

  const profile = await db.getProfile(PROFILE_ID);
  if (!profile) throw new Error('profile not found');

  const fit = await filterJobsByResume(raw as never, profile.base_resume_text || '');
  console.log(`after role-fit: ${fit.length}`);

  const runRow = await query(
    `insert into scrape_runs (triggered_by, profile_ids, sites, search_terms,
       location, results_wanted, hours_old, status, jobs_found, jobs_added,
       error_message, started_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     returning id`,
    [null, [PROFILE_ID], SITES, TERMS, LOCATION, RESULTS_WANTED, HOURS_OLD,
     'running', raw.length, 0, null, new Date().toISOString()]
  );
  const scrapeRunId = runRow.rows[0].id;

  const { fresh } = await dedupeAndMap(fit as never, PROFILE_ID, scrapeRunId);
  console.log(`stage 3 (dedupe): ${fresh.length} new`);

  let added = 0;
  if (fresh.length > 0) {
    const created = await db.createJobs(fresh as never);
    added = created.length;
    console.log(`inserted ${added} jobs for Olumuyiwa.`);
  } else {
    console.log('No fresh jobs (all duplicates).');
  }

  await query(
    `update scrape_runs set status=$1, jobs_found=$2, jobs_added=$3, completed_at=$4 where id=$5`,
    ['completed', raw.length, added, new Date().toISOString(), scrapeRunId]
  );
  console.log(`DONE. raw=${raw.length} | fit=${fit.length} | added=${added}`);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });

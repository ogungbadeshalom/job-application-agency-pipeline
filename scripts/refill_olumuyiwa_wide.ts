/* WIDE refill for Olumuyiwa Ogungbade — more boards (incl. LinkedIn), 14-day
 * window, 150/term, expanded adjacent finance titles. Same gates as prod route.
 */
import { db } from '../db/repo';
import { runJobSpy, dedupeAndMap } from '../lib/scrape';
import { filterJobsByResume, filterByAllowedRoles } from '../lib/aiJobMatch';
import { query } from '../db/pool';

const PROFILE_ID = 'd342fb32-7e11-486c-b0e0-255c05ca909c'; // Olumuyiwa Ogungbade

const SITES = ['linkedin', 'builtin', 'greenhouse', 'jobicy', 'workingnomads', 'remoteok'];
const TERMS = [
  'financial controller', 'financial reporting manager', 'finance manager',
  'senior financial accountant', 'fixed asset accountant', 'accounts payable manager',
  'finance operations manager', 'internal control analyst', 'group accountant',
  'FP&A analyst', 'payroll manager', 'revenue accountant',
  // adjacent titles to widen supply
  'management accountant', 'accounting manager', 'finance analyst',
  'head of finance', 'treasurer', 'assistant controller', 'gl accountant',
  'commercial finance manager', 'finance business partner', 'bookkeeping lead',
];
const LOCATION = 'EMEA Remote';
const HOURS_OLD = 336; // 14 days
const RESULTS_WANTED = 150;

async function main() {
  console.log(`WIDE refill for Olumuyiwa (${PROFILE_ID}) — ${SITES.length} boards x ${TERMS.length} terms, ${HOURS_OLD}h`);
  const profile = await db.getProfile(PROFILE_ID);
  if (!profile) throw new Error('profile not found');

  // single-token boards (builtin/remoteok) need the location split like the route:
  // remote-friendly all get EMEA Remote; remoteok handles it natively.
  const allRaw: never[] = [];
  let rawCount = 0;
  const onProgress = (p: { step: number; totalSteps: number; current: string; jobsFound: number }) => {
    process.stdout.write(`\r[${p.step}/${p.totalSteps}] ${p.current} (${p.jobsFound})   `);
  };

  const raw = await runJobSpy({
    sites: SITES, search_terms: TERMS, location: LOCATION,
    results_wanted: RESULTS_WANTED, hours_old: HOURS_OLD, is_remote: false,
  }, onProgress as never);
  allRaw.push(...(raw as never[]));
  rawCount = raw.length;
  console.log(`\nraw jobs: ${rawCount}`);

  // builtin/remoteok single-token tag boards: re-run thin boards tokenized
  const hasSingleTokenBoard = SITES.some((s) => ['remoteok', 'builtin'].includes(s));
  const thin = raw.length < RESULTS_WANTED / 2;
  if (hasSingleTokenBoard && thin) {
    const tokens = TERMS.flatMap((t) => t.split(/\s+/)).filter(Boolean);
    const extra = await runJobSpy({
      sites: ['builtin', 'remoteok'], search_terms: tokens, location: LOCATION,
      results_wanted: RESULTS_WANTED, hours_old: HOURS_OLD,
    });
    console.log(`single-token re-run added: ${extra.length}`);
    allRaw.push(...(extra as never[]));
    rawCount += extra.length;
  }

  // STRICT finance allowlist first, then AI role-fit gate
  let matched: typeof raw = raw;
  if (profile.allowed_roles?.length) {
    matched = filterByAllowedRoles(matched, profile.allowed_roles);
    console.log(`after allowlist: ${matched.length}`);
  }
  const fit = await filterJobsByResume(matched as never, profile.base_resume_text || '');
  console.log(`after role-fit: ${fit.length}`);

  const runRow = await query(
    `insert into scrape_runs (triggered_by, profile_ids, sites, search_terms,
       location, results_wanted, hours_old, status, jobs_found, jobs_added,
       error_message, started_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     returning id`,
    [null, [PROFILE_ID], SITES, TERMS, LOCATION, RESULTS_WANTED, HOURS_OLD,
     'running', rawCount, 0, null, new Date().toISOString()]
  );
  const scrapeRunId = runRow.rows[0].id;

  const { fresh, skippedDuplicates } = await dedupeAndMap(fit as never, PROFILE_ID, scrapeRunId);
  console.log(`dedupe: ${fresh.length} new (${skippedDuplicates} already in queue)`);

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
    ['completed', rawCount, added, new Date().toISOString(), scrapeRunId]
  );
  console.log(`DONE. raw=${rawCount} | fit=${fit.length} | added=${added}`);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });

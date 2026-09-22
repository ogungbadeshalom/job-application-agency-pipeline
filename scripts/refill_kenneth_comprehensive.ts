/* Comprehensive non-LinkedIn remote refill for Kenneth Smith (full-stack / AI).
 * Wider board + term matrix than the base script to surface fresh supply past
 * the dedup wall (Kenneth already holds ~185 jobs). No LinkedIn. */
import { db } from '../db/repo';
import { runJobSpy, dedupeAndMap } from '../lib/scrape';
import { filterJobsByResume } from '../lib/aiJobMatch';

const PROFILE_ID = '44e7a4cc-e302-44e6-9c80-63879338ca91'; // Kenneth Smith

const SITES = [
  'greenhouse', 'builtin', 'jobicy', 'remoteok', 'weworkremotely',
  'remotive', 'workingnomads', 'ashby', 'dice', 'smart_recruiters',
]; // proxy-gated (zip_recruiter/glassdoor/indeed) skipped — unreliable from this box
const TERMS = [
  // Backend / platform (his core)
  'software engineer', 'senior software engineer', 'backend engineer', 'platform engineer',
  'fullstack engineer', 'full stack engineer', 'full-stack developer', 'web developer',
  'application engineer', 'software developer', 'product engineer', 'staff engineer',
  // AI/ML (his specialty)
  'machine learning engineer', 'AI engineer', 'ML engineer', 'LLM engineer',
  'AI platform engineer', 'ML platform engineer', 'applied scientist', 'data scientist',
  // Cloud / infra / DevOps (his secondary)
  'cloud engineer', 'DevOps engineer', 'Site Reliability Engineer', 'SRE',
  'AWS engineer', 'infrastructure engineer', 'cloud developer',
  // Data (his data-pipeline experience)
  'data engineer', 'data pipeline engineer', 'analytics engineer', 'ETL developer',
  // Language-driven (broadens surface)
  'Python developer', 'Java developer', 'C# developer', 'Node.js developer',
  'React developer', 'TypeScript developer', '.NET developer', 'Go developer',
  // Domain
  'API developer', 'microservices engineer', 'distributed systems engineer',
];
const LOCATION = 'Remote';
const HOURS_OLD = 168;
const RESULTS_WANTED = 60;

async function main() {
  console.log(`Comprehensive non-LinkedIn remote refill for Kenneth Smith (${PROFILE_ID})`);
  console.log(`  sites=${SITES.length} | terms=${TERMS.length} | location=${LOCATION} | hours=${HOURS_OLD}\n`);

  const raw = await runJobSpy({
    sites: SITES,
    search_terms: TERMS,
    location: LOCATION,
    results_wanted: RESULTS_WANTED,
    hours_old: HOURS_OLD,
    is_remote: true,
    remove_easy_apply: true,
  }).catch((e) => { console.error('scrape failed:', e); process.exit(1); });
  console.log(`\nstage 1 (scrape): ${raw.length} raw`);

  const { query } = await import('../db/pool');
  const perf = await query('select base_resume_text from profiles where id=$1', [PROFILE_ID]);
  const resumeText = perf.rows[0]?.base_resume_text ?? null;
  let pool = raw;
  if (resumeText && resumeText.trim().length > 0) {
    pool = await filterJobsByResume(raw, resumeText);
    console.log(`stage 2 (role-fit): ${pool.length} pass`);
  } else {
    console.log('no base resume — skipping role-fit');
  }

  const runRow = await query(
    `insert into scrape_runs (triggered_by, profile_ids, sites, search_terms, location,
       results_wanted, hours_old, status, jobs_found, jobs_added, error_message, started_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
    [null, [PROFILE_ID], SITES, TERMS, LOCATION, RESULTS_WANTED, HOURS_OLD, 'running', raw.length, 0, null, new Date()]
  );
  const scrapeRunId = runRow.rows[0].id;

  const { fresh, skippedDuplicates } = await dedupeAndMap(pool, PROFILE_ID, scrapeRunId);
  console.log(`stage 3 (dedupe): ${fresh.length} new\n`);

  let inserted = 0;
  if (fresh.length > 0) {
    const created = await db.createJobs(fresh as any);
    inserted = created.length;
    console.log(`inserted ${inserted} jobs for Kenneth Smith.`);
  } else {
    console.log('No fresh jobs (all duplicates).');
  }

  await query(
    `update scrape_runs set status='completed', jobs_added=$1, completed_at=now() where id=$2`,
    [inserted, scrapeRunId]
  );
  console.log(`DONE. raw=${raw.length} | fit=${pool.length} | added=${inserted}`);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
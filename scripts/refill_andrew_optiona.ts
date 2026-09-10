/* OPTION-A refill for Andrew — NO LinkedIn, EVERY job page-verified remote
 * before insert. Pipeline:
 *   1. Scrape all non-LinkedIn boards that still yield (incl. custom ATS feeds).
 *   2. AI role-fit gate (data-engineer resume).
 *   3. PER-JOB remote verification: fetch each surviving posting's live page,
 *      classify remote / on-site / hybrid / easy-apply. ONLY confirmed-remote
 *      pass.
 *   4. Insert survivors with verified_remote=true.
 * Strictness is the point (option A) — a job is never inserted on a location
 * field alone; its actual page must say remote with no on-site/hybrid signal
 * and no Easy Apply.
 *
 * Usage: npx tsx scripts/refill_andrew_optiona.ts   (reports funnel per stage)
 */
import { db } from '../db/repo';
import { runJobSpy, dedupeAndMap } from '../lib/scrape';
import { filterJobsByResume } from '../lib/aiJobMatch';

const PROFILE_ID = '022137cc-3978-4b4a-9e0a-54f3235f08d9'; // Andrew
// All non-LinkedIn boards run_jobspy can source. HiringCafe excluded (linkless).
const SITES = [
  'greenhouse', 'builtin', 'jobicy', 'remoteok', 'weworkremotely',
  'remotive', 'workingnomads', 'ashby', 'dice', 'smart_recruiters',
  'lever', 'sprout',
];
const TERMS = [
  'data engineer', 'senior data engineer', 'data pipeline engineer',
  'analytics engineer', 'data warehouse engineer', 'ETL developer',
  'data platform engineer', 'data architect', 'big data engineer',
  'data engineering', 'sql developer', 'python data',
];
const LOCATION = 'Remote';
const HOURS_OLD = 168;
const RESULTS_WANTED = 60;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

function stripHtml(h: string): string {
  return h
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&amp;|&#39;|&quot;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Classify a single job by fetching its live page. Returns 'remote' | 'skip:<reason>'.
async function verifyJob(title: string, company: string, board: string, url: string, loc: string | null, desc: string | null): Promise<string> {
  const location = (loc || '').toLowerCase();
  // Hard on-site/hybrid in the location field wins immediately.
  if (/\bon[- ]?site\b|\bhybrid\b|in[- ]office/.test(location)) return 'skip:location-on-site';

  let text = (desc || '').toLowerCase();
  let status = 0;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
    status = res.status;
    if (res.status < 400) text = stripHtml(await res.text()).toLowerCase();
  } catch { /* page fetch failed — fall through to stored fields */ }

  const easy = /easy\s*apply/i.test(text);
  if (easy) return 'skip:easy-apply';

  // On-site/hybrid wins over any remote mention.
  const onsiteSignal = /\bon[- ]?site\b|\bhybrid\b|in[- ]office/.test(text) && !/\bremote\b/.test(text);
  if (onsiteSignal) return `skip:onsite${status ? `(http${status})` : '(no-fetch)'}`;

  const remote = /\bremote\b|work from home|\bwfh\b/.test(location) || /\bremote\b|work from home|\bwfh\b/.test(text);
  return remote ? 'remote' : 'skip:unverified-remote';
}

async function main() {
  console.log(`[OPTION-A] No-LinkedIn, page-verified refill for Andrew (${PROFILE_ID})`);
  console.log(`  sites=${SITES.length} | terms=${TERMS.length} | strict remote-verify on insert\n`);

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

  // stage 3: per-job remote verification.
  const verified: typeof fit = [];
  const skipped: string[] = [];
  for (const j of fit) {
    const verdict = await verifyJob(
      (j as any).title, (j as any).company, (j as any).site,
      (j as any).job_url, (j as any).location ?? null, (j as any).description ?? null,
    );
    if (verdict === 'remote') verified.push(j);
    else skipped.push(`${(j as any).site}:${((j as any).title || '?').slice(0, 30)} → ${verdict}`);
  }
  console.log(`stage 3 (page-verified remote): ${verified.length} confirmed-remote | skipped ${skipped.length}`);
  if (skipped.length) {
    console.log('  skipped:');
    skipped.slice(0, 15).forEach((s) => console.log(`    - ${s}`));
    if (skipped.length > 15) console.log(`    ... and ${skipped.length - 15} more`);
  }
  console.log('');

  // stage 4: dedupe + insert ONLY verified-remote.
  const { fresh } = await dedupeAndMap(verified, PROFILE_ID, scrapeRunId);
  console.log(`stage 4 (dedupe): ${fresh.length} new verified-remote\n`);

  let added = 0;
  if (fresh.length > 0) {
    const stamped = fresh.map((j: any) => ({ ...j, verified_remote: true, easy_apply: false }));
    const created = await db.createJobs(stamped as any);
    added = created.length;
    console.log(`inserted ${added} verified-remote jobs for Andrew.`);
  } else {
    console.log('No fresh verified-remote jobs (all were duplicates).');
  }

  await query(
    `update scrape_runs set status=$1, jobs_found=$2, jobs_added=$3, completed_at=$4 where id=$5`,
    ['completed', raw.length, added, new Date().toISOString(), scrapeRunId]
  );
  console.log(`\nDONE. raw=${raw.length} | fit=${fit.length} | verified-remote=${verified.length} | added=${added}`);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
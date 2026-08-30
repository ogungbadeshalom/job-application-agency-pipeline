/* REMOTE-ONLY LinkedIn refill — the DEFAULT refill path.
 *
 * Uses the Agent-Reach LinkedIn MCP (logged-in). LinkedIn's own remote filter
 * (f_WT=2 / work_type="remote") returns only remote postings, and
 * get_job_details returns the FULL description for the role-fit + remote gate.
 *
 * This is the fix for on-site jobs slipping into the queue: every job added is
 * (a) selected as work_type=remote by LinkedIn AND (b) re-checked against its
 * real description before insert. It also AUTO-CLEANS on-site-location jobs
 * already in the profile's queue, so the queue only ever holds remote (with
 * descriptions) once the run finishes.
 *
 *   npm run refill:remote             # default (40 jobs)
 *   npm run refill:remote -- 10       # or with a maxJobs argument
 *
 * Requires the `linkedin` MCP server (mcporter) to be healthy.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { db } from '../db/repo';
import { dedupeAndMap } from '../lib/scrape';
import { filterJobsByResume } from '../lib/aiJobMatch';
import type { ScrapeResultJob } from '../lib/types';

const exec = promisify(execFile);
const PROFILE_ID = '022137cc-3978-4b4a-9e0a-54f3235f08d9'; // Andrew Pendergrass
const TERMS = [
  'data engineer',
  'senior data engineer',
  'data pipeline engineer',
  'analytics engineer',
  'data warehouse engineer',
  'data platform engineer',
  'data architect',
  'etl developer',
];
const LOCATION = 'United States';

/** Call a linkedin MCP tool via mcporter, return parsed JSON. */
async function mcpCall<T>(call: string): Promise<T> {
  const { stdout } = await exec('mcporter', ['call', call], {
    timeout: 120_000,
    maxBuffer: 20 * 1024 * 1024,
  });
  // mcporter pollutes stdout with the FastMCP startup banner AFTER the JSON
  // object. Extract exactly the first top-level JSON object (brace counter,
  // string-safe) and ignore the trailing log lines.
  const start = stdout.indexOf('{');
  if (start === -1) throw new Error(`no JSON from mcporter: ${stdout.slice(0, 200)}`);
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < stdout.length; i++) {
    const ch = stdout[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return JSON.parse(stdout.slice(start, i + 1)) as T;
    }
  }
  throw new Error('unterminated JSON object in mcporter output');
}

interface SearchResult {
  job_ids?: string[];
}
interface DetailResult {
  sections?: { job_posting?: string };
}

async function searchRemoteJobs(term: string): Promise<string[]> {
  const out = await mcpCall<SearchResult>(`linkedin.search_jobs(keywords: "${term}", location: "${LOCATION}", work_type: "remote", max_pages: 1)`);
  return Array.isArray(out.job_ids) ? out.job_ids.map(String) : [];
}

async function fetchJobDetail(jobId: string): Promise<{ title: string; company: string; description: string; workType: string; easyApply: boolean } | null> {
  const out = await mcpCall<DetailResult>(`linkedin.get_job_details(job_id: "${jobId}")`);
  const job = out.sections?.job_posting ?? '';
  if (!job) return null;
  // job_posting layout: company\n\ntitle\n\nlocation · ...\nRemote/Fully remote\n...\nEasy Apply|Apply
  const lines = job.split('\n').map((l) => l.trim()).filter(Boolean);
  const title = lines[1] ?? `LinkedIn Job ${jobId}`;
  const company = lines[0] ?? '';
  // Location/remote marker appears in the first ~8 non-empty lines.
  const head = lines.slice(0, 8).join(' ');
  const isRemote = /\bremote\b|fully remote|100% remote|work from home|wfh/i.test(head);
  const isOnSite = /\bon[- ]?site\b|hybrid|in[- ]office\b/i.test(head);
  const workType = isRemote ? 'remote' : isOnSite ? 'on-site' : 'unknown';
  // Easy Apply = the posting's apply button says "Easy Apply" (vs a regular
  // "Apply" / external ATS). We strictly exclude these — user doesn't want them.
  const easyApply = /easy\s*apply/i.test(job);
  const descIdx = job.search(/about the job/i);
  const description = (descIdx !== -1 ? job.slice(descIdx) : job).trim();
  return { title, company, description, workType, easyApply };
}

async function main() {
  const maxJobs = Number(process.argv[2] ?? process.env.LINKEDIN_MAX_JOBS ?? '40') || 40;
  console.log(`Remote-only LinkedIn refill for Andrew (${PROFILE_ID})`);
  console.log(`  terms=${TERMS.length} | location=${LOCATION} | work_type=remote | maxJobs=${maxJobs}\n`);

  // 1. Collect remote job_ids across terms (dedupe).
  const seen = new Set<string>();
  const jobIds: string[] = [];
  for (const term of TERMS) {
    try {
      const ids = await searchRemoteJobs(term);
      for (const id of ids) if (!seen.has(id)) { seen.add(id); jobIds.push(id); }
      console.log(`  [ok] ${term}: ${ids.length} remote ids (unique: ${jobIds.length})`);
    } catch (e) {
      console.log(`  [warn] ${term}: ${(e as Error).message.slice(0, 140)}`);
    }
    if (jobIds.length >= maxJobs) break;
  }

  // 2. Fetch details + strict remote gate (only genuinely remote descriptions).
  const raw: ScrapeResultJob[] = [];
  for (const id of jobIds.slice(0, maxJobs)) {
    try {
      const d = await fetchJobDetail(id);
      if (!d || d.workType !== 'remote') continue; // strict remote-only
      if (d.easyApply) {
        console.log(`  [x] ${id}: easy apply — excluded`);
        continue; // strictly exclude Easy Apply (user requirement)
      }
      raw.push({
        title: d.title,
        company: d.company,
        site: 'linkedin',
        job_url: `https://www.linkedin.com/jobs/view/${id}`,
        description: d.description || `Remote ${d.title}`,
        interval_amount: null,
        currency: 'USD',
        location: 'Remote',
        date_posted: null,
      });
    } catch (e) {
      const msg = String((e as Error).message);
      if (/throt|429|too many/i.test(msg)) {
        console.log('  [warn] LinkedIn throttling; pausing 6s');
        await new Promise((r) => setTimeout(r, 6000));
      }
    }
  }
  console.log(`\nafter remote gate + easy-apply exclusion: ${raw.length} jobs`);

  // 3. Role-fit gate using Andrew's resume.
  const { query } = await import('../db/pool');
  const perf = await query<{ base_resume_text: string | null }>(
    'select base_resume_text from profiles where id = $1', [PROFILE_ID]);
  const resumeText = perf.rows[0]?.base_resume_text ?? null;
  let pool: ScrapeResultJob[] = raw;
  if (resumeText && resumeText.trim().length > 0) {
    pool = await filterJobsByResume(raw, resumeText);
    console.log(`after role-fit gate: ${pool.length}`);
  }

  // 4. Auto-clean (#6): before inserting fresh, purge any on-site-location jobs
  //    that accumulated for this profile, so the queue only ever holds remote.
  const clean = await query(
    `delete from jobs
     where profile_id = $1
       and status = 'saved'
       and coalesce(location, '') <> ''
       and lower(location) not like '%remote%'
       and (
             location ~ ',[ ]+[A-Z]{2}$'
          or location ~ ',[ ]+[A-Za-z]+,[ ]+(United States|USA|US|Canada)$'
          or lower(location) like '%on-site%'
          or lower(location) like '%on site%'
          or lower(location) like '%hybrid%'
          or lower(location) like '%metropolitan area%'
       )`,
    [PROFILE_ID]
  );
  if (clean.rowCount && clean.rowCount > 0) console.log(`auto-cleaned ${clean.rowCount} on-site job(s)`);

  // 5. Audit-record + dedupe + insert.
  const runRow = await query<{ id: string }>(
    `insert into scrape_runs (triggered_by, profile_ids, sites, search_terms, location,
       results_wanted, hours_old, status, jobs_found, jobs_added, error_message, started_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
    [null, [PROFILE_ID], ['linkedin'], TERMS, 'Remote', maxJobs, 168, 'running', raw.length, 0, null, new Date().toISOString()]
  );
  const scrapeRunId = runRow.rows[0].id;

  const fresh = await dedupeAndMap(pool, PROFILE_ID, scrapeRunId);
  // These came from the Agent-Reach pipeline: LinkedIn work_type=remote AND the
  // real description was fetched + re-checked — so mark them verified_remote so
  // workers can trust they qualify without re-checking. easy_apply is false here
  // because those were strictly excluded above.
  for (const j of fresh) {
    j.verified_remote = true;
    j.easy_apply = false;
  }
  let added = 0;
  if (fresh.length > 0) {
    const created = await db.createJobs(fresh as any);
    added = created.length;
  }
  await query(
    `update scrape_runs set status=$1, jobs_found=$2, jobs_added=$3, completed_at=$4 where id=$5`,
    ['completed', raw.length, added, new Date().toISOString(), scrapeRunId]
  );
  console.log(`\nDONE. remote=${raw.length} | after-fit=${pool.length} | added=${added}`);
  console.log(`scrape_run_id=${scrapeRunId}`);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
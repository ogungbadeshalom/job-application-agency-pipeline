/* REMOTE-ONLY LinkedIn refill — generalized for any profile / term set.
 *
 * Same logic as refill_andrew_linkedin_remote.ts but parametrized so it can
 * refill ANY client profile. Uses the Agent-Reach LinkedIn MCP (logged-in):
 * LinkedIn's own remote filter (work_type=remote) + real descriptions,
 * strict easy-apply exclusion, role-fit gate against the profile's resume,
 * auto-clean of on-site-location jobs, and verified_remote marking.
 *
 *   PROFILE=<uuid> TERMS="a,b,c" npx tsx scripts/refill_remote.ts [maxJobs]
 *
 * Requires the `linkedin` MCP server (mcporter) to be healthy.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { db } from '../db/repo';
import { dedupeAndMap } from '../lib/scrape';
import { filterJobsByResume } from '../lib/aiJobMatch';
import { query } from '../db/pool';
import type { ScrapeResultJob } from '../lib/types';

const exec = promisify(execFile);

function arg(k: string, def: string): string {
  const v = process.env[k];
  return v && v.trim() ? v : def;
}

async function main() {
  const PROFILE_ID = arg('PROFILE', '022137cc-3978-4b4a-9e0a-54f3235f08d9');
  const TERMS = arg('TERMS', 'data engineer, senior data engineer').split(',').map((s) => s.trim()).filter(Boolean);
  const LOCATION = arg('LOCATION', 'United States');
  const maxJobs = Number(process.argv[2] ?? process.env.LINKEDIN_MAX_JOBS ?? '40') || 40;

  const prof = await query<{ name: string }>('select name from profiles where id=$1', [PROFILE_ID]);
  const profName = prof.rows[0]?.name ?? PROFILE_ID;

  console.log(`Remote-only LinkedIn refill for ${profName} (${PROFILE_ID})`);
  console.log(`  terms=${TERMS.length} | location=${LOCATION} | work_type=remote | maxJobs=${maxJobs}\n`);

  async function mcpCall<T>(call: string): Promise<T> {
    const { stdout } = await exec('mcporter', ['call', call], { timeout: 120_000, maxBuffer: 20 * 1024 * 1024 });
    const start = stdout.indexOf('{');
    if (start === -1) throw new Error(`no JSON from mcporter: ${stdout.slice(0, 200)}`);
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < stdout.length; i++) {
      const ch = stdout[i];
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) return JSON.parse(stdout.slice(start, i + 1)) as T; }
    }
    throw new Error('unterminated JSON in mcporter output');
  }

  interface SearchResult { job_ids?: string[] }
  interface DetailResult { sections?: { job_posting?: string } }

  async function searchRemoteJobs(term: string): Promise<string[]> {
    const out = await mcpCall<SearchResult>(`linkedin.search_jobs(keywords: "${term}", location: "${LOCATION}", work_type: "remote", max_pages: 1)`);
    return Array.isArray(out.job_ids) ? out.job_ids.map(String) : [];
  }

  async function fetchJobDetail(jobId: string): Promise<{ title: string; company: string; description: string; workType: string; easyApply: boolean } | null> {
    const out = await mcpCall<DetailResult>(`linkedin.get_job_details(job_id: "${jobId}")`);
    const job = out.sections?.job_posting ?? '';
    if (!job) return null;
    const lines = job.split('\n').map((l) => l.trim()).filter(Boolean);
    const title = lines[1] ?? `LinkedIn Job ${jobId}`;
    const company = lines[0] ?? '';
    const head = lines.slice(0, 8).join(' ');
    const isRemote = /\bremote\b|fully remote|100% remote|work from home|wfh/i.test(head);
    const isOnSite = /\bon[- ]?site\b|hybrid|in[- ]office\b/i.test(head);
    const workType = isRemote ? 'remote' : isOnSite ? 'on-site' : 'unknown';
    const easyApply = /easy\s*apply/i.test(job);
    const descIdx = job.search(/about the job/i);
    const description = (descIdx !== -1 ? job.slice(descIdx) : job).trim();
    return { title, company, description, workType, easyApply };
  }

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

  // 2. Fetch details + strict remote + easy-apply gate.
  const raw: ScrapeResultJob[] = [];
  for (const id of jobIds.slice(0, maxJobs)) {
    try {
      const d = await fetchJobDetail(id);
      if (!d || d.workType !== 'remote') continue;
      if (d.easyApply) { console.log(`  [x] ${id}: easy apply — excluded`); continue; }
      raw.push({
        title: d.title, company: d.company, site: 'linkedin',
        job_url: `https://www.linkedin.com/jobs/view/${id}`,
        description: d.description || `Remote ${d.title}`,
        interval_amount: null, currency: 'USD', location: 'Remote', date_posted: null,
      });
    } catch (e) {
      const msg = String((e as Error).message);
      if (/throt|429|too many/i.test(msg)) { console.log('  [warn] throttling; pausing 6s'); await new Promise((r) => setTimeout(r, 6000)); }
    }
  }
  console.log(`\nafter remote gate + easy-apply exclusion: ${raw.length} jobs`);

  // 3. Role-fit gate using the profile's resume.
  const perf = await query<{ base_resume_text: string | null }>('select base_resume_text from profiles where id = $1', [PROFILE_ID]);
  const resumeText = perf.rows[0]?.base_resume_text ?? null;
  let pool: ScrapeResultJob[] = raw;
  if (resumeText && resumeText.trim().length > 0) {
    pool = await filterJobsByResume(raw, resumeText);
    console.log(`after role-fit gate: ${pool.length}`);
  }

  // 4. Auto-clean on-site-location jobs already saved for this profile.
  const clean = await query(
    `delete from jobs
     where profile_id = $1 and status = 'saved' and coalesce(location, '') <> ''
       and lower(location) not like '%remote%'
       and (location ~ ',[ ]+[A-Z]{2}$'
            or location ~ ',[ ]+[A-Za-z]+,[ ]+(United States|USA|US|Canada)$'
            or lower(location) like '%on-site%' or lower(location) like '%on site%'
            or lower(location) like '%hybrid%' or lower(location) like '%metropolitan area%')`,
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
  for (const j of fresh) { j.verified_remote = true; j.easy_apply = false; }
  let added = 0;
  if (fresh.length > 0) { const created = await db.createJobs(fresh as any); added = created.length; }
  await query(
    `update scrape_runs set status=$1, jobs_found=$2, jobs_added=$3, completed_at=$4 where id=$5`,
    ['completed', raw.length, added, new Date().toISOString(), scrapeRunId]
  );
  console.log(`DONE. remote=${raw.length} | after-fit=${pool.length} | added=${added}`);
  console.log(`scrape_run_id=${scrapeRunId}`);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
/* Review skipped jobs for Andrew's (Liz's) profile and restore the ones that
 * actually qualify, using the SAME gates the live pipeline enforces:
 *   1. Remote     — location and/or description clearly remote, not on-site
 *   2. Role-fit   — matches Andrew's data-engineer resume (filterJobsByResume:
 *                   enterprise blocklist + title keyword + AI on borderline)
 *   3. Easy-apply — NOT a LinkedIn easy-apply posting
 *   4. Data-domain (DEFAULT) — restore only data/analytics/ML/ETL roles, since
 *      Andrew is a data engineer (set INCLUDE_ALL=1 to also restore backend).
 *
 * Workers skip quickly with no saved reason (notes are empty), so we cannot
 * distinguish "user rejected" from "skipped without checking". This script is
 * deliberately STRICT (defaults to DRY-RUN): only jobs passing ALL gates are
 * restored, so we don't reintroduce the junk that caused the queue mess.
 *
 *   npx tsx scripts/restore_skipped_verified.ts           # dry-run report
 *   DRY_RUN=0 npx tsx scripts/restore_skipped_verified.ts # actually restore
 *   INCLUDE_ALL=1 ...                                     # also restore backend
 */
import { query, all } from '../db/pool';
import { filterJobsByResume } from '../lib/aiJobMatch';
import type { ScrapeResultJob } from '../lib/types';

const PROFILE_ID = '022137cc-3978-4b4a-9e0a-54f3235f08d9'; // Andrew (Liz's client)
const DRY_RUN = process.env.DRY_RUN !== '0';

function looksRemote(location: string | null, description: string): boolean {
  const loc = (location || '').toLowerCase();
  const desc = (description || '').toLowerCase();
  // On-site / hybrid wins over any 'remote' mention.
  if (
    /on[- ]?site|hybrid|in[- ]office/.test(loc) ||
    /(not remote|\bno remote\b|remote work.*not|on[- ]site|hybrid|in[- ]office)/.test(desc)
  ) {
    return false;
  }
  if (/\bremote\b|work from home|\bwfh\b/.test(loc)) return true;
  if (/\bremote\b|work from home|\bwfh\b/.test(desc)) return true;
  return false;
}

function hasEasyApply(description: string): boolean {
  return /easy\s*apply/i.test(description || '');
}

async function main() {
  console.log(DRY_RUN ? 'DRY-RUN — will NOT modify DB' : 'LIVE — will restore qualifying jobs');
  console.log('loading skipped jobs for profile', PROFILE_ID);

  const rows = await all(
    `select id, title, company, board, url, location, description,
            (description is not null and description <> '') as has_desc
     from jobs
     where profile_id = $1 and status = 'skipped'
     order by created_at desc`,
    [PROFILE_ID]
  );
  console.log(`skipped jobs: ${rows.length}\n`);

  // ---- Stage 1: remote gate (local, cheap) ----
  const remoteRows = rows.filter((r) =>
    looksRemote(r.location ?? null, r.description ?? '')
  );
  console.log(`Stage 1 (remote gate): ${remoteRows.length} remote | ${rows.length - remoteRows.length} not-remote`);
  const noDescRemote = remoteRows.filter((r) => !r.has_desc).length;
  console.log(`  of remote: ${noDescRemote} have no description (location-only remote)\n`);

  // ---- Stage 2: role-fit gate (filterJobsByResume) ----
  const resume = await loadResume();
  const candidates: ScrapeResultJob[] = remoteRows.map((r) => ({
    title: r.title || 'Untitled',
    company: r.company || '',
    site: r.board || 'unknown',
    job_url: r.url || '',
    description: r.description || `Remote ${r.title}`,
    interval_amount: null,
    currency: 'USD',
    location: r.location || 'Remote',
    date_posted: null,
  }));

  let fit = candidates;
  if (resume) {
    fit = await filterJobsByResume(candidates, resume);
    console.log(`Stage 2 (role-fit): ${fit.length} pass of ${candidates.length}\n`);
  } else {
    console.log('NO RESUME on file — skipping role-fit (remote gate only)\n');
  }

  // ---- Stage 3: easy-apply exclusion ----
  const noEasy = fit.filter((j) => !hasEasyApply(j.description ?? ''));
  const easyExcluded = fit.length - noEasy.length;
  if (easyExcluded) console.log(`Stage 3 (easy-apply): excluded ${easyExcluded}\n`);

  // ---- Stage 4: data-domain gate (DEFAULT ON) ----
  // Andrew is a data engineer. By default restore only data/analytics/ML/ETL
  // roles — not generic backend — so the queue stays on his ICP. Set
  // INCLUDE_ALL=1 to restore every role-fit job (data + backend).
  const DATA_RE = /data|analytics|etl|pipeline|warehouse|databricks|spark|snowflake|bigquery|dbt|bi |\bml\b|machine learning|data eng|data sci|big data/i;
  const includeAll = process.env.INCLUDE_ALL === '1';
  let final = noEasy;
  if (!includeAll) {
    const before = final.length;
    final = final.filter((j) => DATA_RE.test(j.title || ''));
    console.log(`Stage 4 (data-only): kept ${final.length} of ${before} (excluded ${before - final.length} non-data roles)\n`);
  }

  // filterJobsByResume PRESERVES ORDER, so final[k] corresponds to the same
  // original row as when candidates was built from remoteRows. Map surviving
  // jobs back to DB ids by job_url (unique), fall back to title.
  const urlToId = new Map<string, string>();
  for (const r of remoteRows) {
    if (r.url) urlToId.set(r.url, r.id);
  }
  const restoredIds = new Set<string>();
  for (const j of final) {
    const id = j.job_url && urlToId.get(j.job_url);
    if (id) restoredIds.add(id);
  }
  for (const j of final) {
    if (j.job_url && urlToId.has(j.job_url)) continue;
    const orig = remoteRows.find((r) => r.title === j.title);
    if (orig) restoredIds.add(orig.id);
  }

  console.log(`\nTOTAL qualifying to restore: ${restoredIds.size}`);

  if (DRY_RUN) {
    const ids = Array.from(restoredIds).slice(0, 25);
    const sample = ids.length
      ? await query<{ title: string; company: string; board: string; location: string }>(
          `select title, company, board, location from jobs where id = ANY($1)`, [ids]
        )
      : { rows: [] as { title: string; company: string; board: string; location: string }[] };
    console.log('\nSample of jobs that will be restored:');
    sample.rows.forEach((r) =>
      console.log(`  - ${r.title} | ${r.company} | ${r.board} | ${r.location}`)
    );
    console.log('\nRun with DRY_RUN=0 to actually restore.');
    return;
  }

  const idArr = Array.from(restoredIds);
  if (idArr.length === 0) {
    console.log('Nothing to restore.');
    return;
  }
  let restored = 0;
  for (let i = 0; i < idArr.length; i += 100) {
    const batch = idArr.slice(i, i + 100);
    const ph = batch.map((_, k) => `$${k + 1}`).join(',');
    const res = await query(
      `update jobs set status = 'saved' where id in (${ph}) and profile_id = $${batch.length + 1} and status = 'skipped'`,
      [...batch, PROFILE_ID]
    );
    restored += res.rowCount ?? 0;
  }
  console.log(`\nRESTORED ${restored} jobs to the queue.`);
}

async function loadResume(): Promise<string | null> {
  const r = await query<{ base_resume_text: string | null }>(
    'select base_resume_text from profiles where id = $1', [PROFILE_ID]
  );
  const t = r.rows[0]?.base_resume_text ?? '';
  return t && t.trim().length > 0 ? t : null;
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
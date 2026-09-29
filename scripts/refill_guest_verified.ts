/*
 * Andrew LinkedIn GUEST-API refill — WITH per-job remote verification.
 *
 * The guest search API silently ignores f_WT=2 (returns on-site jobs), so this
 * driver remote-verifies EVERY candidate through the guest DETAIL API
 * (jobs-guest/jobs/api/jobPosting/<id> — returns 200 from this DC IP) before
 * insert. It stores the REAL location read from the detail page and NEVER
 * fabricates "United States (Remote)".
 *
 * Pipeline: guest search cards → detail-page verify (strict remote gate) →
 *   AI role-fit → dedupeAndMap → createJobs (verified_remote=true on pass).
 *
 * Usage: npx tsx scripts/refill_guest_verified.ts [maxJobs]
 *   env: PROFILE=<uuid> TERMS="a,b,c" MAX_PAGES=3 SLEEP=3.5
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { db } from '../db/repo';
import { dedupeAndMap } from '../lib/scrape';
import { filterJobsByResume } from '../lib/aiJobMatch';

const PROFILE_ID = process.env.PROFILE || '022137cc-3978-4b4a-9e0a-54f3235f08d9'; // Andrew
const MAX_JOBS = Number(process.argv[2] || 25);
const MAX_PAGES = Number(process.env.MAX_PAGES || 3);
const OUT = path.join(__dirname, '..', 'tmp', 'linkedin_guest_out.json');
const TERMS = process.env.TERMS || 'data engineer,senior data engineer,data pipeline engineer,analytics engineer,data warehouse engineer,ETL developer';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

function stripHtml(h: string): string {
  return h
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&amp;|&#39;|&quot;|&lt;|&gt;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchDetail(jobId: number): Promise<{ html: string | null; status: number }> {
  try {
    const res = await fetch(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${jobId}`, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(20000),
    });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 20000));
      const r2 = await fetch(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${jobId}`, {
        headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000),
      });
      return { html: r2.status < 400 ? await r2.text() : null, status: r2.status };
    }
    return { html: res.status < 400 ? await res.text() : null, status: res.status };
  } catch {
    return { html: null, status: 0 };
  }
}

interface Verified { title: string; company: string; url: string; location: string | null; description: string; }

// Strict remote gate. Returns 'remote' | 'skip:<reason>'.
// Scans the WHOLE description for on-site/hybrid signals — a narrow head-scan
// let "This role is onsite at our HQ (not a remote position)" leaks through
// when the line sits past the first 800 chars. When a posting carries BOTH a
// remote claim and a hybrid/onsite line, the conflict resolves to SKIP
// (strictness beats volume: the client rejects on-site leaks harshly).
function classify(location: string | null, desc: string, rawHtml: string): string {
  const loc = (location || '').toLowerCase();
  const low = desc.toLowerCase();
  if (/easy\s*apply/i.test(rawHtml)) return 'skip:easy-apply';
  const hardOnsiteLoc = /\bon[- ]?site\b|\bin[- ]?office\b|\bhybrid\b/.test(loc);
  if (hardOnsiteLoc) return 'skip:onsite/hybrid';
  const negated = (m: RegExpMatchArray) => {
    const before = low.slice(Math.max(0, (m.index ?? 0) - 40), m.index);
    return /not\s+(a\s+)?(fully\s+)?(on[- ]?site|hybrid|in[- ]?office)|no\s+(on[- ]?site|hybrid)/.test(before);
  };
  const negatedRemote = /not\s+a\s+remote\s+(position|role)|not\s+remote\b|is\s+not\s+remote/.test(low);
  if (negatedRemote) return 'skip:stated-not-remote';
  // ES5-safe scan: walk every on-site/hybrid/in-office mention; skip mentions
  // that are negated ("not on-site", "no hybrid"). Any real mention → skip.
  const onsiteRe = /\bon[- ]?site\b|\bin[- ]?office\b|\bhybrid\b/gi;
  let m: RegExpExecArray | null;
  while ((m = onsiteRe.exec(low)) !== null) {
    const before = low.slice(Math.max(0, m.index - 40), m.index);
    if (/not\s+(a\s+)?(fully\s+)?(on[- ]?site|hybrid|in[- ]?office)|no\s+(on[- ]?site|hybrid)/.test(before)) continue; // negated mention
    return 'skip:onsite/hybrid';
  }
  if (/remote/.test(loc)) {
    // Location says remote but the body may still carry an on-site/hybrid line
    // (already caught above). Safe to pass.
    return 'remote';
  }
  // City location: require STRONG explicit remote signal in the description.
  if (/\b(100%|fully|completely)\s+remote\b/i.test(desc)
    || /\bremote\b[^.\n]{0,40}\b(usa|u\.s\.|united states)\b/i.test(desc)
    || /\bwork (from )?home\b/i.test(desc)
    || /\bwfh\b/i.test(desc)) return 'remote';
  return 'skip:unverified';
}

async function main() {
  console.log(`[guest-verified] profile=${PROFILE_ID} maxJobs=${MAX_JOBS} terms="${TERMS}"`);
  execSync(
    `python3 scripts/refill_linkedin_guest.py ${PROFILE_ID} --terms "${TERMS}" --max-pages ${MAX_PAGES} --sleep 5`,
    { cwd: path.join(__dirname, '..'), stdio: 'inherit' }
  );
  const rows: { title: string; company: string; url: string; location: string }[] =
    JSON.parse(fs.readFileSync(OUT, 'utf8'));
  console.log(`stage 1 (guest cards): ${rows.length} unique\n`);

  // stage 2: per-job detail verify — real location + description + remote gate.
  const verified: Verified[] = [];
  const skipped: string[] = [];
  let fetchFail = 0;
  for (const r of rows) {
    if (verified.length >= MAX_JOBS + 15) break; // cap verification work; dedupe+fit still filter
    const m = r.url.match(/-(\d+)$/);
    if (!m) { skipped.push(`${r.title.slice(0, 28)} → skip:no-id`); continue; }
    const { html, status } = await fetchDetail(Number(m[1]));
    if (!html) { fetchFail++; skipped.push(`${r.title.slice(0, 28)} → skip:fetch(http${status})`); await new Promise((res) => setTimeout(res, 3500)); continue; }
    const locM = html.match(/topcard__flavor--bullet[^>]*>\s*([^<]+)</);
    const realLoc = locM ? locM[1].trim() : null;
    const descM = html.match(/show-more-less-html__markup[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    const desc = descM ? stripHtml(descM[1]) : '';
    const verdict = classify(realLoc, desc, html);
    if (verdict === 'remote') verified.push({ title: r.title, company: r.company, url: r.url, location: realLoc, description: desc });
    else skipped.push(`${r.title.slice(0, 28)} → ${verdict}${realLoc ? ` [${realLoc}]` : ''}`);
    await new Promise((res) => setTimeout(res, 3500));
  }
  console.log(`stage 2 (detail-verified remote): ${verified.length} pass | fetch-fail ${fetchFail}`);
  skipped.slice(0, 12).forEach((s) => console.log(`  - ${s}`));
  if (skipped.length > 12) console.log(`  ... and ${skipped.length - 12} more`);
  console.log('');

  // stage 3: AI role-fit.
  const perf = await db.getProfile(PROFILE_ID);
  const resumeText = perf?.base_resume_text ?? null;
  let fit: typeof verified = verified;
  if (resumeText && resumeText.trim().length > 0) {
    const mappedFit = await filterJobsByResume(
      verified.map((v) => ({ title: v.title, company: v.company, job_url: v.url, site: 'linkedin', location: v.location || 'United States', description: v.description, interval_amount: null, currency: 'USD' })) as any,
      resumeText
    );
    fit = mappedFit as any;
    console.log(`stage 3 (role-fit): ${fit.length} pass\n`);
  }

  // stage 4: dedupe + insert verified-remote.
  const { query } = await import('../db/pool');
  const runRow = await query<{ id: string }>(
    `insert into scrape_runs (triggered_by, profile_ids, sites, search_terms, location,
       results_wanted, hours_old, status, jobs_found, jobs_added, error_message, started_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
    [null, [PROFILE_ID], ['linkedin-guest-verified'], TERMS.split(','), 'verified per-job', rows.length, 168, 'running', rows.length, 0, null, new Date().toISOString()]
  );
  const runId = runRow.rows[0].id;

  const { fresh } = await dedupeAndMap(fit as any, PROFILE_ID, runId);
  console.log(`stage 4 (dedupe): ${fresh.length} new verified-remote`);

  let added = 0;
  if (fresh.length > 0) {
    // fresh rows already carry the real location/description via dedupeAndMap;
    // stamp verification flags and backstop the location lookup from `verified`.
    const toInsert = (fresh as any[]).map((f: any) => ({
      ...f,
      verified_remote: true,
      easy_apply: false,
      location: f.location || (verified.find((v) => v.url === f.url) || ({} as any)).location || null,
    }));
    const created = await db.createJobs(toInsert as any);
    added = created.length;
  }
  await query(
    `update scrape_runs set status=$1, jobs_added=$2, completed_at=$3 where id=$4`,
    ['completed', added, new Date().toISOString(), runId]
  );
  console.log(`DONE. cards=${rows.length} verified=${verified.length} fit=${fit.length} fresh=${fresh.length} added=${added}`);
  console.log(`scrape_run_id=${runId}`);
}

export { classify };

if (process.env.NO_MAIN !== '1') main().catch((e) => { console.error('FATAL:', e); process.exit(1); });

/* STRICT CANADA-REMOTE refill for one profile.
 *
 * Sources (all keyless):
 *   - Greenhouse board API  — literal locations like "Canada - Remote (ON, AB, ...)"
 *   - Ashby posting API     — `secondaryLocations` entries like "Remote (Canada)"
 *   - Jobicy API            — jobGeo containing "Canada"
 *
 * Gates, in order: canada + remote in the location string -> engineering title ->
 * company blocklist (app rule, lib/aiJobMatch) -> resume role-fit -> URL dedupe ->
 * insert as 'saved' with verified_remote=true.
 *
 *   PROFILE=<uuid> MAX=50 npx tsx scripts/refill_canada_remote.ts
 */
import { db } from '../db/repo';
import { dedupeAndMap } from '../lib/scrape';
import { filterJobsByResume } from '../lib/aiJobMatch';
import { query } from '../db/pool';
import type { ScrapeResultJob } from '../lib/types';

const PROFILE_ID = process.env.PROFILE || '';
const MAX_JOBS = Number(process.env.MAX || '50');
const UA = 'Mozilla/5.0';

const GREENHOUSE_ORGS = [
  'toast', 'mercury', '1password', 'clio', 'hootsuite', 'dialpad', 'opentext',
  'dbtlabs', 'confluent', 'postman', 'webflow', 'hashicorp', 'amplitude',
  'segment', 'mixpanel', 'okta', 'grafana', 'snyk', 'hasura', 'netlify',
  'sentry', 'twitch', 'databricks', 'flexport', 'rippling', 'gusto', 'loom',
  'intercom', 'zendesk', 'ada', 'benchling', 'tempus', 'flatiron', 'komodo',
  'spring', 'health', 'omada', 'outschool', 'classpass', 'mindbody', 'density',
  'asapp', 'glean', 'athenahealth', 'cedar', 'betterup', 'compass', 'deel',
  'vanta', 'cursor', 'clerk', 'airbyte', 'fivetran', 'prefect', 'dagster',
  'astronomer', 'starburst', 'clickhouse', 'materialize', 'cockroach',
  'supabase', 'metabase', 'lightdash', 'hex', 'sigma', 'mode', 'thoughtspot',
  'alteryx', 'datarobot', 'h2o', 'rivian', 'nuro', 'cruise', 'aurora',
  'motional', 'zoox', 'perplexity', 'runway', 'elevenlabs', 'stability',
  'mistral', 'together', 'fireworks', 'groq', 'sambanova', 'lambda',
  'coreweave', 'modal', 'replit', 'codesandbox', 'gitpod', 'sourcegraph',
  'checkout', 'plaid', 'chime', 'betterment', 'wealthsimple', 'cerebras',
  'scaleai', 'cohere', 'huggingface', 'wandb', 'arize', 'parafin', 'mosaic',
  'lattice', 'getsquire',
];

const ASHBY_ORGS = [
  'ramp', 'vanta', 'linear', 'cursor', 'clerk', 'scaleai', 'cohere',
  'huggingface', 'retool', 'replit', 'benchling', 'tempus', 'komodo', 'spring',
  'omada', 'outschool', 'classpass', 'mindbody', 'gusto', 'rippling',
  'airbyte', 'fivetran', 'hightouch', 'census', 'monte_carlo', 'sigma',
  'hex', 'amplify', 'asapp', 'gitpod', 'sourcegraph', 'buildkite',
  'circleci', 'snyk', 'tailscale', 'doppler', 'ngrok', 'posthog', 'amplitude',
  'statsig', 'launchdarkly', 'clickup', 'miro', 'glean', 'athenahealth',
  'cedar', 'betterup', 'compass', 'density', 'mosaic', 'parafin', 'arc',
  'getsquire', 'lattice',
];

const ENG_RE = /engineer|developer|software|full.?stack|backend|front.?end|devops|sre|platform|architect|programmer/i;
const BAD_RE = /\b(director|vp|head of|chief|sales|account|recruiter|talent|support|manager|designer|specialist|coordinator|intern|graduate)\b/i;
const CA_RE = /\b(canada|ontario|british columbia|alberta|quebec|nova scotia|toronto|vancouver|montreal|ottawa|calgary)\b/i;

function titleOk(t: string): boolean {
  return ENG_RE.test(t) && !BAD_RE.test(t);
}

async function fetchGreenhouse(org: string): Promise<ScrapeResultJob[]> {
  const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${org}/jobs?content=false`, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) return [];
  const js = (await res.json()) as {
    jobs?: { title?: string; absolute_url?: string; location?: { name?: string } }[];
  };
  const out: ScrapeResultJob[] = [];
  for (const j of js.jobs ?? []) {
    const loc = j.location?.name ?? '';
    if (!CA_RE.test(loc) || !/remote/i.test(loc)) continue;
    const title = j.title ?? '';
    if (!titleOk(title)) continue;
    const url = j.absolute_url ?? '';
    if (!url) continue;
    out.push({
      title,
      company: org,
      site: 'greenhouse',
      job_url: url,
      description: '',
      interval_amount: null,
      currency: 'CAD',
      location: loc,
      date_posted: null,
    });
  }
  return out;
}

async function fetchAshby(org: string): Promise<ScrapeResultJob[]> {
  const res = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${org}`, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) return [];
  const js = (await res.json()) as {
    jobs?: {
      title?: string;
      jobUrl?: string;
      location?: string;
      secondaryLocations?: { location?: string }[];
      descriptionPlain?: string;
    }[];
  };
  const out: ScrapeResultJob[] = [];
  for (const j of js.jobs ?? []) {
    const locs = [j.location ?? '', ...(j.secondaryLocations ?? []).map((s) => s.location ?? '')];
    const caRemote = locs.find((l) => CA_RE.test(l) && /remote/i.test(l));
    if (!caRemote) continue;
    const title = j.title ?? '';
    if (!titleOk(title)) continue;
    const url = j.jobUrl ?? '';
    if (!url) continue;
    out.push({
      title,
      company: org,
      site: 'ashby',
      job_url: url,
      description: (j.descriptionPlain ?? '').slice(0, 4000),
      interval_amount: null,
      currency: 'CAD',
      location: caRemote,
      date_posted: null,
    });
  }
  return out;
}

async function fetchJobicy(): Promise<ScrapeResultJob[]> {
  const out: ScrapeResultJob[] = [];
  for (const geo of ['canada', 'usa', 'emea', 'apac']) {
    try {
      const res = await fetch(`https://jobicy.com/api/v2/remote-jobs?count=50&geo=${geo}&industry=engineering`, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) continue;
      const js = (await res.json()) as {
        jobs?: { companyName?: string; jobTitle?: string; url?: string; jobGeo?: string; jobDescription?: string }[];
      };
      for (const j of js.jobs ?? []) {
        const geoStr = j.jobGeo ?? '';
        if (!CA_RE.test(geoStr)) continue;
        const title = j.jobTitle ?? '';
        if (!titleOk(title)) continue;
        const url = j.url ?? '';
        if (!url) continue;
        out.push({
          title,
          company: j.companyName ?? '',
          site: 'jobicy',
          job_url: url,
          description: (j.jobDescription ?? '').replace(/<[^>]+>/g, ' ').slice(0, 4000),
          interval_amount: null,
          currency: 'CAD',
          location: geoStr,
          date_posted: null,
        });
      }
    } catch {
      /* source down: skip */
    }
  }
  return out;
}

async function main() {
  if (!PROFILE_ID) throw new Error('PROFILE env var required');
  const prof = await query<{ name: string; base_resume_text: string | null }>(
    'select name, base_resume_text from profiles where id=$1',
    [PROFILE_ID]
  );
  if (!prof.rowCount) throw new Error(`No profile ${PROFILE_ID}`);
  const name = prof.rows[0].name;
  const resume = prof.rows[0].base_resume_text;

  console.log(`Canada-remote refill for ${name} (${PROFILE_ID})`);
  console.log(`  max=${MAX_JOBS} | resume chars=${resume?.length ?? 0}\n`);

  const [greenhouse, ashby, jobicy] = await Promise.all([
    Promise.all(GREENHOUSE_ORGS.map((o) => fetchGreenhouse(o).catch(() => []))),
    Promise.all(ASHBY_ORGS.map((o) => fetchAshby(o).catch(() => []))),
    fetchJobicy().catch(() => []),
  ]);

  const seen = new Set<string>();
  const candidates: ScrapeResultJob[] = [];
  for (const j of [...greenhouse.flat(), ...ashby.flat(), ...jobicy]) {
    if (!j.job_url || seen.has(j.job_url)) continue;
    seen.add(j.job_url);
    candidates.push(j);
  }
  console.log(`canada-remote engineering candidates: ${candidates.length}`);

  let pool = candidates;
  if (resume && resume.trim()) {
    try {
      // filterJobsByResume drops blocklisted companies and off-role titles.
      pool = await filterJobsByResume(candidates, resume);
      console.log(`after blocklist + role-fit: ${pool.length} (dropped ${candidates.length - pool.length})`);
    } catch (e) {
      console.log(`[warn] role-fit failed (${(e as Error).message.slice(0, 90)})`);
    }
  }
  pool = pool.slice(0, MAX_JOBS);

  const runRow = await query<{ id: string }>(
    `insert into scrape_runs (triggered_by, profile_ids, sites, search_terms, location,
       results_wanted, hours_old, status, jobs_found, jobs_added, error_message, started_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
    [null, [PROFILE_ID], ['greenhouse', 'ashby', 'jobicy'], [], 'Canada Remote', MAX_JOBS, 720, 'running', candidates.length, 0, null, new Date().toISOString()]
  );
  const runId = runRow.rows[0].id;

  const { fresh, skippedDuplicates } = await dedupeAndMap(pool, PROFILE_ID, runId);
  for (const j of fresh) {
    j.verified_remote = true;
    j.easy_apply = false;
  }

  let added = 0;
  if (fresh.length) added = (await db.createJobs(fresh as never)).length;

  await query(
    `update scrape_runs set status=$1, jobs_found=$2, jobs_added=$3, completed_at=$4 where id=$5`,
    ['completed', candidates.length, added, new Date().toISOString(), runId]
  );

  console.log(`\nDONE. candidates=${candidates.length} | after-fit=${pool.length} | dup=${skippedDuplicates} | added=${added}`);
  console.log(`scrape_run_id=${runId}`);
  for (const j of fresh) console.log(`  + [${j.board}] ${j.company} | ${j.title} | ${j.location}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FATAL:', e);
    process.exit(1);
  });

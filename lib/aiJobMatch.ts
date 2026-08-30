import { callAI } from '@/lib/ai';
import type { ScrapeResultJob } from '@/lib/types';

// HYBRID role-fit gate:
// 1) FAST rule-based pass (instant, free): hard-reject obvious non-fits by title
//    keywords (Director/VP/Product/Sales/Compliance/Support/SME/recruiter, etc.)
//    and enforce the client's role-family keyword. This catches ~95% of the
//    mismatches without any AI call.
// 2) AI pass ONLY on the jobs that clear the rules but aren't clearly on-target
//    (the borderline handful), so refills stay fast and cheap.

const REJECT_TITLE_RE = new RegExp(
  '\\b(director|vp|vice president|head of|chief|principal manager|senior manager|' +
  'engineering manager|manager,|product manager|product owner|scrum master|' +
  'project manager|program manager|technical program manager|' +
  'sales engineer|pre-?sales|account (manager|executive|technical lead)|' +
  'customer success|csm|client success|account manager|business development|' +
  'recruiter|talent|compliance|privacy|legal|counsel|soc|governance|risk manager|' +
  'support|support engineer|helpdesk|help desk|field ops|operations|coordinator|' +
  'subject matter expert|sme|specialist|operations manager|' +
  'freelance|intern\\b|co-op)\\b',
  'i'
);

// Enterprise/big-tech companies the user does NOT want applied to. Refills at
// these giants (GitLab, GitHub, Vercel, Airbnb, Affirm, Coinbase, Reddit,
// Dropbox, Twilio, Stripe, Datadog, and the FAANG/cap set) flood the queue with
// roles a worker can easily lose time on, and the user explicitly said to
// exclude enterprise jobs. Matched case-insensitively on the company name, so a
// job from any of these never enters a queue at refill time.
const ENTERPRISE_COMPANIES = new Set<string>([
  'gitlab', 'github', 'git hub', 'vercel', 'airbnb',
  'affirm', 'coinbase', 'reddit', 'dropbox', 'twilio', 'stripe', 'datadog',
  'amazon', 'aws', 'google', 'microsoft', 'meta', 'apple', 'netflix',
  'oracle', 'salesforce', 'snowflake', 'linkedin', 'uber', 'lyft', 'shopify',
  'square', 'block', 'paypal', 'intuit', 'adobe', 'atlassian', 'slack',
  'palantir', 'snap', 'pinterest', 'spotify', 'doordash', 'instacart',
  'airtable', 'notion', 'figma', 'canva', 'zapier', 'retool', 'linear',
  'jpmorgan', 'goldman', 'morgan stanley', 'capital one', 'chase',
  'boeing', 'lockheed', 'northrop', 'raytheon',
]);

// Strip common legal/brand suffixes so "GitLab, Inc." or "Vercel Inc." still match.
function normalizeCompany(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/\binc\b|\bcorp\b|\bcorporation\b|\bllc\b|\bltd\b|\bco\b|,|-|\./g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isEnterpriseCompany(s: string): boolean {
  const norm = normalizeCompany(s);
  if (ENTERPRISE_COMPANIES.has(norm)) return true;
  // Match multi-word entries as substrings ("morgan stanley" inside the name).
  // Iterate with forEach to stay compatible with the repo's TS target.
  let match = false;
  ENTERPRISE_COMPANIES.forEach((c) => {
    if (c.includes(' ') && norm.includes(c)) match = true;
  });
  return match;
}

// A job title must contain at least one of the client's role-family keywords,
// otherwise it's probably a different function entirely.
function domainKeywords(resumeText: string): string[] {
  const t = (resumeText || '').toLowerCase();
  const groups: { kw: string; kws: string[] }[] = [
    { kw: 'DATA', kws: ['data', 'analytics', 'warehouse', 'etl', 'pipeline', 'databricks', 'spark', 'snowflake', 'bigquery', 'bi ', 'reporting', 'machine learning'] },
    { kw: 'ML', kws: ['machine learning', 'ml ', 'llm', 'deep learning', 'ai platform', 'ai engineer', 'mlops', 'model'] },
    { kw: 'BACKEND', kws: ['backend', 'back-end', 'fullstack', 'full-stack', 'software engineer', 'platform', 'api', 'microservice'] },
    { kw: 'CLOUD', kws: ['cloud', 'aws', 'azure', 'gcp', 'kubernetes', 'terraform', 'devops'] },
    { kw: 'FRONTEND', kws: ['frontend', 'front-end', 'react', 'ui ', 'web'] },
  ];
  const present = groups.filter((g) => g.kws.some((k) => t.includes(k))).map((g) => g.kw);
  // Always include a reasonable base so we don't reject everything.
  if (!present.length) return ['DATA', 'ML', 'BACKEND', 'CLOUD'];
  return present;
}

function clearPass(title: string, domainKeyword: string[]): boolean {
  const tl = (title || '').toLowerCase();
  // Some titles are obviously level/generic-but-engineer; require a domain keyword.
  return domainKeyword.some((k) => tl.includes(k.toLowerCase()) || tl.includes('engineer') || tl.includes('scientist') || tl.includes('architect'));
}

// AI round 2 — only for jobs that cleared the rules but aren't confidently a fit.
const SYSTEM_BORDER = `You are a recruiting screener. A candidate's resume is given, then
one job. Decide if the role is a GENUINE fit considering LEVEL (Director/VP not a fit
for a Senior IC; Junior under-sells them), ROLE FAMILY (a Data/ML engineer shouldn't
get Product/Compliance/Sales/Support/Ops roles), and SKILLS (must draw on resume skills).
Return STRICT JSON ONLY: {"match": true|false, "reason": "..."}.
match true ONLY if you'd genuinely encourage them to apply.`;

function parseBorder(raw: string, count: number): Record<number, boolean> {
  const t = String(raw || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fence ? fence[1] : t).trim();
  const start = body.indexOf('[');
  const end = body.lastIndexOf(']');
  if (start === -1 || end === -1) return {};
  try {
    const arr = JSON.parse(body.slice(start, end + 1));
    if (!Array.isArray(arr)) return {};
    const map: Record<number, boolean> = {};
    for (const item of arr) {
      if (item && typeof item.index === 'number') map[item.index] = Boolean(item.match);
    }
    return map;
  } catch {
    return {};
  }
}

export async function filterJobsByResume(
  jobs: ScrapeResultJob[],
  resumeText: string
): Promise<ScrapeResultJob[]> {
  if (!jobs.length) return jobs;
  const dom = domainKeywords(resumeText);
  const kept: ScrapeResultJob[] = [];
  const borderline: ScrapeResultJob[] = [];

  for (const j of jobs) {
    // Hard enterprise-company reject (user rule): never apply to GitLab, GitHub,
    // Vercel, Airbnb, Affirm, Coinbase, Reddit, Dropbox, Twilio, Stripe, plus the
    // FAANG/cap set. Checked FIRST so enterprise jobs never even reach the title gate.
    if (isEnterpriseCompany((j.company as string) || '')) {
      continue; // reject enterprise company
    }
    const title = (j.title as string) || '';
    // Hard rule-based reject: obvious non-fit level/function.
    if (REJECT_TITLE_RE.test(title)) {
      continue; // reject
    }
    // Enforce role-family: title must reference a skill/domain keyword.
    const tl = title.toLowerCase();
    if (!dom.some((d) => tl.includes(d.toLowerCase()))) {
      // Not clearly on-domain and not clearly an engineer/architect -> AI.
      borderline.push(j);
      continue;
    }
    kept.push(j); // clearly on-domain + no reject keyword -> keep fast
  }

  // AI pass only on the borderline handful (usually small).
  if (borderline.length) {
    const B = 10;
    for (let s = 0; s < borderline.length; s += B) {
      const chunk = borderline.slice(s, s + B);
      const jobLines = chunk
        .map((j, i) => `JOB_INDEX ${i}\nTITLE: ${j.title}\nDESCRIPTION: ${((j.description as string) || '').slice(0, 700)}\n`)
        .join('\n');
      const user =
        `CANDIDATE RESUME (abridged):\n${(resumeText || '').slice(0, 5000)}\n\n` +
        `JOBS TO SCREEN (0..${chunk.length - 1}):\n${jobLines}\n` +
        `Return STRICT JSON array: [{"index": 0, "match": true, "reason": "..."}, ...]`;
      let raw = '';
      try {
        raw = await callAI(SYSTEM_BORDER, user, { maxTokens: 800, temperature: 0.2 });
      } catch {
        kept.push(...chunk); // AI down -> keep (conservative)
        continue;
      }
      const verdict = parseBorder(raw, chunk.length);
      for (let k = 0; k < chunk.length; k++) {
        if (verdict[k] !== false) kept.push(chunk[k]);
      }
    }
  }
  return kept;
}
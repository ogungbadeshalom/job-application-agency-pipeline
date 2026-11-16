// Job River adapter — feeds the ApplyOS Job River (freehire + jobseek, $0,
// keyless) into Pitchr's refill pipeline as an EXTRA source, so queues never
// run dry. River output flows through the SAME gates as JobSpy:
//   filterByAllowedRoles -> filterJobsByResume -> dedupeAndMap -> createJobs
// -> autoTailor. One source dying never kills a pass (the river is per-source
// resilient, and we wrap each term in try/catch).
import type { ScrapeResultJob } from '@/lib/types';

// Runtime path var (NOT a webpack-visible literal) so Next leaves the import
// to Node at runtime. The river is a standalone ESM repo on the box.
const RIVER_PIPELINE = '/root/applyos-job-river/src/pipeline.mjs';

export const RIVER_RIVER_SITE_NAMES = ['freehire', 'jobseek'] as const;

type RiverJob = {
  job_url: string;
  site?: string;
  board?: string;
  title?: string;
  company?: string;
  location?: string;
  description?: string;
  posted_at?: string;
};

function mapRiverJob(j: RiverJob): ScrapeResultJob {
  // `site` = board so dedupeAndMap stores it as jobs.board and the apply
  // driver can dispatch on it (greenhouse / lever / ashby / workable...).
  // If the board is unknown, fall back to the river site name.
  const board = j.board || j.site || 'freehire';
  return {
    title: j.title || 'Untitled role',
    company: j.company || '',
    site: board,
    job_url: j.job_url || '',
    description: j.description || '',
    interval_amount: null,
    currency: 'USD',
    location: j.location || '',
    date_posted: j.posted_at || null,
  };
}

/**
 * Pull fresh jobs from the Job River for the given search terms.
 * `perTermLimit` caps each term; `maxTotal` bounds the whole call.
 * Never throws: any source/term failure just yields fewer jobs.
 */
export async function riverJobs(
  searchTerms: string[],
  opts: { perTermLimit?: number; maxTotal?: number } = {}
): Promise<ScrapeResultJob[]> {
  const perTermLimit = Math.min(opts.perTermLimit ?? 30, 60);
  const maxTotal = opts.maxTotal ?? 120;
  const terms = Array.from(new Set((searchTerms || []).filter(Boolean))).slice(0, 12);
  if (!terms.length) return [];

  let runRiver: ((a: unknown) => Promise<{ top: RiverJob[] }>) | null = null;
  try {
    const { runRiver: fn } = await import(RIVER_PIPELINE);
    runRiver = fn as typeof runRiver;
  } catch (e) {
    console.warn('[job-river] river module unavailable:', e instanceof Error ? e.message : e);
    return [];
  }

  const seen = new Set<string>();
  const out: ScrapeResultJob[] = [];
  for (const term of terms) {
    if (out.length >= maxTotal) break;
    try {
      const { top } = await runRiver!({ term, limit: perTermLimit, roleFit: true, profile: null });
      for (const j of top || []) {
        const url = (j.job_url || '').trim();
        if (!url || seen.has(url)) continue;
        seen.add(url);
        out.push(mapRiverJob(j));
        if (out.length >= maxTotal) break;
      }
    } catch (e) {
      console.warn(`[job-river] term "${term}" failed:`, e instanceof Error ? e.message : e);
    }
  }
  return out;
}
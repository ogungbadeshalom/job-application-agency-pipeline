// Shared JobSpy scrape helpers, used by both the admin /api/scrape route and the
// worker self-refill /api/worker-refill route. Extracted verbatim from the
// original route so behavior is identical.

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { db } from '@/lib/db';
import type { Job, ScrapeResultJob } from '@/lib/types';

export interface JobSpyArgs {
  sites: string[];
  search_terms: string[];
  location: string;
  results_wanted: number;
  hours_old: number;
  is_remote?: boolean;
  job_type?: string;
  include_kw?: string[];
  exclude_kw?: string[];
  remove_easy_apply?: boolean;
}

// Map JobSpy rows to our Job shape and dedupe by URL against the profile.
export async function dedupeAndMap(
  raw: ScrapeResultJob[],
  profileId: string,
  scrapeRunId: string
): Promise<Job[]> {
  const mask = await db.dedupeJobsByURL(
    profileId,
    raw.map((r) => ({ url: r.job_url }))
  );
  const fresh = raw.filter((_, i) => mask[i]);
  const seenThisBatch = new Set<string>();
  const deduped = fresh.filter((r) => {
    const u = String(r.job_url ?? '').trim();
    const key = u || `__noUrl__${String(r.site || '')}__${String(r.title || '')}`;
    if (seenThisBatch.has(key)) return false;
    seenThisBatch.add(key);
    return true;
  });
  const now = new Date().toISOString();
  return deduped.map((r) => ({
    id: '',
    profile_id: profileId,
    title: r.title || 'Untitled',
    company: r.company || '',
    board: r.site || 'unknown',
    url: r.job_url || '',
    description: r.description || '',
    compensation_min: r.interval_amount ?? null,
    compensation_max: r.interval_amount ?? null,
    compensation_currency: r.currency || 'USD',
    location: r.location || null,
    status: 'saved' as const,
    tailored_resume: null,
    tailored_resume_pdf_url: null,
    submitted_at: null,
    proof_of_submission: null,
    notes: null,
    scrape_run_id: scrapeRunId,
    created_at: now,
    updated_at: now,
    last_viewed_at: null,
  }));
}

export interface ScrapeRunProgress {
  totalSteps: number;
  step: number;              // 0-based, incremented as each (site, term) completes
  current: string;           // human-readable current step, e.g. "BuiltIn — data engineer"
  jobsFound: number;         // cumulative jobs found so far
  done: boolean;
}

// In-memory live scraper progress, keyed by scrape_run_id. Populated by
// runJobSpy's onProgress callback as the subprocess streams each (site, term)
// completion on stderr, and read by the UI's poll endpoint. Kept in-memory (not
// DB) so polling is cheap and there's no schema change; it lives only for the
// lifetime of the run.
export const scrapeProgress: Record<string, ScrapeRunProgress> = {};

// Track the in-flight scrape run per worker so the queue UI can discover which
// run_id to poll for live progress without waiting for the POST to resolve.
export const latestRunByWorker: Record<string, { runId: string; profileId: string }> = {};

// Spawn the Python JobSpy script and parse its JSON output. When `onProgress`
// is provided, the subprocess's stderr is streamed live — each "[ok] site: N
// jobs for 'term'" line emits an incremental progress update, so the UI can show
// real progress instead of a blanket time estimate.
export async function runJobSpy(
  args: JobSpyArgs,
  onProgress?: (p: ScrapeRunProgress) => void
): Promise<ScrapeResultJob[]> {
  const scriptPath = path.join(process.cwd(), 'scripts', 'run_jobspy.py');
  const tmpFile = path.join(os.tmpdir(), `scrape_${Date.now()}.json`);
  const configJson = JSON.stringify(args);
  const pyBin = process.platform === 'win32' ? 'python' : 'python3';

  // Total steps to scrape = sites x distinct terms (mirrors the script's loop:
  // `for term in search_terms: for site in sites:`). Used to compute progress.
  const sites = args.sites ?? [];
  const totalSteps = Math.max(sites.length * (args.search_terms ?? []).length, 1);

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(pyBin, [scriptPath, configJson, tmpFile], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stderr = '';
      let step = 0;
      let jobsFound = 0;
      const onLine = (line: string) => {
        // Emit live progress from "[ok] <site>: <N> jobs for '<term>'" lines.
        const m = line.match(/\[ok\]\s+(.+?):\s+(\d+)\s+jobs?\s+for\s+'([^']+)'/);
        if (m) {
          const site = m[1];
          const n = Number(m[2]) || 0;
          const term = m[3];
          jobsFound += n;
          step += 1; // each completed (site, term) advances the progress step
          const p: ScrapeRunProgress = {
            totalSteps,
            step,
            current: `${site} — ${term}`,
            jobsFound,
            done: false,
          };
          if (onProgress) {
            try {
              onProgress(p);
            } catch { /* ignore subscriber errors */ }
          }
        }
      };
      child.stderr.on('data', (d) => {
        const s = d.toString();
        stderr += s;
        // stderr lines may arrive in chunks; split on newlines and process whole lines.
        const lines = s.split('\n');
        for (const ln of lines) {
          const t = ln.trim();
          if (t && (t.includes('[ok]') || t.includes('[warn]'))) onLine(t);
        }
      });
      let settled = false;
      let timer: NodeJS.Timeout | null = null;
      const finish = (err: Error | null) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (err) reject(err);
        else resolve();
      };
      child.on('error', (e) => finish(e));
      timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish(new Error(`JobSpy timed out after 300s. ${stderr.slice(0, 300)}`.trim()));
      }, 300_000);
      child.on('close', (code, signal) => {
        if (code === 0) {
          if (onProgress) {
            try {
              onProgress({ totalSteps, step: totalSteps, current: 'Finalizing', jobsFound, done: true });
            } catch { /* ignore */ }
          }
          finish(null);
        } else if (signal) {
          if (!settled) finish(new Error(`JobSpy killed by signal ${signal}.`));
        } else {
          finish(
            new Error(`JobSpy exited ${code}. ${stderr.slice(0, 1000) || 'No stderr.'}`.trim())
          );
        }
      });
    });

    const text = await fs.readFile(tmpFile, 'utf-8');
    const safeText = text
      .replace(/-Infinity/g, 'null')
      .replace(/\bNaN\b/g, 'null')
      .replace(/\bInfinity\b/g, 'null');
    const parsed = JSON.parse(safeText);
    if (!Array.isArray(parsed)) return [];
    return parsed as ScrapeResultJob[];
  } finally {
    await fs.rm(tmpFile, { force: true });
  }
}
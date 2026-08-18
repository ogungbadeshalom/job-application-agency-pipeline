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

// Spawn the Python JobSpy script and parse its JSON output.
export async function runJobSpy(args: JobSpyArgs): Promise<ScrapeResultJob[]> {
  const scriptPath = path.join(process.cwd(), 'scripts', 'run_jobspy.py');
  const tmpFile = path.join(os.tmpdir(), `scrape_${Date.now()}.json`);
  const configJson = JSON.stringify(args);
  const pyBin = process.platform === 'win32' ? 'python' : 'python3';

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(pyBin, [scriptPath, configJson, tmpFile], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stderr = '';
      child.stderr.on('data', (d) => (stderr += d.toString()));
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
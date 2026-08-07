import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import type { Job, ScrapeConfig, ScrapeResultJob } from '@/lib/types';

// POST /api/scrape
// Admin-only. Runs JobSpy (Python subprocess), dedupes by URL, inserts jobs.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Partial<ScrapeConfig>;
  const config: ScrapeConfig = {
    profile_ids: body.profile_ids ?? [],
    sites: body.sites ?? ['indeed'],
    search_terms: body.search_terms ?? [],
    location: body.location ?? 'United States',
    results_wanted: Number(body.results_wanted) || 100,
    hours_old: Number(body.hours_old) || 72,
    remote_only: Boolean(body.remote_only),
    job_type: body.job_type || '',
    include_kw: body.include_kw || [],
    exclude_kw: body.exclude_kw || [],
    remove_easy_apply: Boolean(body.remove_easy_apply),
  };

  if (config.profile_ids.length === 0) {
    return NextResponse.json({ error: 'Select at least one profile.' }, { status: 400 });
  }

  const profiles = await db.listProfiles();
  const targetProfiles = profiles.filter((p) => config.profile_ids.includes(p.id));
  if (targetProfiles.length === 0) {
    return NextResponse.json({ error: 'No matching profiles.' }, { status: 400 });
  }

  // For each profile: resolve search terms (fall back to profile defaults).
  const run = await db.createScrapeRun({
    triggered_by: session.user.id,
    profile_ids: config.profile_ids,
    sites: config.sites,
    search_terms: config.search_terms,
    location: config.location,
    results_wanted: config.results_wanted,
    hours_old: config.hours_old,
    status: 'running',
    started_at: new Date().toISOString(),
  });

  // Aggregate all terms across profiles.
  const allTerms = new Set<string>();
  for (const p of targetProfiles) {
    (config.search_terms.length ? config.search_terms : p.scrape_search_terms).forEach((t) =>
      allTerms.add(t)
    );
  }
  const terms = Array.from(allTerms).filter(Boolean);
  if (terms.length === 0) {
    await db.updateScrapeRun(run.id, {
      status: 'failed',
      error_message: 'No search terms provided.',
      completed_at: new Date().toISOString(),
    });
    return NextResponse.json({ error: 'No search terms provided.' }, { status: 400 });
  }

  try {
    // Glassdoor + ZipRecruiter can't parse a bare "Remote" location (JobSpy
    // returns 400 "location not parsed"). RemoteOK/BuiltIn/Indeed/LinkedIn are
    // remote-friendly, so give them the configured location ("Remote" when the
    // Remote-only toggle is on). The geo pair gets a real fallback location.
    const remoteFriendly = config.sites.filter(
      (s) => !['glassdoor', 'zip_recruiter'].includes(s)
    );
    const geoRequired = config.sites.filter((s) => ['glassdoor', 'zip_recruiter'].includes(s));
    const geoLocation = config.location === 'Remote' ? 'United States' : config.location;

    // Group sites by their preferred location so JobSpy gets a valid arg each call.
    const groups: { sites: string[]; location: string; is_remote?: boolean }[] = [];
    if (remoteFriendly.length) groups.push({ sites: remoteFriendly, location: config.location });
    if (geoRequired.length) groups.push({ sites: geoRequired, location: geoLocation });
    // When the Remote-only toggle is on, force JobSpy's is_remote=true so ALL
    // sites (incl. the geo pair) return genuinely remote postings, not jobs
    // near a city/region matching the "Remote" location string.
    if (config.remote_only) {
      for (const g of groups) g.is_remote = true;
    }

    const allRaw: ScrapeResultJob[] = [];
    for (const g of groups) {
      const raw = await runJobSpy({
        sites: g.sites,
        search_terms: terms,
        location: g.location,
        results_wanted: config.results_wanted,
        hours_old: config.hours_old,
        is_remote: g.is_remote,
        job_type: config.job_type || undefined,
        include_kw: config.include_kw?.length ? config.include_kw : undefined,
        exclude_kw: config.exclude_kw?.length ? config.exclude_kw : undefined,
        remove_easy_apply: config.remove_easy_apply,
      });
      allRaw.push(...raw);

      // RemoteOK (and BuiltIn) in the project fork only match single-token tags,
      // so multi-word searches like "software engineer" return little/nothing.
      // If a single-token-tag board came back with no jobs (or notably fewer than
      // asked), re-run with each word as its own search to pull more supply.
      const hasSingleTokenBoard = g.sites.some((s) => ['remoteok', 'builtin'].includes(s));
      const thin = raw.length === 0 || raw.length < config.results_wanted / 2;
      if (hasSingleTokenBoard && thin) {
        const tokens = terms.flatMap((t) => t.split(/\s+/)).filter(Boolean);
        if (tokens.length > 1) {
          allRaw.push(
            ...(await runJobSpy({
              sites: g.sites,
              search_terms: tokens, // each single token as its own search
              location: g.location,
              results_wanted: config.results_wanted,
              hours_old: config.hours_old,
              is_remote: g.is_remote,
              job_type: config.job_type || undefined,
              include_kw: config.include_kw?.length ? config.include_kw : undefined,
              exclude_kw: config.exclude_kw?.length ? config.exclude_kw : undefined,
              remove_easy_apply: config.remove_easy_apply,
            }))
          );
        }
      }
    }

    // Dedupe + insert per profile.
    let totalAdded = 0;
    for (const profile of targetProfiles) {
      const fresh = await dedupeAndMap(allRaw, profile.id, run.id);
      if (fresh.length) {
        await db.createJobs(fresh as Job[]);
        totalAdded += fresh.length;
      }
    }

    await db.updateScrapeRun(run.id, {
      status: 'completed',
      jobs_found: allRaw.length,
      jobs_added: totalAdded,
      completed_at: new Date().toISOString(),
    });

    return NextResponse.json({
      scrape_run_id: run.id,
      jobs_found: allRaw.length,
      jobs_added: totalAdded,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.updateScrapeRun(run.id, {
      status: 'failed',
      error_message: msg,
      completed_at: new Date().toISOString(),
    });
    // Bubble subprocess errors to the UI as readable messages.
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Map JobSpy rows to our Job shape and dedupe by URL against the profile.
async function dedupeAndMap(
  raw: ScrapeResultJob[],
  profileId: string,
  scrapeRunId: string
): Promise<Job[]> {
  const mask = await db.dedupeJobsByURL(
    profileId,
    raw.map((r) => ({ url: r.job_url }))
  );
  const fresh = raw.filter((_, i) => mask[i]);
  // Also drop duplicate URLs within this same scrape batch (e.g. the same
  // posting surfacing across two site-groups or two search terms), so each
  // profile gets at most one row per URL.
  const seenThisBatch = new Set<string>();
  const deduped = fresh.filter((r) => {
    const u = (r.job_url || '').trim();
    const key = u || `__noUrl__${r.site || ''}__${r.title || ''}`;
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
  }));
}

interface JobSpyArgs {
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

// Spawn the Python JobSpy script and parse its JSON output.
async function runJobSpy(args: JobSpyArgs): Promise<ScrapeResultJob[]> {
  const scriptPath = path.join(process.cwd(), 'scripts', 'run_jobspy.py');
  const tmpFile = path.join(os.tmpdir(), `scrape_${Date.now()}.json`);
  const configJson = JSON.stringify(args);

  // On Windows the python executable is typically `python`; elsewhere `python3`.
  const pyBin = process.platform === 'win32' ? 'python' : 'python3';

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(pyBin, [scriptPath, configJson, tmpFile], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stderr = '';
      child.stderr.on('data', (d) => (stderr += d.toString()));
      child.on('error', (err) => reject(err));
      child.on('close', (code) => {
        if (code !== 0) {
          reject(
            new Error(
              `JobSpy exited ${code}. ${stderr.slice(0, 1000) || 'No stderr.'}`.trim()
            )
          );
        } else {
          resolve();
        }
      });
    });

    const text = await fs.readFile(tmpFile, 'utf-8');
    // Parse defensively: Python's json module can emit bare NaN/Infinity literals
    // (invalid strict JSON) if a value slips past our sanitizer. Rewrite them to
    // null so JSON.parse never throws the "Unexpected token 'N'" error.
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

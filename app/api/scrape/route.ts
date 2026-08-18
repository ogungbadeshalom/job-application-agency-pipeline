import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import type { Job, ScrapeConfig, ScrapeResultJob } from '@/lib/types';
import { isUuid } from '@/lib/validate';
import { runJobSpy, dedupeAndMap } from '@/lib/scrape';

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
    sites: body.sites ?? ['linkedin', 'builtin', 'greenhouse', 'weworkremotely', 'workingnomads', 'jobicy'],
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
  // Reject the whole request if ANY profile id is a non-UUID — passing a
  // truthy-but-invalid member into scrape_runs.profile_ids (uuid[]) would
  // throw 22P02 on the INSERT (unhandled 500). Do NOT filter-and-continue:
  // silently dropping a bad member would scrape a different set than asked for.
  if (config.profile_ids.some((pid) => !isUuid(pid))) {
    return NextResponse.json({ error: 'profile_ids must be valid uuids' }, { status: 400 });
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

  // Guard the WHOLE post-create block so a failure in the terms resolution,
  // no-search-terms update, scrape, or insert always marks the run failed.
  // Previously only the scrape loop had a try/catch: a crash in the terms
  // mapping or the no-terms update left the run stuck in 'running' forever.
  try {
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
  } catch (e) {
    // Outer guard: a failure anywhere in the run (terms resolution, DB hiccup
    // after the scrape_run row was created, etc.) must mark the run failed so
    // it doesn't sit in 'running' forever with no completion timestamp.
    const msg = e instanceof Error ? e.message : String(e);
    await db.updateScrapeRun(run.id, {
      status: 'failed',
      error_message: msg,
      completed_at: new Date().toISOString(),
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

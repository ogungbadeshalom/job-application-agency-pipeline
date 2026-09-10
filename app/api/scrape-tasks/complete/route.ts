import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { dedupeAndMap } from '@/lib/scrape';
import { filterJobsByResume } from '@/lib/aiJobMatch';
import type { Job, ScrapeResultJob } from '@/lib/types';
import { verifyAgentToken } from '@/lib/agentAuth';

// POST /api/scrape-tasks/complete?task=<id>
//   Body: { jobs: ScrapeResultJob[] }   (the laptop scraped on its residential IP)
// Laptop agent submits results; the server ingests them through the SAME
// pipeline the local/worker refills use: role-fit gate + URL dedupe + insert +
// 1-per-company. So a laptop-scraped job lands in the client queue identically
// to one the server scraped itself. Bearer <agent-token>.
export async function POST(req: Request) {
  if (!(await verifyAgentToken(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const url = new URL(req.url);
  const taskId = url.searchParams.get('task') || '';
  if (!taskId) {
    return NextResponse.json({ error: 'Missing task id' }, { status: 400 });
  }
  const body = await req.json().catch(() => ({} as { jobs?: ScrapeResultJob[] }));
  const raw: unknown = body.jobs;
  const jobs: ScrapeResultJob[] = Array.isArray(raw)
    ? (raw as ScrapeResultJob[]).map((j) => ({
        title: String(j.title ?? 'Untitled'),
        company: String(j.company ?? ''),
        site: String(j.site ?? 'unknown'),
        job_url: String(j.job_url ?? ''),
        description: String(j.description ?? ''),
        interval_amount: (typeof j.interval_amount === 'number' ? j.interval_amount : null) as number | null,
        currency: typeof j.currency === 'string' ? j.currency : 'USD',
        location: String(j.location ?? 'Remote'),
        date_posted: typeof j.date_posted === 'string' ? j.date_posted : null,
      }))
    : [];
  if (!jobs.length) {
    return NextResponse.json({ error: 'No jobs in payload' }, { status: 400 });
  }

  // A claimed task carries the target profile; re-read it to be safe.
  const taskInfo = await db.getScrapeTaskById(taskId);
  if (!taskInfo || taskInfo.status !== 'claimed') {
    return NextResponse.json({ error: 'Task is not claimed or unknown' }, { status: 409 });
  }
  const profileId = taskInfo.profile_id;

  const profile = await db.getProfile(profileId);
  let matched: ScrapeResultJob[] = jobs;
  if (profile?.base_resume_text) {
    matched = await filterJobsByResume(jobs, profile.base_resume_text);
  }

  const run = await db.createScrapeRun({
    triggered_by: null, // laptop agent
    profile_ids: [profileId],
    sites: taskInfo.sites || [],
    search_terms: taskInfo.search_terms || [],
    location: taskInfo.location || 'Remote',
    results_wanted: taskInfo.results_wanted || 60,
    hours_old: taskInfo.hours_old || 168,
    status: 'running',
    started_at: new Date().toISOString(),
  });

  const { fresh, skippedDuplicates } = await dedupeAndMap(matched, profileId, run.id);
  let added = 0;
  if (fresh.length) {
    await db.createJobs(fresh as Job[]);
    added = fresh.length;
  }
  await db.dedupeQueueByCompany(profileId);

  await db.updateScrapeRun(run.id, {
    status: 'completed',
    jobs_found: jobs.length,
    jobs_added: added,
    completed_at: new Date().toISOString(),
  });
  await db.completeScrapeTask(taskId, { jobsFound: jobs.length, jobsAdded: added });

  return NextResponse.json({
    jobs_found: jobs.length,
    jobs_added: added,
    skipped_duplicates: skippedDuplicates,
    message: added ? `Added ${added} job${added === 1 ? '' : 's'}.` : 'No new jobs added (all duplicates / filtered).',
  });
}
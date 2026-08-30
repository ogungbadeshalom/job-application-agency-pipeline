import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { CLIENT_VISIBLE_STATUSES } from '@/lib/types';
import type { JobStatus } from '@/lib/types';
import type { ListJobsFilter } from '@/lib/db';
import { isUuid } from '@/lib/validate';
import { fetchPageMeta } from '@/lib/pageMeta';

// POST /api/jobs  — worker (or admin) manually adds a job a worker found
// themselves (a posting URL) so it enters the client's queue in the Working
// (saved) state, ready to tailor/apply like any scraped job. Duplicate URLs for
// the same profile are rejected. Title/company/description are auto-fetched from
// the pasted URL when possible (best-effort; worker can refine).
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const profileId = typeof body.profile_id === 'string' ? body.profile_id : '';
  const rawUrl = typeof body.url === 'string' ? body.url.trim() : '';
  const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;

  if (!isUuid(profileId)) {
    return NextResponse.json({ error: 'Select a client.' }, { status: 400 });
  }
  if (!/^https?:\/\/[^\s]+$/i.test(url) || !url.includes('.')) {
    return NextResponse.json({ error: 'Enter a valid job posting URL.' }, { status: 400 });
  }

  // Ownership: worker can only add for a client they're assigned to.
  if (session.user.role === 'worker') {
    if (!(await db.workerHasClient(session.user.id, profileId))) {
      return NextResponse.json({ error: 'Not your client.' }, { status: 403 });
    }
  } else if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Duplicate-URL check against this profile's existing queue.
  const [dup] = await db.dedupeJobsByURL(profileId, [{ url }]);
  if (!dup) {
    return NextResponse.json(
      { error: 'That job link is already in this client\u2019s queue (saved/applied/skipped).' },
      { status: 409 }
    );
  }

  // Auto-fetch title/company/description from the posted link (best-effort).
  const meta = await fetchPageMeta(url);

  const [job] = await db.createJobs([
    {
      id: '',
      profile_id: profileId,
      title: (typeof body.title === 'string' && body.title.trim() ? body.title.trim() : meta.title) || 'Untitled',
      company: (typeof body.company === 'string' && body.company.trim() ? body.company.trim() : meta.company) || '',
      board: 'manual',
      url,
      description: (typeof body.description === 'string' && body.description.trim()
        ? body.description.trim()
        : meta.description) || '',
      compensation_min: null,
      compensation_max: null,
      compensation_currency: 'USD',
      location: (typeof body.location === 'string' ? body.location.trim() : null) || null,
      status: 'saved',
      tailored_resume: null,
      tailored_resume_pdf_url: null,
      submitted_at: null,
      proof_of_submission: null,
      notes: null,
      scrape_run_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_viewed_at: null,
      status_changed_at: new Date().toISOString(),
    } as unknown as Parameters<typeof db.createJobs>[0][number],
  ] as const);

  return NextResponse.json({ job }, { status: 201 });
}

// GET /api/jobs  — scope by role (RLS-equivalent at the API layer).
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const filter: ListJobsFilter = {};

  const statusParam = url.searchParams.get('status');
  const pid = url.searchParams.get('profile_id');
  const searchParam = url.searchParams.get('search');
  if (searchParam) filter.search = searchParam;

  if (session.user.role === 'admin') {
    // sees everything
  } else if (session.user.role === 'worker') {
    const profiles = await db.listProfilesByWorker(session.user.id);
    if (!profiles.length) return NextResponse.json({ jobs: [] });
    filter.profile_ids = profiles.map((p) => p.id);
  } else {
    // client: own profile, only client-visible statuses
    if (!session.user.profile_id) return NextResponse.json({ jobs: [] });
    filter.profile_id = session.user.profile_id;
    filter.status = CLIENT_VISIBLE_STATUSES;
  }

  // explicit overrides (admin filters)
  if (statusParam)
    filter.status = (filter.status ?? []).length ? filter.status : ([statusParam] as JobStatus[]);
  if (pid && session.user.role === 'admin') {
    if (!isUuid(pid)) {
      return NextResponse.json({ error: 'profile_id must be a valid uuid' }, { status: 400 });
    }
    filter.profile_id = pid;
  }

  const jobs = await db.listJobsSlim(filter);
  return NextResponse.json({ jobs });
}

// PATCH not here — single-job updates go to /api/jobs/[id].

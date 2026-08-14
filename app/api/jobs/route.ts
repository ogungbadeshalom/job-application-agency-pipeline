import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { CLIENT_VISIBLE_STATUSES } from '@/lib/types';
import type { JobStatus } from '@/lib/types';
import type { ListJobsFilter } from '@/lib/db';
import { isUuid } from '@/lib/validate';

// GET /api/jobs  — scope by role (RLS-equivalent at the API layer).
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const filter: ListJobsFilter = {};

  const statusParam = url.searchParams.get('status');

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
  const pid = url.searchParams.get('profile_id');
  if (pid && session.user.role === 'admin') {
    if (!isUuid(pid)) {
      return NextResponse.json({ error: 'profile_id must be a valid uuid' }, { status: 400 });
    }
    filter.profile_id = pid;
  }

  const jobs = await db.listJobs(filter);
  return NextResponse.json({ jobs });
}

// PATCH not here — single-job updates go to /api/jobs/[id].

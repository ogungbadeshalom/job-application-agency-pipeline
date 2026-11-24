import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { isUuid } from '@/lib/validate';

// POST /api/jobs/[id]/redo/resolve — the assigned WORKER closes a redo request
// once they have reworked the application.
//
// Separate from PATCH /api/jobs/[id] on purpose: resolving is a workflow action
// with its own authorisation (the worker must be assigned to that client) and
// its own audit fields (who closed it, when), so it should not be reachable by
// a generic job patch.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isUuid(params.id)) {
    return NextResponse.json({ error: 'Invalid job id' }, { status: 400 });
  }
  if (!['worker', 'admin'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const job = await db.getJob(params.id);
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

  if (session.user.role === 'worker') {
    const owns = await db.workerHasClient(session.user.id, job.profile_id);
    if (!owns) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (!job.redo_requested_at) {
    return NextResponse.json({ error: 'This job has no open redo request.' }, { status: 400 });
  }
  if (job.redo_resolved_at) {
    return NextResponse.json({ error: 'This redo request is already resolved.' }, { status: 409 });
  }

  const updated = await db.updateJob(params.id, {
    redo_resolved_at: new Date().toISOString(),
    redo_resolved_by: session.user.id,
  });

  return NextResponse.json({ job: updated });
}

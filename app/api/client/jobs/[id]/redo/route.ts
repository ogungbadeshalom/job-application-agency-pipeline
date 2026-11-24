import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { isUuid } from '@/lib/validate';
import { REDO_REASONS, type RedoReason } from '@/lib/types';

// POST /api/client/jobs/[id]/redo — a CLIENT asks for an application to be redone.
//
// This is the only write a client is permitted on a job. Everything else on the
// client surface is read-only (see canTouchJob in app/api/jobs/[id]). The flag
// is deliberately narrow: it does not change job status, so the application
// record stays intact and the assigned worker simply sees a "needs rework"
// item in their queue.
//
// Body: { reason: RedoReason, note?: string }
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Demo accounts are read-only everywhere; the middleware cage already blocks
  // this, but fail closed here too rather than relying on one layer.
  if (session.user.is_demo) {
    return NextResponse.json({ error: 'Demo account — read-only.' }, { status: 403 });
  }

  if (session.user.role !== 'client') {
    return NextResponse.json({ error: 'Only clients can flag a job for redo.' }, { status: 403 });
  }

  const url = new URL(req.url);
  const jobId = url.pathname.split('/').slice(-2, -1)[0];
  if (!isUuid(jobId)) {
    return NextResponse.json({ error: 'Invalid job id' }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as { reason?: string; note?: string };

  const reason = typeof body.reason === 'string' ? body.reason : '';
  if (!REDO_REASONS.includes(reason as RedoReason)) {
    return NextResponse.json(
      { error: `reason must be one of: ${REDO_REASONS.join(', ')}` },
      { status: 400 }
    );
  }
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 1000) : '';

  const job = await db.getJob(jobId);
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

  // A client may only flag jobs on their OWN profile. This is the tenancy
  // boundary — without it a client could flag (and thereby disturb) another
  // client's queue by guessing a job id.
  if (job.profile_id !== session.user.profile_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Only real applications can be redone. 'tailored' has no submission, and
  // 'saved'/'skipped' were never sent — flagging those would confuse the worker.
  if (!job.submitted_at && job.status !== 'applied' && job.status !== 'confirmed' && job.status !== 'interview') {
    return NextResponse.json(
      { error: 'Only an application that was already submitted can be flagged for redo.' },
      { status: 400 }
    );
  }

  if (job.redo_requested_at && !job.redo_resolved_at) {
    return NextResponse.json(
      { error: 'This job is already flagged for redo.' },
      { status: 409 }
    );
  }

  const updated = await db.updateJob(jobId, {
    redo_requested_at: new Date().toISOString(),
    redo_reason: reason,
    redo_note: note || null,
    redo_resolved_at: null,
    redo_resolved_by: null,
  });

  return NextResponse.json({ job: updated });
}

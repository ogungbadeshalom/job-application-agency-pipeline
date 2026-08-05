import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import type { Job, JobStatus } from '@/lib/types';

const ALLOWED_PATCH = new Set([
  'status',
  'tailored_resume',
  'tailored_resume_pdf_url',
  'submitted_at',
  'proof_of_submission',
  'notes',
]);

async function canTouchJob(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>['user'],
  job: Job | null
): Promise<boolean> {
  if (!job) return false;
  if (session.role === 'admin') return true;
  if (session.role === 'worker') {
    const profile = await db.getProfileByWorker(session.id);
    return !!profile && profile.id === job.profile_id;
  }
  return false; // clients never write
}

// GET /api/jobs/[id]
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const job = await db.getJob(params.id);
  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (session.user.role === 'admin') {
    /* ok */
  } else if (session.user.role === 'worker') {
    const profile = await db.getProfileByWorker(session.user.id);
    if (!profile || profile.id !== job.profile_id)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  } else {
    // client: own profile + client-visible status only
    if (job.profile_id !== session.user.profile_id || !['applied','rejected','interview','offer','withdrawn'].includes(job.status)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }
  return NextResponse.json({ job });
}

// PATCH /api/jobs/[id]
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const job = await db.getJob(params.id);
  if (!(await canTouchJob(session.user, job))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const patch: Partial<Job> = {};
  for (const [k, v] of Object.entries(body)) {
    if (ALLOWED_PATCH.has(k)) (patch as Record<string, unknown>)[k] = v;
  }

  // Auto-fill submitted_at when moving to applied without a date.
  if (patch.status === ('applied' as JobStatus) && !patch.submitted_at && !job!.submitted_at) {
    patch.submitted_at = new Date().toISOString();
  }

  const updated = await db.updateJob(params.id, patch);
  return NextResponse.json({ job: updated });
}

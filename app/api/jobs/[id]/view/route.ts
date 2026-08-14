import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { isUuid } from '@/lib/validate';

// POST /api/jobs/[id]/view
// Marks a job as "last viewed" (worker's continue-where-I-left-off cursor). No
// body needed — only bumps last_viewed_at. Workers may only touch their own
// assigned client's jobs.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!['admin', 'worker'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!isUuid(params.id)) {
    return NextResponse.json({ error: 'Invalid job id' }, { status: 400 });
  }

  const job = await db.getJob(params.id);
  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (session.user.role === 'worker') {
    // Worker may mark any of their assigned clients' jobs as viewed.
    if (!(await db.workerHasClient(session.user.id, job.profile_id))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  await db.markJobViewed(job.id);
  return NextResponse.json({ ok: true });
}
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

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

  const job = await db.getJob(params.id);
  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (session.user.role === 'worker') {
    const profile = await db.getProfileByWorker(session.user.id);
    if (!profile || profile.id !== job.profile_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  await db.markJobViewed(job.id);
  return NextResponse.json({ ok: true });
}
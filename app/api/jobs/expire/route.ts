import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

// POST /api/jobs/expire
// Auto-cleanup: hard-deletes jobs older than 10 days EXCEPT applied jobs (those
// are retained so worker/client application history survives). Also supports an
// optional ?days= override. Admin-only. A cron runs this daily.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let days = 10;
  try {
    const { searchParams } = new URL(req.url);
    const d = Number(searchParams.get('days'));
    if (!Number.isNaN(d) && d > 0) days = d;
  } catch { /* ignore, default 10 */ }

  const deleted = await db.deleteExpiredJobs(days);
  return NextResponse.json({ ok: true, days, deleted });
}
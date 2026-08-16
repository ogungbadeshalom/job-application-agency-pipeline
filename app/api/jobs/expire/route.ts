import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

// POST /api/jobs/expire
// Auto-cleanup: hard-deletes old CANDIDATE-QUEUE jobs (status `saved`) from the
// top of the `jobs` table. Applied/skipped rows are ALWAYS retained — they are
// the client/worker history that the weekly counters count — and the history
// guard (migration 015) refuses to delete them anyway, so we only target
// `saved`. Also supports an optional ?days= override. Admin-only. A cron runs
// this daily.
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
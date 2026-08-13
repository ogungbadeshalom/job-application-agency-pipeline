import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

// DELETE /api/scrape-runs/[id]  (admin only)
// Delete a scrape-run history record. Jobs created by that run are NOT deleted
// — their `scrape_run_id` is set to null (the FK is `on delete set null`), so
// the jobs remain in the queue.
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const deleted = await db.deleteScrapeRun(params.id);
  if (!deleted) {
    return NextResponse.json({ error: 'Scrape run not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
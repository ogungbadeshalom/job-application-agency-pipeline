import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { scrapeProgress, latestAdminRun } from '@/lib/scrape';

// GET /api/scrape/progress?run=<scrape_run_id>
// Live progress for the ADMIN /api/scrape path, polled by the Refill modal.
// Returns the same in-memory record the subprocess writes (step/total, current
// board, cumulative jobs found, and the per-board log incl. failures). If no
// ?run= is given, falls back to this admin's most recent in-flight run — so the
// modal can start polling immediately without waiting for the POST to resolve
// (the POST only returns the run id after the whole scrape completes).
export async function GET(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const url = new URL(req.url);
  let runId = url.searchParams.get('run') || '';
  if (!runId) {
    runId = latestAdminRun[session.user.id]?.runId || '';
  }
  const p = runId ? scrapeProgress[runId] : undefined;
  return NextResponse.json({ progress: p ?? null, runId: runId || null });
}
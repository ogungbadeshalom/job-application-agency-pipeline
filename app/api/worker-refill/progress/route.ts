import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { scrapeProgress, latestRunByWorker } from '@/lib/scrape';

// GET /api/worker-refill/progress?run=<scrape_run_id>
// Live refill progress for the worker queue UI to poll while a refill scrape is
// running. Returns the in-memory progress record written by the subprocess.
// 404 + progress:null means the run already finished (record deleted) or none is
// running. If no ?run= is given, returns this worker's most recent in-flight run.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== 'worker') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const url = new URL(req.url);
  let runId = url.searchParams.get('run') || '';
  if (!runId) {
    runId = latestRunByWorker[session.user.id]?.runId || '';
  }
  const p = runId ? scrapeProgress[runId] : undefined;
  if (!p) {
    return NextResponse.json({ progress: null, runId: runId || null }, { status: 200 });
  }
  return NextResponse.json({ progress: p, runId });
}
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

// UUID format for Postgres `uuid` columns. Passing anything else (empty string,
// whitespace, a non-UUID string) to a parameterized query throws sqlstate 22P02
// ("invalid input syntax for type uuid") and 500s the request AFTER possibly
// mutating prior rows — so we reject malformed IDs up front, before any DB write.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = (s: unknown): s is string => typeof s === 'string' && UUID_RE.test(s);

// POST /api/assignments  (admin)
// Body: { worker_user_id, profile_ids: string[] }
// Replaces the worker's full client set (diff assign/unassign), so swapping a
// client to another worker is just: remove from A's set, add to B's.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }

  const workerId = body.worker_user_id as string | undefined;
  if (!isUuid(workerId)) {
    return NextResponse.json({ error: 'worker_user_id must be a valid uuid' }, { status: 400 });
  }
  const profileIds: string[] = Array.isArray(body.profile_ids)
      ? body.profile_ids.filter(isUuid)
      : [];
  // A supplied profile_ids array with any non-UUID member (e.g. a lone '' that
  // Postgres would reject as 22P02) is a malformed request — reject it rather than
  // silently dropping the invalid member and applying a DIFFERENT assignment than
  // the admin asked for.
  if (Array.isArray(body.profile_ids)) {
    const bad = (body.profile_ids as unknown[]).find((x) => !isUuid(x));
    if (bad !== undefined) {
      return NextResponse.json({ error: 'profile_ids must be valid uuids' }, { status: 400 });
    }
  }

  // Current set for this worker.
  const current = (await db.listWorkerAssignments())[workerId] ?? [];
  const want = new Set(profileIds);

  // Unassign ones no longer wanted.
  for (const pid of current) {
    if (!want.has(pid)) await db.unassignClient(workerId, pid);
  }
  // Assign ones newly wanted.
  for (const pid of profileIds) {
    if (!(await db.workerHasClient(workerId, pid))) await db.assignClient(workerId, pid);
  }

  return NextResponse.json({
    ok: true,
    worker_user_id: workerId,
    profile_ids: profileIds,
  });
}

// GET /api/assignments (admin) -> { [worker_id]: profile_ids[] }
export async function GET() {
  const session = await getSession();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const assignments = await db.listWorkerAssignments();
  return NextResponse.json(assignments);
}
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

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
  let profileIds: string[] = Array.isArray(body.profile_ids)
    ? body.profile_ids.filter((x: unknown) => typeof x === 'string')
    : [];
  if (!workerId) return NextResponse.json({ error: 'worker_user_id required' }, { status: 400 });

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
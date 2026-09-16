import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

// GET  /api/proof/token  (session: worker or admin) -> { token } (existing or null)
// POST /api/proof/token  (session: worker or admin) -> generate/rotate a fresh token
// A worker sees their own token; admin can view/rotate any worker's (use ?userId=).
// The worker pastes this token into the Chrome extension once; it authenticates
// the cross-origin /api/proof/* endpoints.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session || !['admin', 'worker'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const target = new URL(req.url).searchParams.get('userId');
  if (session.user.role !== 'admin' && target && target !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const userId = target || session.user.id;
  const token = await db.getProofToken(userId);
  return NextResponse.json({ token: token ?? null });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !['admin', 'worker'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let target = session.user.id;
  try {
    const body = (await req.json().catch(() => ({}))) as { userId?: unknown };
    if (typeof body.userId === 'string' && body.userId) target = body.userId;
  } catch { /* ignore */ }
  if (session.user.role !== 'admin' && target !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const token = await db.rotateProofToken(target);
  return NextResponse.json({ token });
}
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

// POST /api/users/[id]  { action: 'disable' | 'enable' }  (admin only)
// Soft-disable/reactivate a user. Disabled users can't log in but their FK'd
// data (jobs, snippets) is preserved.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { action } = await req.json().catch(() => ({} as { action?: string }));
  if (action !== 'disable' && action !== 'enable') {
    return NextResponse.json({ error: 'action must be "disable" or "enable"' }, { status: 400 });
  }

  const user =
    action === 'disable'
      ? await db.disableUser(params.id)
      : await db.enableUser(params.id);

  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ user });
}
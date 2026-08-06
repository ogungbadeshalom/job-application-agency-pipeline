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

// DELETE /api/users/[id]  (admin only) — permanently remove a user account.
// Safe for workers (no dependent data). For a client account, use
// DELETE /api/profiles/[id] which soft-deletes the profile.
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Don't allow deleting yourself.
  if (params.id === session.user.id) {
    return NextResponse.json({ error: 'You cannot delete your own account' }, { status: 400 });
  }

  const target = await db.getUser(params.id);
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  // If the user owns a client profile, it is soft-deleted too.
  if (target.profile_id) {
    await db.deleteProfile(target.profile_id);
  }
  await db.deleteUser(params.id);
  return NextResponse.json({ ok: true });
}
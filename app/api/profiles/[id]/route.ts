import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

// DELETE /api/profiles/[id]  (admin only)
// Soft-delete a client profile: hidden from lists, but its jobs/history stay
// intact. The linked worker is unassigned.
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const profile = await db.deleteProfile(params.id);
  if (!profile) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true, deleted_at: profile.deleted_at });
}
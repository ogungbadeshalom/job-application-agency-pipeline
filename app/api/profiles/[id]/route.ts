import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { isUuid } from '@/lib/validate';

// DELETE /api/profiles/[id]  (admin only)
// Soft-delete a client profile: hidden from lists, but its jobs/history stay
// intact. The linked worker is unassigned.
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isUuid(params.id)) {
    return NextResponse.json({ error: 'Invalid profile id' }, { status: 400 });
  }

  const profile = await db.deleteProfile(params.id);
  if (!profile) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true, deleted_at: profile.deleted_at });
}
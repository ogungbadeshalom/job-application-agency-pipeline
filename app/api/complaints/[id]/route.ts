import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { isUuid } from '@/lib/validate';
import type { ComplaintStatus } from '@/lib/types';

const ALLOWED_STATUS: ComplaintStatus[] = ['open', 'in_progress', 'resolved', 'wontfix'];

// PATCH /api/complaints/[id] — admin updates status and/or a triage note.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!isUuid(params.id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const status = body.status as ComplaintStatus | undefined;
  const adminNote = typeof body.admin_note === 'string' ? body.admin_note : undefined;

  if (status && !ALLOWED_STATUS.includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }
  if (adminNote !== undefined && adminNote.length > 2000) {
    return NextResponse.json({ error: 'Note too long' }, { status: 400 });
  }

  const c = await db.updateComplaint(params.id, {
    status: status ?? undefined,
    admin_note: adminNote === undefined ? undefined : adminNote,
  });
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ complaint: c });
}
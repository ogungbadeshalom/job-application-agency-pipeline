import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { COMPLAINT_CATEGORIES, type ComplaintStatus } from '@/lib/types';

// POST /api/complaints — a worker files a complaint about the software.
// GET  /api/complaints — admin lists/triages complaints.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  const detail = typeof body.detail === 'string' ? body.detail.trim() : '';
  const categoryRaw = typeof body.category === 'string' ? body.category : 'other';
  const url = typeof body.url === 'string' && body.url.trim() ? body.url.trim() : null;
  const profileId = typeof body.profile_id === 'string' && body.profile_id ? body.profile_id : null;

  if (!subject || !detail) {
    return NextResponse.json({ error: 'Subject and details are required.' }, { status: 400 });
  }
  if (subject.length > 200) {
    return NextResponse.json({ error: 'Subject must be under 200 characters.' }, { status: 400 });
  }

  const cat = COMPLAINT_CATEGORIES.includes(categoryRaw as never) ? categoryRaw : 'other';

  // Validate the worker actually has this client (if provided), but allow a
  // complaint with no client context.
  const resolvedProfileId: string | null = profileId;
  if (session.user.role === 'worker') {
    if (profileId && !(await db.workerHasClient(session.user.id, profileId))) {
      return NextResponse.json({ error: 'Invalid client.' }, { status: 400 });
    }
  } else if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const c = await db.createComplaint({
    worker_user_id: session.user.role === 'worker' ? session.user.id : null,
    profile_id: session.user.role === 'worker' ? resolvedProfileId : null,
    category: cat,
    subject,
    detail,
    url,
  });

  return NextResponse.json({ complaint: c }, { status: 201 });
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  // Workers (and admins acting as themselves) fetch their OWN report history.
  const mine = url.searchParams.get('mine') === '1';
  if (session.user.role !== 'admin') {
    if (!mine) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const limit = Number(url.searchParams.get('limit') || 50);
    const complaints = await db.listComplaintsByWorker(session.user.id, Math.min(limit, 200));
    return NextResponse.json({ complaints });
  }

  const status = url.searchParams.get('status') || '';
  const limit = Number(url.searchParams.get('limit') || 100);
  const complaints = mine
    ? await db.listComplaintsByWorker(session.user.id, Math.min(limit, 200))
    : await db.listComplaints({ status, limit: Math.min(limit, 500) });
  return NextResponse.json({ complaints });
}

// PATCH /api/complaints/[id] — admin updates status/note.
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { isUuid } from '@/lib/validate';
import type { StructuredResume } from '@/lib/resume-presets';

// PUT /api/profiles/[id]/resume-data  { data: StructuredResume }
// Worker/admin/client-owner: save the Resume Lab's structured resume content.
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || !['admin', 'worker', 'client'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isUuid(params.id)) return NextResponse.json({ error: 'bad profileId' }, { status: 400 });

  const profile = await db.getProfile(params.id);
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  if (session.user.role === 'worker' && !(await db.workerHasClient(session.user.id, params.id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (session.user.role === 'client' && session.user.profile_id !== params.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data } = await req.json().catch(() => ({} as { data?: unknown }));
  if (!data || typeof data !== 'object') {
    return NextResponse.json({ error: 'Invalid resume data' }, { status: 400 });
  }
  // Basic shape guard.
  const payload = data as StructuredResume;
  if (!payload.contact || typeof payload.contact !== 'object') {
    return NextResponse.json({ error: 'resume.data.contact required' }, { status: 400 });
  }

  await db.setResumeData(params.id, payload);
  return NextResponse.json({ ok: true });
}
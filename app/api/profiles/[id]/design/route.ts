import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { isUuid } from '@/lib/validate';
import { RESUME_PRESETS, type ResumePreset } from '@/lib/resume-pdf';

// POST /api/profiles/[id]/design  { preset }
// Worker/admin: save the client's resume-design preset (per-client).
export async function POST(req: Request, { params }: { params: { id: string } }) {
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

  const { preset } = await req.json().catch(() => ({} as { preset?: string }));
  const valid = RESUME_PRESETS.some((r) => r.id === preset);
  if (!valid) return NextResponse.json({ error: 'Invalid preset' }, { status: 400 });

  await db.updateProfile(params.id, { resume_design: preset as ResumePreset });
  return NextResponse.json({ ok: true, preset });
}
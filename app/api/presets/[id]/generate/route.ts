import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { isUuid } from '@/lib/validate';
import { generateGeneralPreset } from '@/lib/generateGeneralPreset';

// POST /api/presets/[id]/generate   (admin)
// Regenerate the "General" refill preset for a client profile from its resume.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isUuid(params.id)) {
    return NextResponse.json({ error: 'Bad profile id' }, { status: 400 });
  }

  const profile = await db.getProfile(params.id);
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  if (!profile.base_resume_text) {
    return NextResponse.json({ error: 'This client has no resume uploaded yet.' }, { status: 400 });
  }

  const general = await generateGeneralPreset(params.id);
  if (!general) {
    return NextResponse.json(
      { error: 'Could not generate a General preset from this resume.' },
      { status: 502 }
    );
  }
  return NextResponse.json({ ok: true, preset: general });
}
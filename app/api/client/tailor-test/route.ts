import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { generateTailoredResume } from '@/lib/resume-tailor';

// POST /api/client/tailor-test  { description, title? }
// Lets a client TEST the app's resume generation on their OWN base resume
// against any pasted job description — no worker, no queue, no submission.
// Returns the tailored resume text + ATS score. Best-effort scoring: a low
// score still returns the resume (fail-open) so the client sees the result.
export async function POST(req: Request) {
  const user = await requireRole('client').catch(() => null);
  if (!user || !user.profile_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { description, title } = await req.json().catch(() => ({} as Record<string, unknown>));
  if (!String(description || '').trim()) {
    return NextResponse.json({ error: 'Paste a job description first.' }, { status: 400 });
  }

  const profile = await db.getProfile(user.profile_id);
  if (!profile?.base_resume_text) {
    return NextResponse.json(
      { error: 'No base resume uploaded for your profile yet.' },
      { status: 400 }
    );
  }

  try {
    const r = await generateTailoredResume({
      baseResumeText: profile.base_resume_text,
      resumeData: profile.resume_data,
      jobTitle: String(title || 'Role'),
      description: String(description),
    });
    return NextResponse.json({
      text: r.text,
      atsScore: r.atsScore,
      atsScoreAfterRegen: r.atsScoreAfterRegen ?? null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Resume generation failed: ${msg}` }, { status: 500 });
  }
}
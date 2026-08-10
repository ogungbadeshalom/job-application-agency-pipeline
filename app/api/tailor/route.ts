import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { callAI, RESUME_TAILOR_SYSTEM } from '@/lib/ai';

// POST /api/tailor  { jobId }
// Worker/admin: tailor the client's base resume to the job's JD.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !['admin', 'worker'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { jobId } = await req.json().catch(() => ({} as { jobId?: string }));
  if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 });

  const job = await db.getJob(jobId);
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

  // Worker may only tailor jobs for their assigned client.
  if (session.user.role === 'worker') {
    const profile = await db.getProfileByWorker(session.user.id);
    if (!profile || profile.id !== job.profile_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const profile = await db.getProfile(job.profile_id);
  if (!profile?.base_resume_text) {
    return NextResponse.json(
      { error: 'No base resume uploaded for this client.' },
      { status: 400 }
    );
  }

  const user = [
    'JOB DESCRIPTION:',
    job.description || '(no description available)',
    '',
    'TITLE:',
    job.title,
    '',
    'BASE RESUME:',
    profile.base_resume_text,
  ].join('\n');

  // Trim long text so "terminated" failures on the free inference endpoint are
  // avoided: cap the JD and base resume individually and keep the total prompt
  // within a safe size.
  const MAX = 4000;
  function clip(s: string): string {
    if (!s) return s;
    return s.length > MAX ? s.slice(0, MAX) + '\n…' : s;
  }
  const prompt = clip(user);

  let tailored: string;
  try {
    tailored = await callAI(RESUME_TAILOR_SYSTEM, prompt, {
      maxTokens: 1500,
      temperature: 0.4,
    });
  } catch (e) {
    // Surface AI failures as valid JSON (not an HTML 500 error page) so the
    // admin/worker UI can show the cause and retry.
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `AI call failed: ${msg}` },
      { status: 502 }
    );
  }

  if (!tailored || !tailored.length) {
    return NextResponse.json({ error: 'AI returned an empty resume.' }, { status: 502 });
  }

  await db.updateJob(jobId, { tailored_resume: tailored, status: 'tailored' });

  return NextResponse.json({ tailored_resume: tailored });
}

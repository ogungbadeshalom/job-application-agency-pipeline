import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { callAI, RESUME_ATS_SYSTEM } from '@/lib/ai';
import { parseAtsScore } from '@/lib/ats';
import type { AtsScore } from '@/lib/types';
import { isUuid } from '@/lib/validate';

// POST /api/ats-scan  { jobId }
// Worker/admin: run an ATS fitness scan of the client's base resume against the
// job's JD. The AI returns a structured score (overall + 5 dimensions + tips)
// which we persist on the job (ats_score + ats_feedback) and surface to the
// worker and client. This lets every application carry a visible "ATS %".
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !['admin', 'worker'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { jobId } = await req.json().catch(() => ({} as { jobId?: string }));
  if (!isUuid(jobId)) {
    return NextResponse.json({ error: 'jobId must be a valid uuid' }, { status: 400 });
  }

  const job = await db.getJob(jobId);
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

  if (session.user.role === 'worker') {
    if (!(await db.workerHasClient(session.user.id, job.profile_id))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const profile = await db.getProfile(job.profile_id);
  if (!profile?.base_resume_text) {
    return NextResponse.json({ error: 'No base resume uploaded for this client.' }, { status: 400 });
  }

  function cap(s: string, n: number): string {
    return s && s.length > n ? s.slice(0, n) + '\n…' : s;
  }
  const jdInline = cap(job.description || '(no description available)', 4000);
  const user = [
    'JOB DESCRIPTION:',
    jdInline,
    '',
    'TITLE:', job.title,
    '',
    'RESUME:',
    profile.base_resume_text,
  ].join('\n');

  let raw: string;
  try {
    raw = await callAI(RESUME_ATS_SYSTEM, user, { maxTokens: 1500, temperature: 0.2 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `AI call failed: ${msg}` }, { status: 502 });
  }
  if (!raw || !raw.trim()) {
    return NextResponse.json({ error: 'AI returned an empty result.' }, { status: 502 });
  }

  let score;
  try {
    score = parseAtsScore(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `AI returned invalid score JSON: ${msg}` }, { status: 502 });
  }

  await db.updateJob(jobId, {
    ats_score: score.overallScore,
    ats_feedback: JSON.stringify(score) as unknown as AtsScore,
  });

  return NextResponse.json({ score });
}
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { callAI, QUESTION_HELPER_SYSTEM } from '@/lib/ai';

// POST /api/answer  { jobId, question, context? }
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !['admin', 'worker'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { jobId, question, context } = await req.json().catch(
    () => ({}) as { jobId?: string; question?: string; context?: string }
  );
  if (!jobId || !question) {
    return NextResponse.json({ error: 'jobId and question required' }, { status: 400 });
  }

  const job = await db.getJob(jobId);
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

  if (session.user.role === 'worker') {
    const profile = await db.getProfileByWorker(session.user.id);
    if (!profile || profile.id !== job.profile_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const profile = await db.getProfile(job.profile_id);
  const user = [
    'CANDIDATE RESUME:',
    profile?.base_resume_text || '(no resume on file)',
    '',
    'JOB:',
    `${job.title} — ${job.company}`,
    job.description || '',
    '',
    'QUESTION:',
    question,
    context ? `\nCONTEXT:\n${context}` : '',
  ].join('\n');

  let answer: string;
  try {
    answer = await callAI(QUESTION_HELPER_SYSTEM, user, {
      maxTokens: 600,
      temperature: 0.5,
    });
  } catch (e) {
    // Surface AI failures as valid JSON (not an HTML 500 error page) so the
    // worker UI can show a readable message and stay on the flow.
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `AI call failed: ${msg}` },
      { status: 502 }
    );
  }

  if (!answer || !answer.length) {
    return NextResponse.json({ error: 'AI returned an empty answer.' }, { status: 502 });
  }

  return NextResponse.json({ answer });
}

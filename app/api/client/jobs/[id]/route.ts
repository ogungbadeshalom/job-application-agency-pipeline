import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { isUuid } from '@/lib/validate';

// GET /api/client/jobs/[id]
// Live job detail for a client — the resume-tailoring view polls this every ~2s
// while the worker is tailoring the job, so the client can watch the resume be
// re-written against the JD in real time. <2KB payload on purpose (no proof
// image, no heavy text beyond the resume itself).
export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  const user = await requireRole('client').catch(() => null);
  if (!user || !user.profile_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  const job = await db.getJob(id);
  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  // Ownership: a client can only read their own jobs.
  if (job.profile_id !== user.profile_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json({
    id: job.id,
    title: job.title,
    company: job.company,
    description: job.description ?? null,
    status: job.status,
    tailor_status: job.tailor_status ?? null,
    ats_score: job.ats_score ?? null,
    ats_feedback: job.ats_feedback ?? null,
    tailored_resume: job.tailored_resume ?? null,
    tailored_resume_pdf_url: job.tailored_resume_pdf_url ?? null,
    updated_at: job.updated_at,
  });
}
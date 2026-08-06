import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { newStoragePath, writeStorage } from '@/lib/storage';
import { parseMultipart } from '@/lib/multipart';

// POST /api/upload-proof  multipart: file + job_id
// Admin or the job's assigned worker. Stores the proof image on local disk and
// returns its relative path; the caller PATCHes it onto the job.
export async function POST(req: Request) {
  const ctype = req.headers.get('content-type') || '';
  const boundary = ctype.match(/boundary="?([^";]+)"?/)?.[1];
  if (!boundary) {
    return NextResponse.json({ error: 'Bad multipart body' }, { status: 400 });
  }

  const raw = Buffer.from(await req.arrayBuffer());
  const parsed = parseMultipart(raw, boundary);
  const file = parsed.file;
  const jobId = parsed.fields.job_id;

  if (!file || !jobId) {
    return NextResponse.json({ error: 'file and job_id required' }, { status: 400 });
  }
  // Images only.
  if (!file.type.startsWith('image/')) {
    return NextResponse.json({ error: 'Proof must be an image' }, { status: 400 });
  }

  const session = await getSession();
  if (!session || !['admin', 'worker'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const job = await db.getJob(jobId);
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

  // Worker may only add proof for their assigned client's job.
  if (session.user.role === 'worker') {
    const profile = await db.getProfileByWorker(session.user.id);
    if (!profile || profile.id !== job.profile_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const ext = (file.filename.split('.').pop() || 'png').toLowerCase();
  const relPath = newStoragePath(`proof/${job.profile_id}`, `.${ext}`);

  try {
    await writeStorage(relPath, file.buffer);
  } catch (e) {
    return NextResponse.json(
      { error: `Could not store proof: ${e instanceof Error ? e.message : e}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ path: relPath });
}
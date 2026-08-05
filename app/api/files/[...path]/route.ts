import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { readStorage, statStorage } from '@/lib/storage';

// GET /api/files/...  — serve a stored file (resume, tailored PDF) with auth.
// Authorization:
//   - admin: any file
//   - worker: only files under their assigned client's profile
//   - client: only their own profile's files
//
// The file path is matched against a profile's base_resume_url or a job's
// tailored_resume_pdf_path to decide access.
export async function GET(_req: Request, { params }: { params: { path: string[] } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rel = params.path.join('/');
  // sanity: only known prefixes
  if (!/^(resumes|tailored)\//.test(rel)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Resolve which profile this file belongs to, then check permission.
  const profiles = await db.listProfiles();
  const owner = profiles.find(
    (p) => p.base_resume_url === rel
  );

  let jobOwner: string | null = null;
  if (!owner) {
    const jobs = await db.listJobs({ limit: 5000 });
    const job = jobs.find((j) => j.tailored_resume_pdf_url === rel);
    if (job) jobOwner = job.profile_id;
  }

  const ownerProfileId = owner?.id ?? jobOwner;
  if (!ownerProfileId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Permission by role.
  const u = session.user;
  if (u.role !== 'admin') {
    if (u.role === 'worker') {
      const mine = await db.getProfileByWorker(u.id);
      if (!mine || mine.id !== ownerProfileId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    } else {
      // client: only own profile's resume
      if (u.profile_id !== ownerProfileId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }
  }

  const meta = await statStorage(rel);
  if (!meta) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const data = await readStorage(rel);
  const contentType = rel.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream';

  return new NextResponse(data, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(meta.size),
      'Content-Disposition': `attachment; filename="${rel.split('/').pop()}"`,
    },
  });
}
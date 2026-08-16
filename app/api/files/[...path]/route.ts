import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { readStorage, statStorage } from '@/lib/storage';

// GET /api/files/...  — serve a stored file (resume, tailored PDF, proof image)
// with auth. Authorization:
//   - admin: any file
//   - worker: only files under their assigned client's profile
//   - client: only their own profile's files
//
// Ownership is resolved by matching the path against a profile's resume, a
// job's tailored pdf, or a job's proof_of_submission.
export async function GET(_req: Request, { params }: { params: { path: string[] } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rel = params.path.join('/');
  // sanity: only known prefixes
  if (!/^(resumes|tailored|proof)\//.test(rel)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Resolve which profile this file belongs to.
  const profiles = await db.listProfiles();
  const owner = profiles.find((p) => p.base_resume_url === rel);

  let ownerProfileId: string | null = owner?.id ?? null;
  let owningJob: { company?: string | null; title?: string | null } | null = null;

  if (!ownerProfileId) {
    // Search jobs for a tailored-resume or proof match. Use the slim indexed
    // lookup (returns only id/profile/company/title) instead of loading the
    // whole jobs table, so a file request doesn't pull up to N full rows (incl.
    // large `description`/`tailored_resume` text) into memory just to resolve
    // one path's owner.
    const job = await db.getJobByFilePath(rel);
    ownerProfileId = job?.profile_id ?? null;
    owningJob = job ? { company: job.company, title: job.title } : null;
  }

  if (!ownerProfileId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Permission by role.
  const u = session.user;
  if (u.role !== 'admin') {
    if (u.role === 'worker') {
      // Worker may access any client they're assigned to (Option B multi-client).
      if (ownerProfileId == null || !(await db.workerHasClient(u.id, ownerProfileId))) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    } else {
      // client: only their own profile's files
      if (u.profile_id !== ownerProfileId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }
  }

  const meta = await statStorage(rel);
  if (!meta) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const data = await readStorage(rel);
  const contentType = rel.toLowerCase().endsWith('.pdf')
    ? 'application/pdf'
    : rel.toLowerCase().endsWith('.png')
    ? 'image/png'
    : rel.toLowerCase().endsWith('.jpg') || rel.toLowerCase().endsWith('.jpeg')
    ? 'image/jpeg'
    : rel.toLowerCase().endsWith('.gif')
    ? 'image/gif'
    : rel.toLowerCase().endsWith('.webp')
    ? 'image/webp'
    : 'application/octet-stream';

  const isImage = contentType.startsWith('image/');
  // Derive a friendly download filename from the owning job when available
  // (tailored PDFs), so the browser saves something readable and a proper .pdf.
  let fname = rel.split('/').pop() || 'file';
  if (!isImage && owningJob) {
    const base = `${owningJob.company || 'job'}-${owningJob.title || 'resume'}`.replace(/[^\w\-.]/g, '_').slice(0, 90);
    fname = `${base}.pdf`;
  }
  return new NextResponse(data, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(meta.size),
      'Content-Disposition': `${isImage ? 'inline' : 'attachment'}; filename="${fname}"`,
    },
  });
}
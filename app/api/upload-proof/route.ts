import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { newStoragePath, writeStorage } from '@/lib/storage';
import { parseMultipart } from '@/lib/multipart';

// POST /api/upload-proof  multipart: file + job_id
// Admin or the job's assigned worker. Stores the proof image on local disk and
// returns its relative path; the caller PATCHes it onto the job.
//
// Rejects oversized bodies before buffering: `req.arrayBuffer()` reads the
// whole request into RAM with no ceiling. A huge proof upload could exhaust
// memory on the self-hosted VPS, so we cap by declared Content-Length up front
// and fall back to a post-read check.
const MAX_PROOF_BYTES = 15 * 1024 * 1024; // 15MB — screenshots are small

export async function POST(req: Request) {
  const ctype = req.headers.get('content-type') || '';
  const boundary = ctype.match(/boundary="?([^";]+)"?/)?.[1];
  if (!boundary) {
    return NextResponse.json({ error: 'Bad multipart body' }, { status: 400 });
  }

  const declared = Number(req.headers.get('content-length') || 0);
  if (declared > MAX_PROOF_BYTES) {
    return NextResponse.json(
      { error: `Proof image too large (max ${Math.round(MAX_PROOF_BYTES / 1024 / 1024)}MB).` },
      { status: 413 }
    );
  }

  const raw = Buffer.from(await req.arrayBuffer());
  if (raw.length > MAX_PROOF_BYTES) {
    return NextResponse.json(
      { error: `Proof image too large (max ${Math.round(MAX_PROOF_BYTES / 1024 / 1024)}MB).` },
      { status: 413 }
    );
  }
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

  // Derive the stored extension from a safe allowlist keyed on the MIME type
  // rather than the client-supplied filename. The uploader controls the early
  // `file.type` only up to "some image/*", but the extension currently came
  // straight from `file.filename` — so a worker could store e.g. `.html`/
  // `.svg` with misleading content, which `/api/files` would then serve under
  // a bad or unsafe extension. Pin the extension to a known-safe image type.
  const IMAGE_EXT: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
  };
  const normType = file.type.toLowerCase();
  const ext = IMAGE_EXT[normType] ?? 'png'; // unknown image/* falls back to png

  const session = await getSession();
  if (!session || !['admin', 'worker'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const job = await db.getJob(jobId);
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

  // Worker may only add proof for their assigned client's job.
  if (session.user.role === 'worker') {
    if (!(await db.workerHasClient(session.user.id, job.profile_id))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

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
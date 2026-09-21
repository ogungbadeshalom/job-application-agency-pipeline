import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getWorkerIdFromProofToken } from '@/lib/proofAuth';
import { newStoragePath, writeStorage } from '@/lib/storage';
import { parseMultipart } from '@/lib/multipart';
import { isUuid } from '@/lib/validate';

// POST /api/proof/submit  (Bearer worker proof-token)  multipart: file + job_id
// The Chrome extension's FULL one-click path: capture the confirmation screen,
// upload it as proof, AND mark the job Applied — all in a single call. The
// worker already chose the job in the extension (Option B), so this only needs
// the screenshot + the job id. Saves an image to proof/<profileId>/ and patches
// the job to applied with proof_of_submission + submitted_at set.
const MAX_PROOF_BYTES = 15 * 1024 * 1024; // 15MB
const IMAGE_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

export async function POST(req: Request) {
  const workerId = await getWorkerIdFromProofToken(req);
  if (!workerId) {
    return NextResponse.json({ error: 'Invalid or missing token' }, { status: 401 });
  }

  const ctype = req.headers.get('content-type') || '';
  const boundary = ctype.match(/boundary="?([^";]+)"?/)?.[1];
  if (!boundary) {
    return NextResponse.json({ error: 'Bad multipart body' }, { status: 400 });
  }

  const declared = Number(req.headers.get('content-length') || 0);
  if (declared > MAX_PROOF_BYTES) {
    return NextResponse.json(
      { error: `Image too large (max ${Math.round(MAX_PROOF_BYTES / 1024 / 1024)}MB).` },
      { status: 413 }
    );
  }
  const raw = Buffer.from(await req.arrayBuffer());
  if (raw.length > MAX_PROOF_BYTES) {
    return NextResponse.json(
      { error: `Image too large (max ${Math.round(MAX_PROOF_BYTES / 1024 / 1024)}MB).` },
      { status: 413 }
    );
  }

  const parsed = parseMultipart(raw, boundary);
  const file = parsed.file;
  const jobId = parsed.fields.job_id;

  if (!file || !jobId) {
    return NextResponse.json({ error: 'file and job_id required' }, { status: 400 });
  }
  if (!isUuid(jobId)) {
    return NextResponse.json({ error: 'job_id must be a valid uuid' }, { status: 400 });
  }
  if (!file.type.startsWith('image/')) {
    return NextResponse.json({ error: 'Proof must be an image' }, { status: 400 });
  }

  const job = await db.getJob(jobId);
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

  // Worker may only attach proof to their assigned client's job.
  if (!(await db.workerHasClient(workerId, job.profile_id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const ext = IMAGE_EXT[file.type.toLowerCase()] ?? 'png';
  const relPath = newStoragePath(`proof/${job.profile_id}`, `.${ext}`);
  try {
    await writeStorage(relPath, file.buffer);
  } catch (e) {
    return NextResponse.json(
      { error: `Could not store proof: ${e instanceof Error ? e.message : e}` },
      { status: 500 }
    );
  }

  // Mark applied + attach proof. `updateJob` auto-fills submitted_at on the
  // applied transition. Only change status if not already applied/skipped.
  if (job.status === 'applied') {
    // Already applied — just (re)attaching proof.
    await db.updateJob(jobId, { proof_of_submission: relPath });
    return NextResponse.json({ ok: true, applied: true, reattached: true, path: relPath });
  }
  // Apply-time duplicate guard (mirrors PATCH /api/jobs/[id]): refuse to mark
  // this posting applied if it (same normalized URL OR same company+title) is
  // already applied for the profile. Without this the Chrome-extension one-click
  // path could double-submit to one employer, inflating a client's Applied count.
  const dup = await db.hasAppliedDuplicate(job.profile_id, {
    url: job.url,
    company: job.company,
    title: job.title,
  });
  if (dup) {
    return NextResponse.json(
      { error: 'This job (or a duplicate of it) is already marked as applied. Skip it instead.' },
      { status: 409 }
    );
  }
  await db.updateJob(jobId, {
    status: 'applied',
    proof_of_submission: relPath,
  });
  return NextResponse.json({ ok: true, applied: true, path: relPath });
}
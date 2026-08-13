import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { extractResumeText } from '@/lib/resume-text';
import { newStoragePath, writeStorage } from '@/lib/storage';
import { parseMultipart } from '@/lib/multipart';

// POST /api/upload  multipart: file + profile_id
// Admin. Writes the raw file to local disk and stores its text for AI tailoring
// + the resume path on the profile.
//
// Uses a manual multipart parser (lib/multipart.ts) instead of req.formData(),
// which can hang on some Node/undici + Next.js `next start` combinations.
//
// Rejects oversized bodies before buffering into memory: `req.arrayBuffer()`
// reads the whole request into RAM with no ceiling, so a huge upload (or an
// attacker) could exhaust memory on the self-hosted VPS. We cap by the
// declared Content-Length up front and fall back to a post-read check.
const MAX_RESUME_BYTES = 20 * 1024 * 1024; // 20MB — plenty for PDF/DOCX resumes

export async function POST(req: Request) {
  // Authorize BEFORE parsing/buffering the body — parsing runs unbounded
  // allocation, so an unauthenticated caller could otherwise force a memory
  // spike (memory DoS) on each hit. (Auth was previously checked only after
  // req.arrayBuffer() + multipart parse.)
  const session = await getSession();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const ctype = req.headers.get('content-type') || '';
  const boundary = ctype.match(/boundary="?([^";]+)"?/)?.[1];
  if (!boundary) {
    return NextResponse.json({ error: 'Bad multipart body' }, { status: 400 });
  }

  const declared = Number(req.headers.get('content-length') || 0);
  if (declared > MAX_RESUME_BYTES) {
    return NextResponse.json(
      { error: `Resume too large (max ${Math.round(MAX_RESUME_BYTES / 1024 / 1024)}MB).` },
      { status: 413 }
    );
  }

  const raw = Buffer.from(await req.arrayBuffer());
  if (raw.length > MAX_RESUME_BYTES) {
    return NextResponse.json(
      { error: `Resume too large (max ${Math.round(MAX_RESUME_BYTES / 1024 / 1024)}MB).` },
      { status: 413 }
    );
  }
  const parsed = parseMultipart(raw, boundary);
  const file = parsed.file;
  const profileId = parsed.fields.profile_id;

  if (!file || !profileId) {
    return NextResponse.json({ error: 'file and profile_id required' }, { status: 400 });
  }

  const buffer = file.buffer;

  let text: string;
  try {
    text = await extractResumeText(buffer, file.type || 'application/octet-stream');
  } catch (e) {
    return NextResponse.json(
      { error: `Could not extract text: ${e instanceof Error ? e.message : e}` },
      { status: 400 }
    );
  }
  if (!text) {
    return NextResponse.json({ error: 'No text could be extracted from the file.' }, { status: 400 });
  }

  // Persist the original file to local disk (relative to STORAGE_DIR).
  const ext = (file.filename.split('.').pop() || 'pdf').toLowerCase();
  const relPath = newStoragePath(`resumes/${profileId}`, `.${ext}`);
  await writeStorage(relPath, buffer);

  const profile = await db.updateProfile(profileId, {
    base_resume_text: text,
    base_resume_url: relPath,
  });

  return NextResponse.json({ profile, chars: text.length, path: relPath });
}
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { extractResumeText } from '@/lib/resume-text';
import { newStoragePath, writeStorage } from '@/lib/storage';

// POST /api/upload  multipart: file + profile_id
// Admin (or worker on their own client). Writes the raw file to local disk and
// stores its text for AI tailoring + the relative path on the profile.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const form = await req.formData();
  const file = form.get('file') as File | null;
  const profileId = form.get('profile_id') as string | null;
  if (!file || !profileId) {
    return NextResponse.json({ error: 'file and profile_id required' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

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
  const ext = file.name.split('.').pop() || 'pdf';
  const relPath = newStoragePath(`resumes/${profileId}`, `.${ext}`);
  await writeStorage(relPath, buffer);

  const profile = await db.updateProfile(profileId, {
    base_resume_text: text,
    base_resume_url: relPath,
  });

  return NextResponse.json({ profile, chars: text.length, path: relPath });
}
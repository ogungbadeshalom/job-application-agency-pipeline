import { NextResponse } from 'next/server';
import JSZip from 'jszip';
import { getSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { generateResumePdf } from '@/lib/pdf';

// GET /api/client/resumes/weekly?week=YYYY-MM-DD
// Downloads a ZIP of all tailored resumes a client has for a PAST submission
// week. `week` = any date within the target Monday-start week (the 7-day window
// is resolved server-side). Respects the per-profile allow_resume_download lock;
// only the client's own profile is ever included.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session || !session.user.profile_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const weekParam = url.searchParams.get('week') || '';
  if (!weekParam) {
    return NextResponse.json({ error: 'week is required (YYYY-MM-DD)' }, { status: 400 });
  }

  // Resolve any date in the week to that week's Monday.
  const d = new Date(weekParam + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) {
    return NextResponse.json({ error: 'Invalid week date' }, { status: 400 });
  }
  const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday ... 6 = Sunday
  d.setUTCDate(d.getUTCDate() - dow);
  const weekStart = d.toISOString().slice(0, 10);

  // Respect per-profile download lock (same gate as /api/pdf).
  const profile = await db.getProfile(session.user.profile_id).catch(() => null);
  if (profile && profile.allow_resume_download === false) {
    return NextResponse.json({ error: 'Resume downloads disabled for this profile' }, { status: 403 });
  }

  // Only allow downloading PAST weeks (the current, in-progress week is excluded).
  const today = new Date();
  const todayDow = (today.getUTCDay() + 6) % 7;
  const thisMonday = new Date(today);
  thisMonday.setUTCDate(today.getUTCDate() - todayDow);
  const thisMondayStr = thisMonday.toISOString().slice(0, 10);
  if (weekStart >= thisMondayStr) {
    return NextResponse.json({ error: 'Only past weeks are available to download.' }, { status: 400 });
  }

  const resumes = await db.listTailoredResumesByWeek(session.user.profile_id, weekStart);
  if (resumes.length === 0) {
    return NextResponse.json({ error: 'No tailored resumes for that week.' }, { status: 404 });
  }

  // Build the ZIP in memory. Import as ESM default (jszip ships a default export).
  const zip = new JSZip();
  let failed = 0;
  for (const r of resumes) {
    if (!r.tailored_resume) continue;
    try {
      const pdfBytes = await generateResumePdf(r.tailored_resume);
      const safe = (s: string) => (s || '').replace(/[\\/:*?"<>|\n\r\t]+/g, ' ').trim();
      const company = safe(r.company);
      const role = safe(r.title);
      const name = role ? `${company || 'resume'} - ${role}` : (company || 'resume');
      zip.file(`${name}.pdf`, pdfBytes, { binary: true });
    } catch {
      failed += 1;
    }
  }

  const content = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

  // Filename like "Tailored Resumes - 2026-09-21.zip"
  const safeWeek = safeName(weekStart);
  return new NextResponse(new Uint8Array(content), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="Tailored-Resumes-${safeWeek}.zip"`,
    },
  });
}

function safeName(s: string): string {
  return (s || '').replace(/[^0-9a-zA-Z-]/g, '');
}
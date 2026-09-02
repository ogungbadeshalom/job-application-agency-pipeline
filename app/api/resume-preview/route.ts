import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { isUuid } from '@/lib/validate';
import { renderResumePdf, structuredToResumeData, type ResumeData, type ResumePreset, RESUME_PRESETS } from '@/lib/resume-pdf';

// GET /api/resume-preview?profileId=<id>&preset=<preset>
// Render a live preview PDF of a client's base resume in the given design preset.
// Worker/owner or admin. Returns the PDF binary (inline) so the worker can SEE
// how the resume design looks without tailoring. Honors auto-save per client.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session || !['admin', 'worker', 'client'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const url = new URL(req.url);
  const profileId = url.searchParams.get('profileId') || '';
  let preset = (url.searchParams.get('preset') || 'classic') as ResumePreset;
  if (!isUuid(profileId)) return NextResponse.json({ error: 'bad profileId' }, { status: 400 });
  const valid = RESUME_PRESETS.some((r) => r.id === preset);
  if (!valid) preset = 'classic';

  const profile = await db.getProfile(profileId);
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  // Worker can preview assigned clients; a client can preview only their OWN.
  if (session.user.role === 'worker' && !(await db.workerHasClient(session.user.id, profileId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (session.user.role === 'client' && session.user.profile_id !== profileId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!profile.base_resume_text && !profile.resume_data) {
    return NextResponse.json({ error: 'This client has no resume yet. Add one in Resume Lab.' }, { status: 400 });
  }

  // Use the Resume Lab's structured content when the user has saved it;
  // otherwise fall back to parsing the base-resume prose.
  let data: ResumeData;
  if (profile.resume_data) {
    data = structuredToResumeData(profile.resume_data);
  } else {
    data = previewData(profile.name, profile.base_resume_text || '');
  }
  const buf = await renderResumePdf(data, preset).catch(() => null);
  if (!buf) return NextResponse.json({ error: 'Render failed' }, { status: 500 });

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${encodeURIComponent(profile.name)}-preview.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}

// Build lightweight ResumeData from the raw base-resume prose for a fast,
// no-AI preview: real name, a title guess, the opening summary lines, and a
// skills scan. Good enough to judge the letterhead + section styling.
function previewData(name: string, text: string): ResumeData {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const titleLine = lines.find(
    (l) => !/^\s*\d/.test(l) && l.length > 3 && l.length < 90 && !/@/.test(l)
  );
  const title = titleLine && titleLine.toLowerCase() !== name.toLowerCase() ? titleLine : 'Professional / Engineer';

  // summary: first dense paragraph or collect first 2-3 lines
  const summaryLines = lines.filter((l) => l.length > 60).slice(0, 2);
  const summary = summaryLines.length
    ? summaryLines
    : [lines.find((l) => l.length > 30) || 'Experienced professional with a track record of delivering results.'];

  const lower = text.toLowerCase();
  const skills =
    ['SQL', 'Python', 'AWS', 'Azure', 'GCP', 'Snowflake', 'Databricks', 'Spark', 'Kubernetes', 'Docker', 'TypeScript', 'React', 'Node.js', 'Machine Learning', 'ETL', 'Airflow', 'Terraform', 'PostgreSQL']
      .filter((s) => lower.includes(s.toLowerCase()))
      .slice(0, 10);

  return {
    name,
    title,
    contact: 'you@example.com - Remote (US)',
    summary,
    experience: [
      { role: title, company: 'Current / Most Recent Company', dates: '2022–Present', bullets: ['Led the design and delivery of production systems.', 'Collaborated cross-functionally to ship impactful features.'] },
      { role: title, company: 'Prior Company', dates: '2019–2022', bullets: ['Built and scaled core platforms.', 'Improved reliability and performance.'] },
    ],
    education: [],
    certifications: [],
    skills: skills.length ? skills : ['SQL', 'Python', 'Cloud', 'Data Pipelines', 'Collaboration'],
  };
}
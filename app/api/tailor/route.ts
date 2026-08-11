import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { callAI, RESUME_TAILOR_SYSTEM } from '@/lib/ai';
import { renderResumePdf, type ResumeData } from '@/lib/resume-pdf';
import { newStoragePath, writeStorage } from '@/lib/storage';

// POST /api/tailor  { jobId }
// Worker/admin: tailor the client's base resume to the job's JD. The AI returns
// structured JSON which we render into a properly-formatted PDF (and also store
// the plain-text resume for editing), then surface a download URL.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !['admin', 'worker'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { jobId } = await req.json().catch(() => ({} as { jobId?: string }));
  if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 });

  const job = await db.getJob(jobId);
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

  if (session.user.role === 'worker') {
    const profile = await db.getProfileByWorker(session.user.id);
    if (!profile || profile.id !== job.profile_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const profile = await db.getProfile(job.profile_id);
  if (!profile?.base_resume_text) {
    return NextResponse.json(
      { error: 'No base resume uploaded for this client.' },
      { status: 400 }
    );
  }

  // Trim long text so the free inference endpoint doesn't drop the request.
  const MAX = 4000;
  function clip(s: string): string {
    if (!s) return s;
    return s.length > MAX ? s.slice(0, MAX) + '\n…' : s;
  }
  const user = clip(
    [
      'JOB DESCRIPTION:',
      job.description || '(no description available)',
      '',
      'TITLE:', job.title,
      '',
      'BASE RESUME:',
      profile.base_resume_text,
    ].join('\n')
  );

  let raw: string;
  try {
    raw = await callAI(RESUME_TAILOR_SYSTEM, user, { maxTokens: 3000, temperature: 0.4 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `AI call failed: ${msg}` }, { status: 502 });
  }
  if (!raw || !raw.trim()) {
    return NextResponse.json({ error: 'AI returned an empty resume.' }, { status: 502 });
  }

  let data: ResumeData;
  try {
    data = parseResumeJson(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `AI returned invalid JSON: ${msg}` }, { status: 502 });
  }

  // Render + persist the PDF for download.
  let pdfUrl: string | null = null;
  try {
    const buf = await renderResumePdf(data);
    const rel = newStoragePath('tailored', 'pdf');
    await writeStorage(rel, buf);
    pdfUrl = rel;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `PDF render failed: ${msg}` }, { status: 500 });
  }

  const resumeText = buildResumeText(data);
  await db.updateJob(jobId, {
    tailored_resume: resumeText,
    tailored_resume_pdf_url: pdfUrl,
    status: 'tailored',
  });

  return NextResponse.json({ tailored_resume: resumeText, tailored_resume_pdf_url: pdfUrl });
}

// --- helpers ---------------------------------------------------------------

function buildResumeText(d: ResumeData): string {
  const lines: string[] = [d.name, d.title, d.contact, '', 'SUMMARY', ...d.summary, 'EXPERIENCE'];
  for (const e of d.experience) {
    lines.push(`${e.role} - ${e.company} (${e.dates})`);
    lines.push(...e.bullets.map((b) => `- ${b}`));
  }
  lines.push('SKILLS', ...d.skills);
  return lines.join('\n');
}

// Extract the first valid JSON object from the model's raw output.
function parseResumeJson(raw: string): ResumeData {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();

  const start = text.indexOf('{');
  if (start === -1) throw new Error('no object found');
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') inStr = !inStr;
    if (!inStr) {
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
  }
  if (end === -1) throw new Error('unbalanced braces');

  const obj = JSON.parse(text.slice(start, end));
  const toArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => String(x || '').trim()).filter(Boolean) : [];

  const data: ResumeData = {
    name: String(obj.name || '').trim(),
    title: String(obj.title || '').trim(),
    contact: String(obj.contact || '').trim(),
    summary: toArr(obj.summary),
    experience: Array.isArray(obj.experience)
      ? obj.experience
          .map((e: any) => ({
            role: String(e?.role || '').trim(),
            company: String(e?.company || '').trim(),
            dates: String(e?.dates || '').trim(),
            bullets: toArr(e?.bullets),
          }))
          .filter((r: any) => r.company || r.role)
      : [],
    skills: toArr(obj.skills),
  };
  if (!data.name && data.experience.length === 0) throw new Error('missing name/experience');
  return data;
}
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { callAI, RESUME_TAILOR_SYSTEM } from '@/lib/ai';
import { renderResumePdf, type ResumeData, type ResumePreset } from '@/lib/resume-pdf';
import { newStoragePath, writeStorage } from '@/lib/storage';
import { isUuid } from '@/lib/validate';

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
  if (!isUuid(jobId)) {
    return NextResponse.json({ error: 'jobId must be a valid uuid' }, { status: 400 });
  }

  const job = await db.getJob(jobId);
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

  if (session.user.role === 'worker') {
    if (!(await db.workerHasClient(session.user.id, job.profile_id))) {
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
  // Build the prompt. The BASE RESUME is the critical input — it must not be
  // truncated or the model will drop/invent employers. So the JD is clipped if
  // needed, but the resume is always sent whole. (The AI call has retries, so a
  // slightly larger payload is acceptable; a truncated resume causes HALLUCINATED
  // company names — far worse.)
  function cap(s: string, n: number): string {
    return s && s.length > n ? s.slice(0, n) + '\n…' : s;
  }
  const jdInline = cap(job.description || '(no description available)', 4000);
  // If the Resume Lab has structured content (incl. per-experience bullet
  // counts), inject it as the authoritative source + tell the AI the exact
  // bullet count required for each experience entry (in order).
  const structured = profile.resume_data;
  let structuredBlock = '';
  let bulletRuleBlock = '';
  if (structured && structured.experience && structured.experience.length) {
    structuredBlock = [
      'STRUCTURED RESUME (user-edited content — use this as authoritative):',
      `Title: ${structured.contact?.title || ''}`,
      `Summary: ${structured.summary || ''}`,
    ].join('\n');
    if (structured.experience.length > 0) {
      structuredBlock += '\nExperience (keep these companies/roles; order matters):';
      structured.experience.forEach((e, i) => {
        structuredBlock += `\n  ${i + 1}. ${e.role || ''} @ ${e.company || ''} (${e.dates || ''})`;
      });
    }
    if (structured.education && structured.education.length > 0) {
      structuredBlock += '\nEducation:';
      structured.education.forEach((e) => {
        structuredBlock += `\n  - ${e.degree || ''}${e.school ? ` @ ${e.school}` : ''}${e.dates ? ` (${e.dates})` : ''}`;
      });
    }
    if (structured.certifications && structured.certifications.length > 0) {
      structuredBlock += '\nCertifications:';
      structured.certifications.forEach((cr) => {
        structuredBlock += `\n  - ${cr.name || ''}${cr.issuer ? ` (${cr.issuer})` : ''}`;
      });
    }
    // Bullet-point counts per experience entry, in order.
    const counts = structured.experience.map((e) => Math.max(0, Math.min(10, e.bullets?.length ?? 0)));
    bulletRuleBlock =
      'BULLET-POINT REQUIREMENT (STRICT — must comply exactly): ' +
      counts.map((n, i) => `experience #${i + 1} must have exactly ${n} bullet points`).join('; ') +
      '. Do not add or drop bullets beyond this count for each entry.';
  }
  const user = [
    'JOB DESCRIPTION:',
    jdInline,
    '',
    'TITLE:', job.title,
    '',
    'BASE RESUME:',
    profile.base_resume_text,
    '',
    structuredBlock,
    '',
    bulletRuleBlock,
  ].filter((l) => l.trim() !== '').join('\n');

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

  // Enforce the Resume Lab's configured bullet counts on the AI output, so a
  // tailored PDF reflects the editor (e.g. 9/8/5 bullets per experience entry).
  // Matches by company name (case-insensitive) since the model may reorder.
  if (profile.resume_data?.experience?.length) {
    try {
      data = enforceBulletCounts(data, profile.resume_data.experience);
    } catch (e) {
      // Non-fatal: if enforcement fails, keep the AI output rather than erroring.
      console.warn('[tailor] bullet-count enforcement skipped:', (e as Error).message);
    }
  }

  // Render + persist the PDF for download, honoring the client's design preset.
  let pdfUrl: string | null = null;
  try {
    const preset = (profile.resume_design || 'classic') as ResumePreset;
    const buf = await renderResumePdf(data, preset);
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
  if (d.education && d.education.length) {
    lines.push('EDUCATION');
    for (const e of d.education) lines.push(`${e.degree} - ${e.school} (${e.dates})${e.detail ? ` - ${e.detail}` : ''}`);
  }
  if (d.certifications && d.certifications.length) {
    lines.push('CERTIFICATIONS');
    for (const c of d.certifications) lines.push(`${c.name}${c.issuer ? ` - ${c.issuer}` : ''}${c.year ? ` (${c.year})` : ''}`);
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
    education: Array.isArray(obj.education)
      ? obj.education
          .map((e: any) => ({
            school: String(e?.school || '').trim(),
            degree: String(e?.degree || '').trim(),
            dates: String(e?.dates || '').trim(),
            detail: String(e?.detail || '').trim(),
          }))
          .filter((r: any) => r.school || r.degree)
      : [],
    certifications: Array.isArray(obj.certifications)
      ? obj.certifications
          .map((c: any) => ({
            name: String(c?.name || '').trim(),
            issuer: String(c?.issuer || '').trim(),
            year: String(c?.year || '').trim(),
          }))
          .filter((r: any) => r.name)
      : [],
    skills: toArr(obj.skills),
  };
  if (!data.name && data.experience.length === 0) throw new Error('missing name/experience');
  return data;
}

// Force each AI-tailored experience entry to carry the exact bullet-point count
// configured in the Resume Lab (profiles.resume_data.experience[].bullets.length).
// Companies/roles are matched case-insensitively because the model may reorder
// or relabel entries; entries that can't be matched keep their current bullets.
function enforceBulletCounts(
  data: ResumeData,
  configured: { role?: string; company?: string; bullets?: string[] }[]
): ResumeData {
  // Normalize a company/role string for fuzzy matching.
  const norm = (s?: string) =>
    (s || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();
  const desiredByCompany = new Map<string, number>();
  for (const c of configured) {
    if (!c.bullets) continue;
    const key = norm(c.company) || norm(c.role);
    if (key) desiredByCompany.set(key, c.bullets.length);
  }

  const experience = data.experience.map((e) => {
    const key = norm(e.company) || norm(e.role);
    const desired = desiredByCompany.get(key);
    if (!desired || desired <= 0) return e; // no config for this entry — leave it
    const bullets = e.bullets || [];
    // Build exactly `desired` bullets: reuse existing text up to that count,
    // pad with blanks if the model gave fewer, drop extras if it gave more.
    const enforced = Array.from({ length: desired }, (_, k) => bullets[k] ?? '').filter((b) => b.trim() !== '');
    // If we trimmed blanks and dropped below desired, pad with a placeholder so
    // the count is exact and the editor can fill the blanks.
    while (enforced.length < desired) enforced.push('');
    return { ...e, bullets: enforced };
  });

  return { ...data, experience };
}
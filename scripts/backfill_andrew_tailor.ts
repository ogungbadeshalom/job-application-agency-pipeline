/* Backfill: tailor Andrew Pendergrass's base resume for every applied job that has
 * no tailored resume yet. Replicates app/api/tailor/route.ts logic using the same
 * production modules (callAI, RESUME_TAILOR_SYSTEM, renderResumePdf, storage,
 * db) so output matches exactly what the worker's Tailor button produces. */
import { db } from '../db/repo';
import { callAI, RESUME_TAILOR_SYSTEM } from '../lib/ai';
import { renderResumePdf, type ResumeData, type ResumePreset } from '../lib/resume-pdf';
import { newStoragePath, writeStorage } from '../lib/storage';

const PROFILE_ID = '022137cc-3978-4b4a-9e0a-54f3235f08d9'; // Andrew

function cap(s: string, n: number): string {
  return s && s.length > n ? s.slice(0, n) + '\n…' : s;
}

// Replicated from app/api/tailor/route.ts
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

async function main() {
  const profile = await db.getProfile(PROFILE_ID);
  if (!profile?.base_resume_text) throw new Error('Andrew has no base resume text');
  console.log(`Andrew base resume: ${profile.base_resume_text.length} chars | design=${profile.resume_design || 'classic'}`);

  // Re-tailor ALL of Andrew's applied jobs from the CURRENT WEEK (Mon onward).
  // This regenerates them with the fixed skills-preserving prompt, replacing the
  // condensed skills from the old prompt. Scope = week only, so we don't burn
  // hours re-tailoring his full 1,100+ history.
  const weekStart = new Date();
  weekStart.setHours(0, 0, 0, 0);
  const dow = (weekStart.getDay() + 6) % 7; // Mon=0
  weekStart.setDate(weekStart.getDate() - dow);

  const all = await db.listJobs({ profile_id: PROFILE_ID, status: 'applied' });
  const targets = all.filter((j) => {
    if (!j.submitted_at) return false;
    const d = new Date(j.submitted_at);
    return d >= weekStart;
  });
  console.log(`applied jobs: ${all.length} | this week (retailor): ${targets.length} (from ${weekStart.toISOString().slice(0,10)})\n`);

  let ok = 0, fail = 0;
  for (const job of targets) {
    const jdInline = cap(job.description || '(no description available)', 4000);
    const user = [
      'JOB DESCRIPTION:', jdInline, '',
      'TITLE:', job.title, '',
      'BASE RESUME:', profile.base_resume_text,
    ].filter((l) => String(l).trim() !== '').join('\n');

    try {
      const raw = await callAI(RESUME_TAILOR_SYSTEM, user, { maxTokens: 3000, temperature: 0.4 });
      if (!raw || !raw.trim()) throw new Error('empty AI output');
      const data = parseResumeJson(raw);
      const preset = (profile.resume_design || 'classic') as ResumePreset;
      const buf = await renderResumePdf(data, preset);
      const rel = newStoragePath('tailored', 'pdf');
      await writeStorage(rel, buf);
      const resumeText = buildResumeText(data);
      await db.updateJob(job.id, {
        tailored_resume: resumeText,
        tailored_resume_pdf_url: rel,
        // NOTE: do NOT change status here. These are already-applied jobs;
        // demoting to 'tailored' would drop them from the applied count and
        // misplace proofs. Backfill only adds the resume; status stays 'applied'.
      });
      ok++;
      console.log(`[ok] ${job.company || '?'} | ${job.title}`);
    } catch (e) {
      fail++;
      console.error(`[FAIL] ${job.company || '?'} | ${job.title}: ${e instanceof Error ? e.message : e}`);
    }
    // Small pause between calls to be gentle on the API.
    await new Promise((r) => setTimeout(r, 250));
  }

  console.log(`\nDONE. tailored=${ok} failed=${fail}`);
  process.exit(fail > 0 && ok === 0 ? 1 : 0);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
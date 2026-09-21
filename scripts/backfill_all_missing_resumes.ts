/* Backfill tailored resumes for every APPLIED job that is missing one, across
 * all profiles. Uses each job's owning profile's base resume. Idempotent-safe:
 * skips jobs that already have a resume. Preserves status='applied' (does not
 * demote), so proofs + applied counts stay intact. */
import { db } from '../db/repo';
import { callAI, RESUME_TAILOR_SYSTEM } from '../lib/ai';
import { renderResumePdf, type ResumeData, type ResumePreset } from '../lib/resume-pdf';
import { newStoragePath, writeStorage } from '../lib/storage';

function cap(s: string, n: number): string {
  return s && s.length > n ? s.slice(0, n) + '\n…' : s;
}

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
  return {
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
  const { query } = await import('../db/pool');

  // All applied jobs missing a resume, grouped by profile.
  const res = await query(`
    select profile_id, count(*)::int as n
    from jobs
    where status='applied' and (tailored_resume is null or tailored_resume='')
    group by profile_id order by n desc`);
  const groups = res.rows as { profile_id: string; n: number }[];
  console.log(`profiles with missing resumes: ${groups.length} | total missing: ${groups.reduce((a, r) => a + r.n, 0)}\n`);

  let ok = 0, fail = 0;
  for (const g of groups) {
    const profile = await db.getProfile(g.profile_id);
    if (!profile?.base_resume_text) {
      console.log(`[SKIP] profile ${g.profile_id} has no base resume — skipping ${g.n} jobs`);
      continue;
    }
    console.log(`== profile: ${profile.name} | ${g.n} jobs to tailor ==`);

    const jobs = await db.listJobs({ profile_id: g.profile_id, status: 'applied' });
    const targets = jobs.filter((j) => !j.tailored_resume || j.tailored_resume.trim() === '');
    const preset = (profile.resume_design || 'classic') as ResumePreset;

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
        const buf = await renderResumePdf(data, preset);
        const rel = newStoragePath('tailored', 'pdf');
        await writeStorage(rel, buf);
        await db.updateJob(job.id, {
          tailored_resume: buildResumeText(data),
          tailored_resume_pdf_url: rel, // status intentionally unchanged
        });
        ok++;
      } catch (e) {
        fail++;
        console.error(`[FAIL] ${job.company || '?'} | ${job.title}: ${e instanceof Error ? e.message : e}`);
      }
      await new Promise((r) => setTimeout(r, 250)); // gentle on the API
    }
    console.log(`  done ${g.profile_id}: ok so far ${ok} | fail so far ${fail}\n`);
  }

  console.log(`\nDONE. tailored=${ok} failed=${fail}`);
  process.exit(fail > 0 && ok === 0 ? 1 : 0);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
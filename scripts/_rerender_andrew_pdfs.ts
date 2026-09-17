import { db } from '../db/repo';
import { renderResumePdf, type ResumeData, type ResumePreset } from '../lib/resume-pdf';
import { newStoragePath, writeStorage } from '../lib/storage';
const PROFILE='022137cc-3978-4b4a-9e0a-54f3235f08d9';

// Parse the stored PLAIN-TEXT tailored resume (buildResumeText format) back into
// ResumeData so we can re-render the PDF with the skills section (the old PDF
// renderer dropped skills when technicalSkills was absent).
function parseText(txt: string): ResumeData {
  const lines = (txt || '').split('\n').map((l) => l.trimEnd());
  const idx = (h: string) => lines.findIndex((l) => l.trim().toUpperCase() === h);
  const sections: Record<string, string[]> = {};
  const heads = ['SUMMARY', 'EXPERIENCE', 'EDUCATION', 'CERTIFICATIONS', 'SKILLS'];
  const present = heads.filter((h) => idx(h) >= 0);
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i];
    const s = idx(h);
    if (s < 0) { sections[h] = []; continue; }
    // End boundary = next PRESENT header after this one (a missing section like
    // CERTIFICATIONS must not zero out everything after it), else end-of-lines.
    const later = present.find((p) => idx(p) > s);
    const e = later !== undefined ? idx(later) : lines.length;
    sections[h] = lines.slice(s + 1, e).filter((l) => l.trim());
  }
  // EXPERIENCE block: "Role - Company (dates)" then bullet lines "- ..."
  const experience = [];
  let cur: any = null;
  for (const l of sections['EXPERIENCE']) {
    if (l.startsWith('- ')) {
      if (cur) cur.bullets.push(l.slice(2));
    } else {
      if (cur) experience.push(cur);
      const m = l.match(/^(.*?)\s*-\s*(.*?)\s*\(([^)]*)\)\s*$/);
      cur = m ? { role: m[1].trim(), company: m[2].trim(), dates: m[3].trim(), bullets: [] }
              : { role: l, company: '', dates: '', bullets: [] };
    }
  }
  if (cur) experience.push(cur);
  // EDUCATION block: "Degree - School (dates) - detail" or "Degree - School (dates)"
  const education = sections['EDUCATION'].map((l) => {
    const m = l.match(/^(.*?)\s*-\s*(.*?)\s*\(([^)]*)\)(?:\s*-\s*(.*))?$/);
    return m ? { degree: m[1].trim(), school: m[2].trim(), dates: m[3].trim(), detail: (m[4] || '').trim() }
             : { degree: l, school: '', dates: '', detail: '' };
  });
  const certifications = sections['CERTIFICATIONS'].map((l) => {
    const m = l.match(/^(.*?)\s*-\s*(.*?)\s*\(([^)]*)\)\s*$/);
    return m ? { name: m[1].trim(), issuer: m[2].trim(), year: m[3].trim() }
             : { name: l, issuer: '', year: '' };
  });
  return {
    name: lines[0] || '',
    title: lines[1] || '',
    contact: lines[2] || '',
    summary: sections['SUMMARY'],
    experience,
    education,
    certifications,
    skills: sections['SKILLS'],
  };
}

async function main() {
  const p = await db.getProfile(PROFILE);
  const preset = (p!.resume_design || 'classic') as ResumePreset;
  const all = await db.listJobs({ profile_id: PROFILE, status: 'applied' });
  const weekStart = new Date(); weekStart.setHours(0,0,0,0); const dow=(weekStart.getDay()+6)%7; weekStart.setDate(weekStart.getDate()-dow);
  const targets = all.filter((j) => j.submitted_at && new Date(j.submitted_at) >= weekStart);
  console.log(`re-render ${targets.length} PDFs | preset=${preset}`);
  let ok = 0, fail = 0;
  for (const job of targets) {
    try {
      const data = parseText(job.tailored_resume || '');
      if (!data.experience.length && !data.summary.length) throw new Error('unparsable resume text');
      const buf = await renderResumePdf(data, preset);
      const rel = newStoragePath('tailored', 'pdf');
      await writeStorage(rel, buf);
      await db.updateJob(job.id, { tailored_resume_pdf_url: rel });
      ok++;
    } catch (e) {
      fail++;
      console.error(`[FAIL] ${job.company} | ${job.title}: ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log(`DONE ok=${ok} fail=${fail}`);
  process.exit(fail > 0 && ok === 0 ? 1 : 0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
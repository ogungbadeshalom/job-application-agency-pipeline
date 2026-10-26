// Extract plain text from an uploaded resume file (PDF or DOCX).
// Server-only. Used by the resume upload flow.
//
// pdf-parse v2 API: new PDFParse({ data: Uint8Array }).getText() -> { text }

type PDFParseType = {
  new (options: { data: Uint8Array }): { getText(): Promise<{ text: string }> };
};

export async function extractResumeText(
  buffer: Buffer,
  mimetype: string
): Promise<string> {
  if (mimetype === 'application/pdf') {
    try {
      const mod = (await import('pdf-parse')) as unknown as { PDFParse: PDFParseType };
      const parser = new mod.PDFParse({ data: new Uint8Array(buffer) });
      const result = await parser.getText();
      return (result.text || '').trim();
    } catch (e) {
      throw new Error(`PDF parse failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  const isDocx =
    mimetype ===
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (isDocx) {
    const mammoth = (await import('mammoth')).default;
    const result = await mammoth.extractRawText({ buffer });
    return (result.value || '').trim();
  }

  // Plain text fallback.
  return buffer.toString('utf-8').trim();
}

// --- Rebuild ResumeData from a stored tailored-resume text ------------------
//
// buildResumeText (app/api/tailor/route.ts) is the canonical storage format:
//   name / title / contact / '' / SUMMARY / paragraphs / EXPERIENCE /
//   "Role - Company (dates)" + "- bullet" lines / [EDUCATION] / [CERTIFICATIONS] / SKILLS
// Parsing it back lets downloads re-render with the profile's CURRENT design
// preset, so what the client downloads always matches the Resume Lab preview.
import type { ResumeData } from './resume-pdf';

export function resumeTextToData(text: string): ResumeData | null {
  const lines = text.replace(/\r/g, '').split('\n');
  const sum = lines.indexOf('SUMMARY');
  if (sum < 1) return null; // must have name/title/contact + SUMMARY
  const name = lines.slice(0, sum)[0]?.trim() || '';
  const rest = lines.slice(0, sum).slice(1);
  const title = rest[0]?.trim() || '';
  const contact = rest.slice(1).filter((l) => l.trim()).join(' · ');
  if (!name) return null;

  const section: Record<string, string[]> = { SUMMARY: [], EXPERIENCE: [], EDUCATION: [], CERTIFICATIONS: [], SKILLS: [] };
  let cur = 'SUMMARY';
  for (const l of lines.slice(sum + 1)) {
    const t = l.trim();
    if (t === 'EXPERIENCE' || t === 'EDUCATION' || t === 'CERTIFICATIONS' || t === 'SKILLS') { cur = t; continue; }
    section[cur].push(l);
  }

  const summary = section.SUMMARY.map((l) => l.trim()).filter(Boolean);

  const experience: ResumeData['experience'] = [];
  let entry: { role: string; company: string; dates: string; bullets: string[] } | null = null;
  for (const raw of section.EXPERIENCE) {
    const t = raw.trim();
    if (!t) continue;
    if (t.startsWith('- ')) {
      if (entry) entry.bullets.push(t.slice(2).trim());
      continue;
    }
    const m = t.match(/^(.+?)\s+-\s+(.+?)(?:\s+\(([^)]*)\))?$/);
    if (m) {
      if (entry) experience.push(entry);
      entry = { role: m[1].trim(), company: m[2].trim(), dates: (m[3] || '').trim(), bullets: [] };
    } else if (entry) {
      entry.bullets.push(t); // stray line: keep content rather than lose it
    }
  }
  if (entry) experience.push(entry);

  const education = section.EDUCATION.map((t) => {
    const m = t.trim().match(/^(.+?)\s+-\s+(.+?)(?:\s+\(([^)]*)\))?(?:\s+-\s+(.*))?$/);
    return m
      ? { degree: m[1].trim(), school: m[2].trim(), dates: (m[3] || '').trim(), detail: (m[4] || '').trim() }
      : { school: t.trim(), degree: '', dates: '', detail: '' };
  }).filter((e) => e.school || e.degree);

  const certifications = section.CERTIFICATIONS.map((t) => {
    const m = t.trim().match(/^(.+?)(?:\s+-\s+(.+?))?(?:\s+\(([^)]*)\))?$/);
    return { name: (m?.[1] || t).trim(), issuer: (m?.[2] || '').trim(), year: (m?.[3] || '').trim() };
  }).filter((c) => c.name);

  const skills = section.SKILLS.map((l) => l.trim()).filter(Boolean);
  return { name, title, contact, summary, experience, education, certifications, skills };
}

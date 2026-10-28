// Core "tailor a base resume against a job description" logic, shared by the
// client-facing "Test resume generation" route. Mirrors the worker tailor
// (lib/ai prompts + ATS gate with one regen under 70) WITHOUT the PDF render,
// experience-variation and bullet-enforcement passes — this is a quality demo,
// not a submittable application. Fail-open: never throws on scoring issues.

import { callAI, RESUME_TAILOR_SYSTEM, RESUME_ATS_SYSTEM } from '@/lib/ai';
import { parseAtsScore } from '@/lib/ats';
import type { AtsScore } from '@/lib/types';
import type { ResumeData } from '@/lib/resume-pdf';

export interface TailorTestResult {
  text: string;
  atsScore: number | null;
  feedback: AtsScore | null;
  atsScoreAfterRegen?: number | null;
}

function cap(s: string, n: number): string {
  return s && s.length > n ? s.slice(0, n) + '\n…' : s;
}

export async function generateTailoredResume(opts: {
  baseResumeText: string;
  resumeData?: {
    summary?: string;
    experience?: { role?: string; company?: string; dates?: string; bullets?: string[] }[];
    education?: { degree?: string; school?: string; dates?: string }[];
    certifications?: { name?: string; issuer?: string; year?: string }[];
  } | null;
  jobTitle: string;
  description: string;
}): Promise<TailorTestResult> {
  const jdInline = cap(opts.description || '(no description available)', 4000);

  let structuredBlock = '';
  let bulletRuleBlock = '';
  const st = opts.resumeData;
  if (st && st.experience && st.experience.length) {
    structuredBlock = [
      'STRUCTURED RESUME (user-edited content — use this as authoritative):',
      `Summary: ${st.summary || ''}`,
    ].join('\n');
    structuredBlock += '\nExperience (keep these companies/roles; order matters):';
    st.experience.forEach((e, i) => {
      structuredBlock += `\n  ${i + 1}. ${e.role || ''} @ ${e.company || ''} (${e.dates || ''})`;
    });
    if (st.education?.length) {
      structuredBlock += '\nEducation:';
      st.education.forEach((e) => {
        structuredBlock += `\n  - ${e.degree || ''}${e.school ? ` @ ${e.school}` : ''}${e.dates ? ` (${e.dates})` : ''}`;
      });
    }
    const counts = st.experience.map((e) => Math.max(0, Math.min(10, e.bullets?.length ?? 0)));
    bulletRuleBlock =
      'BULLET-POINT REQUIREMENT (STRICT — must comply exactly): ' +
      counts.map((n, i) => `experience #${i + 1} must have exactly ${n} bullet points`).join('; ') +
      '. Do not add or drop bullets beyond this count for each entry.';
  }

  const user = [
    'JOB DESCRIPTION:',
    jdInline,
    '',
    'TITLE:', opts.jobTitle,
    '',
    'BASE RESUME:',
    opts.baseResumeText,
    '',
    structuredBlock,
    '',
    bulletRuleBlock,
  ].filter((l) => l.trim() !== '').join('\n');

  const tailorOnce = (u: string, temp: number) => callAI(RESUME_TAILOR_SYSTEM, u, { maxTokens: 6000, temperature: temp });

  let raw: string;
  try {
    raw = await tailorOnce(user, 0.4);
  } catch {
    raw = await tailorOnce(user, 0.4);
  }
  if (!raw || !raw.trim()) throw new Error('AI returned an empty resume.');
  let data = parseResumeJson(raw);

  const scoreText = (d: ResumeData) =>
    ['JOB DESCRIPTION:', cap(opts.description || '(no description available)', 4000), '', 'TITLE:', opts.jobTitle, '', 'RESUME:', buildResumeText(d)].join('\n');

  let atsScore: number | null = null;
  let feedback: AtsScore | null = null;
  let atsScoreAfterRegen: number | null = null;
  try {
    const s1 = parseAtsScore(await callAI(RESUME_ATS_SYSTEM, scoreText(data), { maxTokens: 3000, temperature: 0.2 }));
    atsScore = s1.overallScore;
    feedback = s1;
    if ((s1.overallScore ?? 0) < 70) {
      const gaps = (s1.missingSkills ?? []).slice(0, 12).join(', ') || 'keyword coverage and requirement evidence';
      const fixUser = user + '\n\nIMPROVEMENT DIRECTIVE: a previous tailored version of this resume scored ' +
        s1.overallScore + '/100 on a strict ATS scan. Regenerate, fixing these concrete gaps: ' + gaps +
        '. Cover every hard requirement the JD lists using ONLY the candidate\u2019s real experience, reworded to the job\u2019s exact terminology. All other rules unchanged.';
      try {
        const raw3 = await tailorOnce(fixUser, 0.5);
        const data3 = parseResumeJson(raw3);
        const s2 = parseAtsScore(await callAI(RESUME_ATS_SYSTEM, scoreText(data3), { maxTokens: 3000, temperature: 0.2 }));
        atsScoreAfterRegen = s2.overallScore;
        if ((s2.overallScore ?? 0) > (s1.overallScore ?? 0)) {
          data = data3;
          atsScore = s2.overallScore;
          feedback = s2;
        }
      } catch {
        // keep the first version; demo stays fail-open
      }
    }
  } catch {
    // scoring is best-effort
  }

  return { text: buildResumeText(data), atsScore, feedback, atsScoreAfterRegen };
}

// --- shared helpers (kept local; self-contained so the worker route is untouched) ---

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
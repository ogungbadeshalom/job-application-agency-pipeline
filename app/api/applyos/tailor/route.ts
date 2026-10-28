import { NextResponse } from 'next/server';
import { query } from '@/db/pool';
import { bindAndMeter, consumeTailor } from '@/lib/applyos';
import { callAI, RESUME_TAILOR_SYSTEM, RESUME_ATS_SYSTEM } from '@/lib/ai';
import { parseAtsScore } from '@/lib/ats';
import { renderResumePdf, type ResumeData, type ResumePreset } from '@/lib/resume-pdf';
import type { AtsScore } from '@/lib/types';

// POST /api/applyos/tailor  (desktop app, license-key auth)
// Body: { key, machine, jdText, jobTitle, baseResumeText, contact: {name,email,phone,location} }
// Returns: { pdfBase64, atsScore, meterSource, tailorRemaining }
// Meter enforcement lives HERE: tier meter first, then oldest credit pack.
// This is the ONE endpoint that costs us money — the meter is non-negotiable.

const cap = (s: string, n: number) => (s && s.length > n ? s.slice(0, n) + '\n…' : s);

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const key = String(body.key || '');
  const machine = String(body.machine || '');
  const jdText = String(body.jdText || '');
  const jobTitle = String(body.jobTitle || '');
  const baseResumeText = String(body.baseResumeText || '');
  const contact = (body.contact || {}) as { name?: string; email?: string; phone?: string; location?: string };

  if (!key || !jdText || !baseResumeText) {
    return NextResponse.json({ error: 'key, jdText and baseResumeText are required' }, { status: 400 });
  }

  // License + meter check BEFORE spending tokens.
  const gate = await bindAndMeter(key, machine);
  if (!gate.ok) return NextResponse.json({ error: gate.reason }, { status: gate.status });

  const user = [
    'JOB DESCRIPTION:', cap(jdText, 4000), '',
    'TITLE:', jobTitle, '',
    'BASE RESUME:', cap(baseResumeText, 12000), '',
    `Candidate contact (use for the contact fields): ${contact.name || ''} | ${contact.email || ''} | ${contact.phone || ''} | ${contact.location || ''}`,
  ].join('\n');

  let data: ResumeData;
  let ats: AtsScore | null = null;
  try {
    // Two attempts at generation, then the ATS gate with one feedback regen —
    // same quality loop as the agency tailor route, metered before spend.
    let raw = await callAI(RESUME_TAILOR_SYSTEM, user, { maxTokens: 6000, temperature: 0.4 });
    try {
      data = parseResumeJson(raw);
    } catch {
      raw = await callAI(RESUME_TAILOR_SYSTEM, user, { maxTokens: 6000, temperature: 0.3 });
      data = parseResumeJson(raw);
    }

    try {
      const resumeText = buildResumeText(data);
      const s = parseAtsScore(
        await callAI(RESUME_ATS_SYSTEM, ['JOB DESCRIPTION:', cap(jdText, 4000), '', 'TITLE:', jobTitle, '', 'RESUME:', resumeText].join('\n'),
          { maxTokens: 3000, temperature: 0.2 })
      );
      ats = s;
      if (s.overallScore < 70) {
        const fix = user + '\n\nIMPROVEMENT DIRECTIVE: a previous version scored ' + s.overallScore +
          '/100 on a strict ATS scan. Fix these gaps: ' +
          ((s.missingSkills || []).slice(0, 12).join(', ') || 'keyword coverage') +
          '. Use ONLY the candidate\u2019s real experience, reworded to the job\u2019s terminology.';
        const raw3 = await callAI(RESUME_TAILOR_SYSTEM, fix, { maxTokens: 6000, temperature: 0.5 });
        const data3 = parseResumeJson(raw3);
        const s2 = parseAtsScore(
          await callAI(RESUME_ATS_SYSTEM, ['JOB DESCRIPTION:', cap(jdText, 4000), '', 'TITLE:', jobTitle, '', 'RESUME:', buildResumeText(data3)].join('\n'),
            { maxTokens: 3000, temperature: 0.2 })
        );
        if (s2.overallScore > s.overallScore) { data = data3; ats = s2; }
      }
    } catch (e) {
      console.warn('[applyos/tailor] ATS pass skipped:', (e as Error).message);
    }

    // Meter consumed only after a successful generation.
    const source = await consumeTailor(key);
    if (source === 'exhausted') {
      return NextResponse.json({ error: 'meter-exhausted', hint: 'buy credits or upgrade tier' }, { status: 402 });
    }

    // Contact line from the caller's real profile data.
    const line = [contact.email, contact.phone, contact.location].filter(Boolean).join(' · ');
    if (line) data.contact = line;

    const preset = ((body.preset as string) || 'classic') as ResumePreset;
    const buf = await renderResumePdf(data, preset);

    const after = await bindAndMeter(key, machine);
    return NextResponse.json({
      pdfBase64: buf.toString('base64'),
      atsScore: ats?.overallScore ?? null,
      atsFeedback: ats,
      meterSource: source,
      tailorRemaining: after.ok ? after.tailorRemaining : 0,
      preset,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[applyos/tailor] failed:', msg);
    return NextResponse.json({ error: `tailoring failed: ${msg}` }, { status: 502 });
  }
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

function parseResumeJson(raw: string): ResumeData {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('no JSON object found');
  const obj = JSON.parse(text.slice(start, end + 1));
  const toArr = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x || '').trim()).filter(Boolean) : []);
  const data: ResumeData = {
    name: String(obj.name || '').trim(),
    title: String(obj.title || '').trim(),
    contact: String(obj.contact || '').trim(),
    summary: toArr(obj.summary),
    experience: Array.isArray(obj.experience)
      ? obj.experience.map((e: any) => ({
          role: String(e?.role || '').trim(),
          company: String(e?.company || '').trim(),
          dates: String(e?.dates || '').trim(),
          bullets: toArr(e?.bullets),
        })).filter((r: any) => r.company || r.role)
      : [],
    education: Array.isArray(obj.education)
      ? obj.education.map((e: any) => ({
          school: String(e?.school || '').trim(),
          degree: String(e?.degree || '').trim(),
          dates: String(e?.dates || '').trim(),
          detail: String(e?.detail || '').trim(),
        })).filter((r: any) => r.school || r.degree)
      : [],
    certifications: Array.isArray(obj.certifications)
      ? obj.certifications.map((c: any) => ({ name: String(c?.name || '').trim(), issuer: String(c?.issuer || '').trim(), year: String(c?.year || '').trim() }))
      : [],
    skills: toArr(obj.skills),
  };
  if (!data.name || !data.experience.length) throw new Error('incomplete resume JSON');
  return data;
}

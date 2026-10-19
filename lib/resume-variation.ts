// Experience-variation enforcement for tailored resumes.
//
// Requirement (Shalom, Oct 2026): the EXPERIENCE section must be different in
// every tailored resume — no two resumes for one client may share bullet
// phrasing, even when the same base-resume achievements are being reworded.
// Two layers:
//   1. The tailor system prompt carries a strict variation rule (lib/ai.ts).
//   2. This module is the post-generation gate: it compares the fresh output's
//      bullets against the client's EARLIER tailored resumes and, when too many
//      are verbatim duplicates, regenerates ONCE with an explicit variation
//      demand (higher temperature). Fail-open: any error keeps the original
//      output so tailoring never breaks over variation.

import { callAI, RESUME_TAILOR_SYSTEM } from './ai';
import { all } from '../db/pool';
import type { ResumeData } from './resume-pdf';

const DUP_THRESHOLD = 0.2; // >20% verbatim-duplicate bullets triggers a regen

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

function bulletsOf(data: ResumeData): { key: string; raw: string }[] {
  return data.experience.flatMap((e) => (e.bullets ?? []).map((b) => ({ key: norm(b), raw: b })));
}

// Collect normalized bullets + summary paragraphs from stored resume texts
// (buildResumeText format: summary paragraphs sit between SUMMARY and
// EXPERIENCE; bullets under EXPERIENCE start with "- " until EDUCATION).
function knownTexts(text: string): Set<string> {
  const set = new Set<string>();
  let section = '';
  for (const line of text.split('\n')) {
    const l = line.trim();
    if (l === 'SUMMARY' || l === 'EXPERIENCE' || l === 'EDUCATION' || l === 'CERTIFICATIONS' || l === 'SKILLS') { section = l; continue; }
    if (section === 'SUMMARY' && l.length > 25) set.add(norm(l));
    if (section === 'EXPERIENCE' && l.startsWith('- ') && l.length > 17) set.add(norm(l.slice(2)));
  }
  return set;
}

// Extract the first valid JSON object from the model's raw output.
function parseResumeJsonLoose(raw: string): ResumeData {
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
  return JSON.parse(text.slice(start, end)) as ResumeData;
}

export interface VariationResult {
  data: ResumeData;
  regenerated: boolean;
  dupRateBefore: number;
  dupRateAfter: number;
}

export async function enforceExperienceVariation(
  data: ResumeData,
  opts: { profileId: string; jobId?: string; userPrompt: string; maxTokens?: number }
): Promise<VariationResult> {
  try {
    const bulletEntries = bulletsOf(data).filter((b) => b.key.length > 15);
    const summaryEntries = (data.summary ?? [])
      .map((p) => ({ key: norm(p), raw: p }))
      .filter((p) => p.key.length > 25);
    const fresh = [...bulletEntries, ...summaryEntries];
    if (!fresh.length) return { data, regenerated: false, dupRateBefore: 0, dupRateAfter: 0 };

    const prevRows = await all(
      `select tailored_resume from jobs
        where profile_id = $1
          and ($2::uuid is null or id <> $2)
          and tailored_resume is not null and tailored_resume <> ''
        order by updated_at desc
        limit 40`,
      [opts.profileId, opts.jobId ?? null]
    );
    if (!prevRows.length) return { data, regenerated: false, dupRateBefore: 0, dupRateAfter: 0 };

    const seen = new Set<string>();
    for (const r of prevRows) knownTexts(String(r.tailored_resume)).forEach((b) => seen.add(b));

    const dupBefore = fresh.filter((b) => seen.has(b.key)).length;
    const rateBefore = dupBefore / fresh.length;
    if (rateBefore <= DUP_THRESHOLD) {
      return { data, regenerated: false, dupRateBefore: rateBefore, dupRateAfter: rateBefore };
    }

    // Too much reuse — regenerate with an explicit variation demand; up to
    // 2 attempts, keep the best (lowest-dup) result. Never worse than input.
    let best = { data, rate: rateBefore };
    for (let attempt = 1; attempt <= 2 && best.rate > DUP_THRESHOLD; attempt++) {
      const varUser =
        opts.userPrompt +
        `\n\nVARIATION REQUIREMENT (CRITICAL): a previous tailored resume for this candidate reused ${Math.round(best.rate * fresh.length)} of these experience bullets / summary paragraphs verbatim. Rewrite EVERY experience bullet AND every summary paragraph with fresh wording for THIS job: different sentence structures, different verb choices, re-selected achievements that matter for THIS posting, and this job's exact vocabulary. Bullets and summary paragraphs may carry the same facts and metrics, but the phrasing must be entirely new — no bullet or summary string may appear in any earlier resume for this candidate.`;

      const rawV = await callAI(RESUME_TAILOR_SYSTEM, varUser, { maxTokens: opts.maxTokens ?? 6000, temperature: attempt === 1 ? 0.7 : 0.9 });
      const dataV = parseResumeJsonLoose(rawV);
      const after = bulletsOf(dataV).filter((b) => b.key.length > 15);
      const dupAfter = after.filter((b) => seen.has(b.key)).length;
      const rateAfter = after.length ? dupAfter / after.length : 0;
      if (rateAfter < best.rate) best = { data: dataV, rate: rateAfter };
    }
    return { data: best.data, regenerated: best.data !== data, dupRateBefore: rateBefore, dupRateAfter: best.rate };
  } catch (e) {
    console.warn('[resume-variation] enforcement skipped:', e instanceof Error ? e.message : e);
    return { data, regenerated: false, dupRateBefore: -1, dupRateAfter: -1 };
  }
}

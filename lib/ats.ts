// Parse the AI's raw ATS-analysis output into a typed AtsScore. Robust to
// markdown fences and stray prose the model may add around the JSON object.
import type { AtsScore, ScoreGroup } from './types';

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
}

function scoreGroup(v: unknown): ScoreGroup {
  if (!v || typeof v !== 'object') return { score: 0, tips: [] };
  const o = v as Record<string, unknown>;
  const rawTips = Array.isArray(o.tips) ? o.tips : [];
  const tips = rawTips
    .map((t) => {
      const tip = t as Record<string, unknown>;
      const type = String(tip.type || '').toLowerCase();
      return {
        type: type === 'good' ? ('good' as const) : ('improve' as const),
        tip: String(tip.tip || '').trim(),
        explanation: tip.explanation ? String(tip.explanation).trim() : undefined,
      };
    })
    .filter((t) => t.tip);
  return { score: num(o.score), tips };
}

export function parseAtsScore(raw: string): AtsScore {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();

  const start = text.indexOf('{');
  if (start === -1) throw new Error('no JSON object found');
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

  const obj = JSON.parse(text.slice(start, end)) as Record<string, unknown>;
  const gu = (k: string): ScoreGroup => scoreGroup(obj[k]);
  const strArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => String(x || '')).filter(Boolean) : [];
  const toBool = (v: unknown): 'pass' | 'borderline' | 'fail' | undefined =>
    v === 'pass' || v === 'borderline' || v === 'fail' ? v : undefined;
  return {
    overallScore: num(obj.overallScore),
    ATS: gu('ATS'),
    toneAndStyle: gu('toneAndStyle'),
    content: gu('content'),
    structure: gu('structure'),
    skills: gu('skills'),
    matchingSkills: strArr(obj.matchingSkills),
    missingSkills: strArr(obj.missingSkills),
    matchingKeywords: strArr(obj.matchingKeywords),
    missingKeywords: strArr(obj.missingKeywords),
    booleanSearchResult: toBool(obj.booleanSearchResult),
    yearsOfExperience: typeof obj.yearsOfExperience === 'number' ? obj.yearsOfExperience : undefined,
    yearsRequired: typeof obj.yearsRequired === 'number' ? obj.yearsRequired : undefined,
    keyRecommendations: strArr(obj.keyRecommendations),
  };
}
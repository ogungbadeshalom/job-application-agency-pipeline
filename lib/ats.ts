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

/**
 * Produce candidate JSON substrings to try parsing an ATS object from model
 * output. The model may wrap the JSON in a markdown fence, prefix it with
 * prose, or truncate it. We return several balanced extraction candidates in
 * order of preference and let parseAtsScore take the first that parses.
 */
function extractJsonCandidates(raw: string): string[] {
  const out: string[] = [];
  const add = (s: string) => {
    const t = s.trim();
    if (t) out.push(t);
  };

  // 1) Code-fenced JSON: ```json ... ``` or ``` ... ```
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) add(fence[1]);

  // 2) Whole stripped text (grabs prose + JSON; the balanced scan below
  //    will zero in on the object).
  add(raw.replace(/`{3}[\s\S]*?`{3}/g, ''));

  // 3) The largest contiguous balanced JSON object starting at the first '{',
  //    found by scanning while respecting strings and escapes. If the closing
  //    brace is missing (truncated), fall back to the longest parseable prefix.
  const start = raw.indexOf('{');
  if (start !== -1) {
    let depth = 0,
      inStr = false,
      esc = false;
    let firstEnd = -1;
    for (let i = start; i < raw.length; i++) {
      const ch = raw[i];
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') inStr = !inStr;
      if (!inStr) {
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) { firstEnd = i + 1; break; }
        }
      }
    }
    if (firstEnd !== -1) {
      add(raw.slice(start, firstEnd));
    } else {
      // Unbalanced: no closing brace. Emit progressively-longer prefixes so a
      // JSON.parse can pick the longest valid truncated object (handles the
      // model cutting off its response mid-object).
      let d = 0,
        s = false,
        e = false;
      for (let i = start; i < raw.length; i++) {
        const ch = raw[i];
        if (e) { e = false; continue; }
        if (ch === '\\') { e = true; continue; }
        if (ch === '"') s = !s;
        if (!s) {
          if (ch === '{') d++;
          else if (ch === '}') d--;
        }
        if (d === 0 && i > start) add(raw.slice(start, i + 1));
      }
    }
  }

  return Array.from(new Set(out)); // dedupe, preserve order
}

export function parseAtsScore(raw: string): AtsScore {
  const candidates = extractJsonCandidates(raw);
  let obj: Record<string, unknown> | null = null;
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object' && 'overallScore' in parsed) {
        obj = parsed;
        break;
      }
    } catch {
      // try next candidate
    }
  }
  if (!obj) throw new Error('unbalanced braces');
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
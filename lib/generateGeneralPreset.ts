import { db } from '@/lib/db';
import { callAI } from '@/lib/ai';
import type { ProfilePreset } from '@/lib/types';

// Boards the auto-generated General preset uses (working boards only — no
// Indeed/WeworkRemotely/Remotive per policy).
const GENERAL_SITES = ['greenhouse', 'builtin', 'jobicy', 'workingnomads'];
const GENERAL_PRESET_NAME = 'General';

const SYSTEM = `You build search-title presets from a candidate resume for a job-search tool.
Return STRICT JSON only: a JSON array of exactly 10 job-title search strings that
this candidate could genuinely apply for (their most relevant/expected level first,
then adjacent roles they qualify for). Output real, specific titles. No prose, no
markdown fences.`;

function genId(): string {
  return 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'.replace(/x/g, () =>
    Math.floor(Math.random() * 16).toString(16)
  );
}

function parseSearchTerms(raw: string): string[] | null {
  const t = raw.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fence ? fence[1] : t).trim();
  const start = body.indexOf('[');
  const end = body.lastIndexOf(']');
  if (start === -1 || end === -1) return null;
  try {
    const arr = JSON.parse(body.slice(start, end + 1));
    if (!Array.isArray(arr)) return null;
    const terms = arr
      .map((x) => String(x ?? '').trim())
      .filter(Boolean)
      .slice(0, 10);
    return terms.length ? terms : null;
  } catch {
    return null;
  }
}

// Generate (or regenerate) the "General" preset for a profile from its resume.
// Replaces any existing "General" preset, keeps the others. Returns the new one.
export async function generateGeneralPreset(profileId: string): Promise<ProfilePreset | null> {
  const profile = await db.getProfile(profileId);
  if (!profile || !profile.base_resume_text) return null;

  let raw: string;
  try {
    raw = await callAI(SYSTEM, `Candidate resume:\n\n${profile.base_resume_text.slice(0, 12000)}`, {
      maxTokens: 800,
      temperature: 0.3,
    });
  } catch {
    return null;
  }
  const terms = parseSearchTerms(raw);
  if (!terms) return null;

  const presets: ProfilePreset[] = profile.presets ?? [];
  const other = presets.filter((p) => p.name !== GENERAL_PRESET_NAME);
  const general: ProfilePreset = {
    id: genId(),
    name: GENERAL_PRESET_NAME,
    search_terms: terms,
    sites: GENERAL_SITES,
    location: 'Remote',
    remote_only: true,
    results_wanted: 100,
  };
  await db.setProfilePresets(profileId, [...other, general]);
  return general;
}
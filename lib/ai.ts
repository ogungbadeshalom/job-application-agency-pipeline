// Single AI entrypoint: callAI(system, user, opts) -> string.
//
// Config (provider, model, base URL, API key) is read from app_config in
// Postgres first; falls back to env vars when no row exists (smooth migration
// during early bootstrap).
//
// Stub mode is still default; set AI_STUB=false + a real key to hit the model.

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { db } from './db';
import type { AppConfig } from './types';

export interface CallAIOptions {
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
  onChunk?: (chunk: string) => void;
}

// Per-process cache so we don't hit Postgres on every callAI.
// globalThis guard survives Next dev's module-graph splitting.
type CachedConfig = {
  provider: string;
  model: string;
  baseUrl: string | null;
  apiKey: string | null;
} | null;
const globalForAi = globalThis as unknown as { __jbAIConfig?: CachedConfig };

export function clearAIConfigCache(): void {
  globalForAi.__jbAIConfig = undefined;
}

// Read DB config (or null) and cache. Used internally.
async function loadConfig(): Promise<CachedConfig> {
  if (globalForAi.__jbAIConfig !== undefined) return globalForAi.__jbAIConfig;
  const cfg = await db.getAppConfig();
  globalForAi.__jbAIConfig = cfg
    ? {
        provider: cfg.ai_provider,
        model: cfg.ai_model,
        baseUrl: cfg.ai_base_url,
        apiKey: cfg.ai_api_key,
      }
    : null;
  return globalForAi.__jbAIConfig;
}

// Env fallback for any individual field missing from app_config.
function envValue(field: keyof AppConfig): string | null {
  const map: Record<string, string | undefined> = {
    ai_provider: process.env.AI_PROVIDER,
    ai_model: process.env.AI_MODEL,
    ai_base_url: process.env.AI_BASE_URL,
  };
  return map[field] ?? null;
}

export async function aiProvider(): Promise<string> {
  const c = await loadConfig();
  return c?.provider || envValue('ai_provider') || 'omniroute';
}

export async function aiModel(): Promise<string> {
  const c = await loadConfig();
  return c?.model || envValue('ai_model') || 'auto/best-coding';
}

export async function hasAnyKey(): Promise<boolean> {
  const c = await loadConfig();
  if (c?.apiKey && c.apiKey.length > 10) return true;
  const provider = c?.provider || envValue('ai_provider') || 'omniroute';
  if (provider === 'omniroute') return Boolean(process.env.OMNIROUTE_API_KEY);
  if (provider === 'anthropic') return Boolean(process.env.ANTHROPIC_API_KEY);
  if (provider === 'openrouter') return Boolean(process.env.OPENROUTER_API_KEY);
  return Boolean(process.env.AI_BASE_URL);
}

function stubEnabled(hasKey: boolean): boolean {
  if (process.env.AI_STUB === 'true') return true;
  if (process.env.AI_STUB === 'false') return false;
  return !hasKey;
}

// Simple in-memory response cache for repeated identical requests
const responseCache = new Map<string, { data: string; ts: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function cacheKey(system: string, user: string, opts: CallAIOptions): string {
  return `${system}|${user}|${JSON.stringify(opts)}`;
}

function getCached(key: string): string | null {
  const entry = responseCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    responseCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key: string, data: string): void {
  responseCache.set(key, { data, ts: Date.now() });
  // Prevent unbounded growth
  if (responseCache.size > 1000) {
    let oldestKey = '';
    let oldestTs = Infinity;
    responseCache.forEach((v, k) => {
      if (v.ts < oldestTs) {
        oldestTs = v.ts;
        oldestKey = k;
      }
    });
    if (oldestKey) responseCache.delete(oldestKey);
  }
}

export async function callAI(
  system: string,
  user: string,
  opts: CallAIOptions = {}
): Promise<string> {
  const { maxTokens = 1500, temperature = 0.4, stream, onChunk } = opts;
  const cfg = await loadConfig();
  const provider = cfg?.provider || envValue('ai_provider') || 'omniroute';
  const model = cfg?.model || envValue('ai_model') || 'auto/best-coding';
  const apiKey = cfg?.apiKey || process.env.OMNIROUTE_API_KEY || process.env.ANTHROPIC_API_KEY || '';

  const keyPresent = await hasAnyKey();
  if (stubEnabled(keyPresent)) {
    return stubResponse(system, user);
  }

  // Check cache first (non-streaming only)
  if (!stream) {
    const cached = getCached(cacheKey(system, user, opts));
    if (cached) return cached;
  }

  try {
    let result: string;
    if (provider === 'omniroute') {
      result = await callOpenAICompat({
        baseURL: 'https://pub.tailc86969.ts.net/v1',
        apiKey,
        model,
        system,
        user,
        maxTokens,
        temperature,
        stream,
        onChunk,
      });
    } else if (provider === 'anthropic') {
      result = await callAnthropic(system, user, model, maxTokens, temperature, apiKey);
    } else if (provider === 'openrouter') {
      result = await callOpenAICompat({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: cfg?.apiKey || process.env.OPENROUTER_API_KEY || '',
        model,
        system,
        user,
        maxTokens,
        temperature,
        stream,
        onChunk,
      });
    } else if (provider === 'deepseek') {
      result = await callOpenAICompat({
        baseURL: cfg?.baseUrl || 'https://api.deepseek.com/v1',
        apiKey: cfg?.apiKey || process.env.AI_API_KEY || '',
        model,
        system,
        user,
        maxTokens,
        temperature,
        stream,
        onChunk,
      });
    } else if (provider === 'custom') {
      result = await callOpenAICompat({
        baseURL: cfg?.baseUrl || envValue('ai_base_url') || process.env.AI_BASE_URL || '',
        apiKey: cfg?.apiKey || process.env.AI_API_KEY || 'ollama',
        model,
        system,
        user,
        maxTokens,
        temperature,
        stream,
        onChunk,
      });
    } else {
      throw new Error(`Unknown AI_PROVIDER: ${provider}`);
    }

    // Cache successful non-streaming responses
    if (!stream && result) {
      setCache(cacheKey(system, user, opts), result);
    }
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`AI call failed (${provider}/${model}): ${msg}`);
  }
}

async function callAnthropic(
  system: string,
  user: string,
  model: string,
  maxTokens: number,
  temperature: number,
  apiKey: string
): Promise<string> {
  const client = new Anthropic({ apiKey });
  const msg = await client.messages.create({
    model,
    max_tokens: maxTokens,
    temperature,
    system,
    messages: [{ role: 'user', content: user }],
  });
  return msg.content
    .map((b) => ('text' in b ? b.text : ''))
    .join('')
    .trim();
}

interface OpenAICompatArgs {
  baseURL: string;
  apiKey: string;
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  temperature: number;
  stream?: boolean;
  onChunk?: (chunk: string) => void;
}

async function callOpenAICompat(a: OpenAICompatArgs): Promise<string> {
  const client = new OpenAI({ baseURL: a.baseURL, apiKey: a.apiKey });
  let lastErr: unknown;
  const ATTEMPT_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 30_000;

  const isConcurrencyCap = (e: any): boolean =>
    e?.status === 429 && /concurrent|rate.?limit|cool.?down/i.test(String(e?.message ?? ''));
  let sawConcurrency = false;
  let maxAttempts = 2; // Fewer attempts for speed
  const backoffMs = (attempt: number, sawCap: boolean): number =>
    sawCap ? 1000 * (attempt + 1) : 300 * (attempt + 1);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
    try {
      if (a.stream && a.onChunk) {
        // Streaming path
        const stream = await client.chat.completions.create({
          model: a.model,
          temperature: a.temperature,
          max_tokens: a.maxTokens,
          messages: [
            { role: 'system', content: a.system },
            { role: 'user', content: a.user },
          ],
          stream: true,
        }, { signal: controller.signal });

        let fullText = '';
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content || '';
          if (delta) {
            fullText += delta;
            a.onChunk(delta);
          }
        }
        if (fullText) return fullText;
        lastErr = new Error('AI returned an empty response.');
      } else {
        // Non-streaming path
        const completion = await client.chat.completions.create({
          model: a.model,
          temperature: a.temperature,
          max_tokens: a.maxTokens,
          messages: [
            { role: 'system', content: a.system },
            { role: 'user', content: a.user },
          ],
        }, { signal: controller.signal });
        const text = completion.choices[0]?.message?.content?.trim() || '';
        if (text) return text;
        lastErr = new Error('AI returned an empty response.');
      }
    } catch (e: any) {
      if (controller.signal.aborted && e?.code !== 'ECONNRESET') {
        lastErr = new Error(`AI request timed out after ${ATTEMPT_TIMEOUT_MS / 1000}s.`);
      } else {
        lastErr = e;
      }
      if (isConcurrencyCap(e)) {
        sawConcurrency = true;
        maxAttempts = 4; // Escalate on concurrency cap
      }
    } finally {
      clearTimeout(timer);
    }
    if (attempt < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, backoffMs(attempt, sawConcurrency)));
    }
  }

  // Quick failover chain for OmniRoute — try each fallback in sequence
  const FALLBACK_CHAIN: Record<string, string> = {
    'auto/best-coding': 'auto/best-free',
    'auto/best-free': 'auto/thrifty',
    'auto/thrifty': 'groq/openai/gpt-oss-120b',
    'groq/openai/gpt-oss-120b': 'ddgw/gpt-5.6-luna',
    'ddgw/gpt-5.6-luna': 'auto/best-coding',
    'deepseek-v4-flash': 'glm-5.3-flash',
    'glm-5.3-flash': 'deepseek-v4-flash',
  };

  let currentModel = a.model;
  const visited = new Set<string>();

  while (true) {
    const fallbackModel = FALLBACK_CHAIN[currentModel];
    if (!fallbackModel || visited.has(fallbackModel)) break; // no more fallbacks or cycle detected
    visited.add(fallbackModel);

    try {
      const fbController = new AbortController();
      const fbTimer = setTimeout(() => fbController.abort(), ATTEMPT_TIMEOUT_MS);
      try {
        if (a.stream && a.onChunk) {
          const stream = await client.chat.completions.create({
            model: fallbackModel,
            temperature: a.temperature,
            max_tokens: a.maxTokens,
            messages: [
              { role: 'system', content: a.system },
              { role: 'user', content: a.user },
            ],
            stream: true,
          }, { signal: fbController.signal });

          let fullText = '';
          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content || '';
            if (delta) {
              fullText += delta;
              a.onChunk(delta);
            }
          }
          if (fullText) return fullText;
        } else {
          const completion = await client.chat.completions.create({
            model: fallbackModel,
            temperature: a.temperature,
            max_tokens: a.maxTokens,
            messages: [
              { role: 'system', content: a.system },
              { role: 'user', content: a.user },
            ],
          }, { signal: fbController.signal });
          const text = completion.choices[0]?.message?.content?.trim() || '';
          if (text) return text;
        }
      } finally {
        clearTimeout(fbTimer);
      }
    } catch (fbErr: any) {
      // If this fallback also hits concurrency cap, keep going to next fallback
      if (isConcurrencyCap(fbErr)) {
        currentModel = fallbackModel;
        continue; // try next in chain
      }
      // Other errors: try next fallback
      currentModel = fallbackModel;
      continue;
    }
    // If we got here without returning, this fallback failed (empty response)
    currentModel = fallbackModel;
  }

  throw lastErr;
}

// --- prompts ---------------------------------------------------------------
export const RESUME_TAILOR_SYSTEM = `You tailor a candidate's resume to match a job description, returning STRICT JSON ONLY.

Rewrite the candidate's REAL experience to fit the role. Do NOT fabricate employers, titles, dates, or degrees — keep every company name, job title, and date range exactly as given, and NEVER skip or merge any role. Reword bullets so the most relevant achievements for the target role come first, and echo the job's key technologies. Tighten the summary to align with the role.

Rules:
- Output ONLY a single JSON object. No markdown fences, no commentary, no prose before/after.
- CRITICAL — PRESERVE ALL ROLES: you MUST include an "experience" entry for EVERY job/company in the candidate's BASE RESUME, oldest to newest, none skipped, none merged, and NEVER change the company name, job title, or date range. If the base resume lists 4 companies, output 4 experience entries.
- The "name", "title", "contact" fields use the candidate's real details (contact = email | linkedin | location).
- "summary": array of 2-3 short paragraphs.
- REQUIREMENT COVERAGE (DEEP RELEVANCE — the most important rule): before writing, silently extract the job's top 5-8 HARD requirements (from the title AND description: must-have technologies, domain skills, seniority signals). For EVERY one of them, include at least one bullet somewhere in the resume that evidences it — drawn ONLY from the candidate's real experience, reworded to use the job's exact terminology. Weave them across the relevant roles, with the strongest evidence in the most relevant role. If the base resume offers no genuine support for a requirement, do NOT invent one — flag it implicitly by covering the closest real skill instead.
- BULLET ALLOCATION BY RELEVANCE: give the most JD-relevant roles the most bullets (up to 8) and compress the least relevant roles to 2-3 — but NEVER drop a role. Order bullets within each role by relevance to THIS job first, impact second.
- "summary" must open by positioning the candidate against THIS job's top requirements (truthful, 2-3 short paragraphs).
- "experience": one entry per role with "role", "company", "dates" (exact range) and "bullets" (2-8 reworded, relevance-ordered; keep facts accurate).
- "education": one entry per degree/school from the BASE RESUME with "school", "degree", "dates", "detail" (e.g. major/focus). Preserve every education entry; do NOT omit education even for technical roles. Use "" for any field the source lacks.
- "certifications": array of {"name","issuer","year"} from the BASE RESUME. Use [] if none.
- "skills": PRESERVE the candidate's FULL categorized skills from the BASE RESUME. Do NOT condense to a handful of tools. Keep every category AND every technology the base resume lists (e.g. Data Engineering & Analytics, Cloud Platforms, Orchestration & DevOps, Data Warehousing), even if the job doesn't mention it — a data/cloud engineer's ATS score depends on these exact keywords. Return each category as one line ("Category: tool, tool, tool") in the same order as the base resume, one string per category. If the base resume is flat/un-categorized, keep it flat but still list every tool. Aim for the same number of skill lines as the base resume (do NOT shrink a ~6-line categorized block to 4-8 generic lines).
- Keep every bullet concise so the output stays complete — do not truncate older roles to save space. It is far better to keep all companies with 1-2 bullets each than to drop a company.
- VARIATION (STRICT): rewrite every experience bullet AND the whole summary fresh for THIS job. Never output a bullet or summary paragraph you would also output for a different job: rephrase fully (different sentence structure and verb choices), re-select which achievements surface based on THIS posting, reorder for this role's priorities, and echo this job's exact vocabulary. The summary must open differently per resume and align to this role. Facts, metrics, and employer names stay truthful, but no bullet or summary string may be shared between tailored resumes for different jobs.
- All fields required.

JSON schema:
{"name":string,"title":string,"contact":string,"summary":string[],"experience":[{"role":string,"company":string,"dates":string,"bullets":string[]}],"education":[{"school":string,"degree":string,"dates":string,"detail":string}],"certifications":[{"name":string,"issuer":string,"year":string}],"skills":string[]}`;

export const QUESTION_HELPER_SYSTEM = `Help a candidate answer application questions.
Write in first person. Be specific and under 150 words. Use concrete examples drawn from the resume.
Do not fabricate achievements. If the resume lacks relevant detail, say so briefly and answer generically.`;

// ATS scoring prompt (methodology from Tailor-AI / Atanub707 llmMatcher.ts, which
// models how real ATS parse: weighted scoring + exact keyword/boolean logic).
// Rates a candidate's resume against a job description and returns a strict JSON
// object with a weighted score + per-dimension breakdown + concrete gaps to fix.
export const RESUME_ATS_SYSTEM = `You are a real-world ATS (Applicant Tracking System) scoring engine and a Technical Recruiter. Score how well the candidate's CV would rank when processed by an actual ATS (Greenhouse, Workday, Lever, Taleo, iCIMS, SmartRecruiters).

Rules of real ATS scoring:
- ATS does NOT "understand" context like a human. It parses text and matches exact keywords.
- Boolean search is the primary filter: recruiters search ("Senior" AND "DevOps" AND "AWS"). If exact combos are missing, the resume is invisible regardless of skill.
- Section-weighting: keywords from job TITLES and SUMMARY count 2x more than keywords from a skills list.
- Recency weighting: skills in the most recent role count more than skills from 5+ years ago.
- Keyword density: a skill mentioned across multiple roles scores higher than listed once.
- Hard skills (AWS, Docker, Kubernetes, Python) count; soft skills (leadership, communication) do NOT move the ATS score.
- Contextual relevance: "Led Kubernetes migration for 200 nodes" scores higher than listing "Kubernetes" 5 times.
- Quantification (metrics, numbers, percentages) is a bonus signal in modern AI-enhanced ATS.
- Exact certification names must match.
- Years of experience: calculate from actual dates, not just stated years.

SCORING METHODOLOGY (weighted):
1. Boolean Title Match (20%): exact title or standard variants (e.g. "DevOps Engineer" vs "DevOps Engineer II", "Platform Engineer", "SRE").
2. Hard Skills Overlap (35%): every hard skill/tool in the JD found in the CV, weighted by section (title/summary 2x, experience 1.5x, skills 1x).
3. Years of Experience Fit (15%): from actual dates vs JD requirement.
4. Keyword Density & Recency (15%): count JD keyword appearances across roles; penalize if only in one old role.
5. Certification Match (5%): exact certification names from the JD in the CV.
6. Quantification Bonus (10%): experience bullets with metrics/numbers/percentages.

Return ONLY a strict JSON object, no markdown, no code fences, matching this exact schema:
{
  "overallScore": <number 0-100, weighted using the above methodology>,
  "ATS": { "score": <number 0-100>, "tips": [ { "type": "good"|"improve", "tip": "<short title>", "explanation": "<detail>" } ] },
  "toneAndStyle": { "score": <number 0-100>, "tips": [ { "type": "good"|"improve", "tip": "<short title>", "explanation": "<detail>" } ] },
  "content": { "score": <number 0-100>, "tips": [ { "type": "good"|"improve", "tip": "<short title>", "explanation": "<detail>" } ] },
  "structure": { "score": <number 0-100>, "tips": [ { "type": "good"|"improve", "tip": "<short title>", "explanation": "<detail>" } ] },
  "skills": { "score": <number 0-100>, "tips": [ { "type": "good"|"improve", "tip": "<short title>", "explanation": "<detail>" } ] },
  "matchingSkills": <string[]> (hard skills from JD found in CV),
  "missingSkills": <string[]> (hard skills from JD NOT found in CV),
  "matchingKeywords": <string[]> (exact keyword matches found in CV),
  "missingKeywords": <string[]> (JD keywords absent from CV),
  "booleanSearchResult": "pass"|"borderline"|"fail" (would a boolean search for the target title + top 3 hard skills find this CV?),
  "yearsOfExperience": <number, calculated from dates>,
  "yearsRequired": <number, estimated from JD>,
  "keyRecommendations": <string[]> (3-5 specific, actionable CV changes to pass ATS screening)
}
Rules:
- overallScore uses the weighted methodology above (Boolean Title 20%, Hard Skills 35%, Years 15%, Keyword Density 15%, Certification 5%, Quantification 10%).
- Give 3-4 tips per dimension, tagged "good" (what's working) or "improve" (what to fix).
- Use the job title + description to judge relevance; be concrete about the exact missing skills/keywords.
- Return the JSON object ONLY, without backticks or any other text.`;

// --- offline stub ----------------------------------------------------------
function stubResponse(system: string, user: string): string {
  const isTailor = system.includes('resume');
  if (isTailor) {
    return [
      '[STUB OUTPUT — no AI key configured. Save your AI provider settings in Settings → AI Configuration to get real results.]',
      '',
      extractResumeHeadline(user) || 'CANDIDATE NAME',
      '───────────────────────────',
      'PROFESSIONAL SUMMARY',
      'Results-driven professional aligned to the target role. (Tailored summary echoing the job description keywords.)',
      '',
      'EXPERIENCE',
      '• Led work most relevant to the target role (reordered for relevance).',
      '• Delivered measurable impact with concrete metrics.',
      '• Collaborated cross-functionally to ship outcomes.',
      '',
      'SKILLS',
      'Top skills matched to the job posting appear first.',
    ].join('\n');
  }
  return [
    '[STUB OUTPUT — no AI key configured. Save your AI provider settings in Settings → AI Configuration to get real results.]',
    '',
    'Here is a draft answer using first person and concrete examples from your resume:',
    'In my previous role I tackled a similar challenge by focusing on the outcome, the approach, and the measurable result. (Replace with specifics once a real AI key is set.)',
  ].join('\n');
}

function extractResumeHeadline(user: string): string {
  const line = user
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return line || '';
}
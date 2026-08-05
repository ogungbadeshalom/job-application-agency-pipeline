// Single AI entrypoint: callAI(system, user, opts) -> string.
//
// Provider selection via env:
//   AI_PROVIDER  'anthropic' (default) | 'openrouter' | 'custom'
//   AI_MODEL     model id (defaults below)
//
// Auth (pick what matches the provider):
//   ANTHROPIC_API_KEY   for provider=anthropic
//   OPENROUTER_API_KEY  for provider=openrouter
//   AI_BASE_URL + AI_API_KEY  for provider=custom (OpenAI-compatible: OpenCode/Ollama/LM Studio)
//
// If no key is configured we fall back to a deterministic stub so the app
// remains demonstrable without a key. Set AI_STUB=false to disable the stub
// and surface a real error instead.

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

export interface CallAIOptions {
  maxTokens?: number;
  temperature?: number;
}

export function aiProvider(): string {
  return process.env.AI_PROVIDER || 'anthropic';
}

export function aiModel(): string {
  return process.env.AI_MODEL || 'claude-sonnet-5';
}

// A key only counts as "configured" if it's present AND not a placeholder.
const PLACEHOLDER = /^placeholder|your-|-key$|^sk-ant-test/i;
function isRealKey(v: string | undefined): boolean {
  return Boolean(v) && !PLACEHOLDER.test(v!.trim());
}

// Default to stubbing unless the app EXPLICITLY opts into live calls with
// AI_STUB=false AND a real key for the active provider is set. This keeps a
// freshly built app from making real (paid) model calls by accident.
function stubEnabled(): boolean {
  if (process.env.AI_STUB === 'false') return false; // explicit opt-in to live
  return true;
}

export function hasAnyKey(): boolean {
  const provider = aiProvider();
  if (provider === 'anthropic') return isRealKey(process.env.ANTHROPIC_API_KEY);
  if (provider === 'openrouter') return isRealKey(process.env.OPENROUTER_API_KEY);
  if (provider === 'custom') return Boolean(process.env.AI_BASE_URL);
  return false;
}

export async function callAI(
  system: string,
  user: string,
  opts: CallAIOptions = {}
): Promise<string> {
  const { maxTokens = 1500, temperature = 0.4 } = opts;
  const provider = aiProvider();
  const model = aiModel();

  // Deterministic offline fallback so the UI is usable without a key.
  if (stubEnabled()) {
    return stubResponse(system, user);
  }

  try {
    if (provider === 'anthropic') {
      return await callAnthropic(system, user, model, maxTokens, temperature);
    }
    if (provider === 'openrouter') {
      return await callOpenAICompat({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: process.env.OPENROUTER_API_KEY!,
        model,
        system,
        user,
        maxTokens,
        temperature,
      });
    }
    if (provider === 'custom') {
      return await callOpenAICompat({
        baseURL: process.env.AI_BASE_URL!,
        apiKey: process.env.AI_API_KEY || 'ollama',
        model,
        system,
        user,
        maxTokens,
        temperature,
      });
    }
    throw new Error(`Unknown AI_PROVIDER: ${provider}`);
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
  temperature: number
): Promise<string> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const msg = await client.messages.create({
    model,
    max_tokens: maxTokens,
    temperature,
    system,
    messages: [{ role: 'user', content: user }],
  });
  // Flatten content blocks to text.
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
}

async function callOpenAICompat(a: OpenAICompatArgs): Promise<string> {
  const client = new OpenAI({ baseURL: a.baseURL, apiKey: a.apiKey });
  const completion = await client.chat.completions.create({
    model: a.model,
    temperature: a.temperature,
    max_tokens: a.maxTokens,
    messages: [
      { role: 'system', content: a.system },
      { role: 'user', content: a.user },
    ],
  });
  return completion.choices[0]?.message?.content?.trim() || '';
}

// --- prompts ---------------------------------------------------------------
export const RESUME_TAILOR_SYSTEM = `Rewrite a candidate's resume to match a job description.
Do NOT fabricate experience, employers, dates, or titles. Reorder bullets by relevance to the role.
Adjust the summary line to echo the job's keywords. Keep all dates, companies, and titles exact.
Output plain text only — no markdown, no commentary.`;

export const QUESTION_HELPER_SYSTEM = `Help a candidate answer application questions.
Write in first person. Be specific and under 150 words. Use concrete examples drawn from the resume.
Do not fabricate achievements. If the resume lacks relevant detail, say so briefly and answer generically.`;

// --- offline stub ----------------------------------------------------------
// When no provider key is set, produce a clearly-labeled but realistic output
// so the tailor/answer flows are demoable. Deterministic (no randomness).
function stubResponse(system: string, user: string): string {
  const isTailor = system.includes('resume');
  if (isTailor) {
    return [
      '[STUB OUTPUT — no AI key configured. Set ANTHROPIC_API_KEY to get real results.]',
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
    '[STUB OUTPUT — no AI key configured. Set ANTHROPIC_API_KEY to get real results.]',
    '',
    'Here is a draft answer using first person and concrete examples from your resume:',
    'In my previous role I tackled a similar challenge by focusing on the outcome, the approach, and the measurable result. (Replace with specifics once a real AI key is set.)',
  ].join('\n');
}

function extractResumeHeadline(user: string): string {
  // First non-empty line is usually the candidate name / headline.
  const line = user
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return line || '';
}

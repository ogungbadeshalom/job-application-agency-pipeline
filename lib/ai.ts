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
  return c?.provider || envValue('ai_provider') || 'anthropic';
}

export async function aiModel(): Promise<string> {
  const c = await loadConfig();
  return c?.model || envValue('ai_model') || 'claude-sonnet-5';
}

export async function hasAnyKey(): Promise<boolean> {
  const c = await loadConfig();
  if (c?.apiKey && c.apiKey.length > 10) return true;
  // env fallback: anthropic / openrouter / custom
  const provider = c?.provider || envValue('ai_provider') || 'anthropic';
  if (provider === 'anthropic') return Boolean(process.env.ANTHROPIC_API_KEY);
  if (provider === 'openrouter') return Boolean(process.env.OPENROUTER_API_KEY);
  return Boolean(process.env.AI_BASE_URL);
}

function stubEnabled(hasKey: boolean): boolean {
  // AI_STUB=false → live (call the model if a key is configured)
  // AI_STUB=true  → always stub (explicit escape hatch for dev)
  // unset         → stub only if no real key is configured
  if (process.env.AI_STUB === 'true') return true;
  if (process.env.AI_STUB === 'false') return false;
  return !hasKey;
}

export async function callAI(
  system: string,
  user: string,
  opts: CallAIOptions = {}
): Promise<string> {
  const { maxTokens = 1500, temperature = 0.4 } = opts;
  const cfg = await loadConfig();
  const provider = cfg?.provider || envValue('ai_provider') || 'anthropic';
  const model = cfg?.model || envValue('ai_model') || 'claude-sonnet-5';
  const apiKey = cfg?.apiKey || process.env.ANTHROPIC_API_KEY || '';

  const keyPresent = await hasAnyKey();
  if (stubEnabled(keyPresent)) {
    return stubResponse(system, user);
  }

  try {
    if (provider === 'anthropic') {
      return await callAnthropic(system, user, model, maxTokens, temperature, apiKey);
    }
    if (provider === 'openrouter') {
      return await callOpenAICompat({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: cfg?.apiKey || process.env.OPENROUTER_API_KEY || '',
        model,
        system,
        user,
        maxTokens,
        temperature,
      });
    }
    if (provider === 'deepseek') {
      // DeepSeek is OpenAI-compatible at https://api.deepseek.com/v1
      return await callOpenAICompat({
        baseURL: cfg?.baseUrl || 'https://api.deepseek.com/v1',
        apiKey: cfg?.apiKey || process.env.AI_API_KEY || '',
        model,
        system,
        user,
        maxTokens,
        temperature,
      });
    }
    if (provider === 'custom') {
      return await callOpenAICompat({
        baseURL: cfg?.baseUrl || envValue('ai_base_url') || process.env.AI_BASE_URL || '',
        apiKey: cfg?.apiKey || process.env.AI_API_KEY || 'ollama',
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
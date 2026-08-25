import { callAI } from '@/lib/ai';
import type { ScrapeResultJob } from '@/lib/types';

// AI role-fit gate: asks the model whether each scraped job genuinely matches
// the client's resume (role level + skills + domain). Only jobs the model says
// are a real fit pass. This prevents Director/PM/Sales/Compliance/adjacent
// roles that share search keywords from entering a data/ML engineer's queue.

const SYSTEM = `You are a recruiting screener. You are given a candidate's resume and a
list of jobs. For EACH job, decide whether it is a GENUINE, sensible role for this
candidate to apply to — considering:
- Role LEVEL (candidate's seniority vs the job's required level; a Director/VP
  role is NOT a fit for a Senior IC engineer, and a Junior role under-sells them).
- ROLE FAMILY (a Data/ML engineer should NOT get Product Manager, Compliance,
  Sales, Account/Client Success, Technical Support, or Ops/Director roles).
- SKILLS (job must draw on skills in the resume; adjacent-but-relevant tech roles
  may fit if they use those skills).
Return STRICT JSON ONLY, an array of objects, one per job, in the same order:
[{"index": 0, "match": true, "reason": "short why"}]
match is true ONLY if you would genuinely encourage this candidate to apply.`;

function buildUser(resumeText: string, jobs: { idx: number; title: string; desc: string }[], startIdx: number): string {
  const head = `CANDIDATE RESUME (abridged):\n${resumeText.slice(0, 6000)}\n\n`;
  const jobLines = jobs
    .map(
      (j, i) =>
        `JOB_INDEX ${startIdx + i}\nTITLE: ${j.title}\nDESCRIPTION: ${(j.desc || '').slice(0, 900)}\n`
    )
    .join('\n');
  return head + 'JOBS TO SCREEN:\n' + jobLines;
}

function parseResult(raw: string, count: number): Record<number, boolean> {
  const t = raw.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fence ? fence[1] : t).trim();
  const start = body.indexOf('[');
  const end = body.lastIndexOf(']');
  if (start === -1 || end === -1) return {};
  try {
    const arr = JSON.parse(body.slice(start, end + 1));
    if (!Array.isArray(arr)) return {};
    const map: Record<number, boolean> = {};
    for (const item of arr) {
      if (item && typeof item.index === 'number') {
        map[item.index] = Boolean(item.match);
      }
    }
    return map;
  } catch {
    return {};
  }
}

export async function filterJobsByResume(
  jobs: ScrapeResultJob[],
  resumeText: string
): Promise<ScrapeResultJob[]> {
  if (!jobs.length) return jobs;
  // Build summary entries.
  const entries = jobs.map((j) => ({
    title: (j.title as string) || '',
    desc: (j.description as string) || '',
  }));
  const kept: ScrapeResultJob[] = [];
  const BATCH = 6;
  for (let s = 0; s < entries.length; s += BATCH) {
    const chunk = entries.slice(s, s + BATCH);
    const chunkIndexed = chunk.map((c, k) => ({ idx: s + k, title: c.title, desc: c.desc }));
    let raw: string;
    try {
      raw = await callAI(SYSTEM, buildUser(resumeText, chunkIndexed, s), {
        maxTokens: 1500,
        temperature: 0.2,
      });
    } catch {
      // On AI failure, be conservative: keep them (don't drop a whole batch).
      kept.push(...jobs.slice(s, s + BATCH));
      continue;
    }
    const verdict = parseResult(raw, chunk.length);
    for (let k = 0; k < chunk.length; k++) {
      if (verdict[s + k] !== false) {
        kept.push(jobs[s + k]);
      }
    }
  }
  return kept;
}
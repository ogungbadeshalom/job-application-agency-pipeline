import type { Profile } from '@/lib/types';

// Worker role-guide: tells a worker which job roles/titles their assigned
// client's resume genuinely supports, so they don't skip valid applications
// just because a title looks unfamiliar. Mirrors the domain signal used by
// the refill role-fit gate (lib/aiJobMatch.ts -> domainKeywords) so the
// guidance is consistent with what actually gets admitted to the queue.

// Ordered: strongest domains first. Each entry carries the role-family label
// the worker sees plus concrete example titles to apply for / avoid.
const ROLE_GUIDE: {
  kw: string;
  keywords: string[];
  label: string;            // human role-family shown to the worker
  exampleTitles: string[];  // representative titles this client can apply to
  skipNote: string;         // what to skip even within this family
}[] = [
  {
    kw: 'DATA',
    keywords: ['data', 'analytics', 'warehouse', 'etl', 'pipeline', 'databricks', 'spark', 'snowflake', 'bigquery', 'bi ', 'reporting'],
    label: 'Data Engineer / Analytics Engineer / Data Platform',
    exampleTitles: [
      'Data Engineer', 'Senior Data Engineer', 'Analytics Engineer',
      'Data Platform Engineer', 'Database Engineer / DBA', 'ETL Developer',
      'Data Infrastructure Engineer', 'BI Engineer',
    ],
    skipNote: 'Skip if it is a non-technical "data analyst"-only dashboard role or data SCIENCE without a software/eng component.',
  },
  {
    kw: 'ML',
    keywords: ['machine learning', 'ml ', 'llm', 'deep learning', 'ai platform', 'ai engineer', 'mlops', 'model'],
    label: 'ML / AI Engineer',
    exampleTitles: [
      'Machine Learning Engineer', 'ML Engineer', 'AI Engineer', 'LLM Engineer',
      'MLOps Engineer', 'Applied AI Engineer', 'AI Platform Engineer',
    ],
    skipNote: 'Skip pure research / scientist roles or "AI product manager" (management, not engineering).',
  },
  {
    kw: 'BACKEND',
    keywords: ['backend', 'back-end', 'fullstack', 'full-stack', 'software engineer', 'platform', 'api', 'microservice'],
    label: 'Backend / Full-Stack / Software Engineer',
    exampleTitles: [
      'Software Engineer', 'Backend Engineer', 'Full-Stack Engineer',
      'Senior Software Engineer (Backend)', 'Platform Engineer', 'Staff Backend Engineer',
    ],
    skipNote: 'Skip customer-facing roles (Solutions/Sales/Support Engineer) and Product/Project Managers.',
  },
  {
    kw: 'CLOUD',
    keywords: ['cloud', 'aws', 'azure', 'gcp', 'kubernetes', 'terraform', 'devops'],
    label: 'Cloud / DevOps / Infrastructure Engineer',
    exampleTitles: [
      'Cloud Engineer', 'DevOps Engineer', 'SRE / Site Reliability Engineer',
      'Infrastructure Engineer', 'Platform Engineer (Cloud)',
    ],
    skipNote: 'Skip pure sysadmin/IT without engineering or IaC (Terraform/K8s).',
  },
  {
    kw: 'FRONTEND',
    keywords: ['frontend', 'front-end', 'react', 'ui ', 'web'],
    label: 'Frontend / Web Engineer',
    exampleTitles: [
      'Frontend Engineer', 'React Engineer', 'UI Engineer', 'Web Developer',
    ],
    skipNote: 'Skip pure design / Figma roles (no code).',
  },
];

export interface RoleGuide {
  domains: string[];
  familyLabels: string[];
  exampleTitles: string[];
  skipNote: string;
}

// Derive which role domains a client's resume covers (mirror of aiJobMatch.domainKeywords).
export function resumeDomains(resumeText: string | null | undefined): string[] {
  const t = (resumeText || '').toLowerCase();
  const present = ROLE_GUIDE.filter((g) => g.keywords.some((k) => t.includes(k))).map((g) => g.kw);
  if (!present.length) return ['DATA', 'ML', 'BACKEND', 'CLOUD']; // base guard, same as gate
  return present;
}

// Human-friendly "roles you can apply for" for a client profile.
export function roleGuideForProfile(p: Profile): RoleGuide | null {
  if (!p) return null;
  const dom = resumeDomains(p.base_resume_text);
  const matched = ROLE_GUIDE.filter((g) => dom.includes(g.kw));
  if (!matched.length) return null;
  return {
    domains: matched.map((g) => g.kw),
    familyLabels: matched.map((g) => g.label),
    exampleTitles: matched.flatMap((g) => g.exampleTitles),
    skipNote: matched.map((g) => g.skipNote).join(' '),
  };
}

// Map a worker's client profiles -> role guides keyed by profile id.
export function roleGuidesForProfiles(
  profiles: Profile[]
): Record<string, RoleGuide> {
  const out: Record<string, RoleGuide> = {};
  for (const p of profiles) {
    const g = roleGuideForProfile(p);
    if (g) out[p.id] = g;
  }
  return out;
}
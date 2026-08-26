import type { Profile } from '@/lib/types';

// Worker role-guide: tells a worker which job roles/titles their assigned
// client's resume genuinely supports, so they don't skip valid applications
// just because a title looks unfamiliar.
//
// The guide must be DISTINCT per client — two software engineers are NOT
// interchangeable. We score each role family by how strongly the resume
// matches its keywords (counted, not just "contains"), then rank and surface
// only the client's most distinctive families. Andrew (a Senior Data Engineer)
// and Joseph (an AI/ML + Full-Stack Eng) land on different guides even though
// both are "engineers".

interface RoleFamily {
  id: string;
  keywords: string[];        // counted occurrences; each hit adds weight
  strong: string[];          // decisive phrasings that heavily weight this family
  label: string;             // role-family shown to the worker
  exampleTitles: string[];
  skipNote: string;
}

const ROLE_FAMILIES: RoleFamily[] = [
  {
    id: 'DATA',
    keywords: ['data engineer', 'etl', 'elt', 'data warehouse', 'data platform', 'databricks', 'snowflake', 'bigquery', 'spark', 'pipeline', 'warehouse', 'medallion', 'bi engineer', 'airflow', 'data lake', 'dbt'],
    strong: ['data engineer', 'etl', 'data warehouse', 'data platform', 'medallion', 'snowflake', 'databricks'],
    label: 'Data Engineer / Data Platform / Analytics Engineering',
    exampleTitles: [
      'Data Engineer', 'Senior Data Engineer', 'Analytics Engineer',
      'Data Platform Engineer', 'Database Engineer / DBA', 'ETL / ELT Engineer',
      'Data Infrastructure Engineer', 'BI Engineer', 'Data Lakehouse Engineer',
    ],
    skipNote: 'Skip non-engineering "data analyst" dashboard-only roles, and data SCIENCE roles without a software/engineering component.',
  },
  {
    id: 'AI',
    keywords: ['llm', 'rag', 'agentic', 'agent', 'mcp', 'ai engineer', 'ml engineer', 'mlops', 'machine learning', 'fine-tun', 'prompt', 'genai', 'gen ai'],
    strong: ['llm', 'rag', 'agentic', 'mcp', 'llm ops', 'ai platform'],
    label: 'AI / ML Engineer (LLM, RAG, Agents)',
    exampleTitles: [
      'AI Engineer', 'ML Engineer', 'LLM Engineer', 'Applied AI Engineer',
      'AI Platform Engineer', 'Agentic AI Engineer', 'MLOps Engineer',
      'NLP / LLM Engineer', 'RAG Engineer',
    ],
    skipNote: 'Skip pure ML research / data-scientist roles with no production engineering, and "AI product manager" (management).',
  },
  {
    id: 'BACKEND',
    keywords: ['backend', 'back-end', 'microservice', 'distributed', 'api', 'rest', 'graphql', 'kafka', 'node.js', 'fastapi', 'postgresql', 'kubernetes', 'service'],
    strong: ['microservice', 'distributed', 'backend', 'graphql', 'kafka', 'rest api'],
    label: 'Backend / Distributed Systems Engineer',
    exampleTitles: [
      'Backend Engineer', 'Senior Software Engineer (Backend)',
      'Distributed Systems Engineer', 'Platform Engineer', 'Staff Backend Engineer',
      'API Engineer', 'Microservices Engineer',
    ],
    skipNote: 'Skip customer-facing roles (Solutions/Sales/Support Engineer) and Product/Project Managers.',
  },
  {
    id: 'FULLSTACK',
    keywords: ['full-stack', 'fullstack', 'react', 'typescript', 'frontend', 'front-end', 'ui', 'web application', 'spa', 'tailwind'],
    strong: ['full-stack', 'fullstack', 'react', 'typescript', 'frontend'],
    label: 'Full-Stack / Frontend Web Engineer',
    exampleTitles: [
      'Full-Stack Engineer', 'Full-Stack Developer', 'Software Engineer (Full-Stack)',
      'Frontend Engineer', 'React Engineer', 'TypeScript Engineer', 'Web Developer',
    ],
    skipNote: 'Skip pure design / Figma roles (no code).',
  },
  {
    id: 'CLOUD',
    keywords: ['aws', 'azure', 'gcp', 'terraform', 'devops', 'sre', 'site reliability', 'infrastructure', 'cloud', 'kubernetes', 'observability', 'ci/cd'],
    strong: ['terraform', 'devops', 'sre', 'site reliability', 'observability', 'cloud-native'],
    label: 'Cloud / DevOps / SRE / Infrastructure Engineer',
    exampleTitles: [
      'Cloud Engineer', 'DevOps Engineer', 'SRE / Site Reliability Engineer',
      'Infrastructure Engineer', 'Platform Engineer (Cloud)', 'Kubernetes Engineer',
    ],
    skipNote: 'Skip pure sysadmin/IT without engineering or IaC (Terraform/K8s).',
  },
];

// First line of the resume usually names the seniority + immediate role identity
// (e.g. "Senior Data Engineer" vs "Senior AI/ML Engineer | LLM • Agentic AI").
function headlineRole(resumeText: string): string {
  const t = (resumeText || '').replace(/\s+/g, ' ').trim();
  return t.split(/[.\n]/)[0].trim().slice(0, 90);
}

function countHits(text: string, words: string[]): number {
  let n = 0;
  for (const w of words) {
    let i = 0;
    while ((i = text.indexOf(w, i)) !== -1) {
      n += 1;
      i += Math.max(1, w.length);
    }
  }
  return n;
}

export interface RoleGuide {
  headline: string;
  families: { id: string; label: string; exampleTitles: string[]; skipNote: string }[];
  exampleTitles: string[];
  skipNote: string;
}

export function roleGuideForProfile(p: Profile): RoleGuide | null {
  if (!p) return null;
  const t = (p.base_resume_text || '').toLowerCase();
  if (!t.trim()) return null;

  // Score each family: keywords-weighted + a strong-phrase boost.
  const scored = ROLE_FAMILIES.map((f) => {
    const kwHits = countHits(t, f.keywords);
    const strongHits = countHits(t, f.strong);
    let score = kwHits + strongHits * 3;
    // Tie-break / differentiation: treat the first-line headline identity as
    // decisive for the top family so two engineers can't collide.
    const head = (headlineRole(t) || '').toLowerCase();
    if (f.strong.some((s) => head.includes(s))) score += 20;
    return { f, score };
  });

  const ranked = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);

  // Fall back to a sensible base if nothing scored (shouldn't happen with a resume).
  const use = ranked.length ? ranked : scored.map((s) => ({ f: s.f, score: 1 }));

  // Pick a DISTINCT subset: the clear leader + any family scoring well above 0
  // that isn't drowned out. Cap at 4 so it stays scannable and targeted.
  const top = use[0].score;
  const cutoff = Math.max(top * 0.3, 4); // keep families at least ~30% as strong as the leader
  const kept = use.filter((s) => s.score >= cutoff).slice(0, 4);

  const families = kept.map((k) => ({
    id: k.f.id,
    label: k.f.label,
    exampleTitles: k.f.exampleTitles,
    skipNote: k.f.skipNote,
  }));

  return {
    headline: headlineRole(t),
    families,
    exampleTitles: Array.from(new Set(families.reduce<string[]>((acc, f) => acc.concat(f.exampleTitles), []))),
    skipNote: families.map((f) => f.skipNote).join(' '),
  };
}

export function roleGuidesForProfiles(profiles: Profile[]): Record<string, RoleGuide> {
  const out: Record<string, RoleGuide> = {};
  for (const p of profiles) {
    const g = roleGuideForProfile(p);
    if (g) out[p.id] = g;
  }
  return out;
}
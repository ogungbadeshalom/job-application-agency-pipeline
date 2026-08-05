// Postgres-backed data access. Implements the same `db` interface the app's
// pages and API routes call, but executes SQL against Postgres.
//
// Column notes (schema.sql):
//   - users.password_hash  (not exposed to UI)
//   - profiles.base_resume_path  (was base_resume_url)
//   - jobs.tailored_resume_pdf_path (was tailored_resume_pdf_url)
//
// Row mappers convert DB rows to the domain types in lib/types.ts so call
// sites stay unchanged.

import { all, one, query } from './pool';
import type {
  Job,
  JobStatus,
  ListJobsFilter,
  Profile,
  QuestionSnippet,
  ScrapeRun,
  User,
} from '../lib/types';

// --- row -> domain mappers ------------------------------------------------
function mapUser(r: Record<string, unknown>): User {
  return {
    id: r.id as string,
    email: r.email as string,
    role: r.role as User['role'],
    full_name: r.full_name as string,
    profile_id: (r.profile_id as string) ?? null,
    disabled_at: r.disabled_at ? (r.disabled_at as Date).toISOString() : null,
    created_at: (r.created_at as Date).toISOString(),
  };
}

function mapProfile(r: Record<string, unknown>): Profile {
  return {
    id: r.id as string,
    name: r.name as string,
    email: r.email as string,
    assigned_worker_id: (r.assigned_worker_id as string) ?? null,
    base_resume_url: (r.base_resume_path as string) ?? null, // map path -> domain url field
    base_resume_text: (r.base_resume_text as string) ?? null,
    scrape_search_terms: r.scrape_search_terms as unknown as string[],
    scrape_location: (r.scrape_location as string) ?? null,
    scrape_sites: r.scrape_sites as unknown as string[],
    scrape_results_wanted: r.scrape_results_wanted as number,
    scrape_hours_old: r.scrape_hours_old as number,
    created_at: (r.created_at as Date).toISOString(),
    updated_at: (r.updated_at as Date).toISOString(),
  };
}

function mapJob(r: Record<string, unknown>): Job {
  return {
    id: r.id as string,
    profile_id: r.profile_id as string,
    title: r.title as string,
    company: r.company as string,
    board: r.board as string,
    url: r.url as string,
    description: r.description as string,
    compensation_min: (r.compensation_min as number) ?? null,
    compensation_max: (r.compensation_max as number) ?? null,
    compensation_currency: (r.compensation_currency as string) ?? null,
    location: (r.location as string) ?? null,
    status: r.status as JobStatus,
    tailored_resume: (r.tailored_resume as string) ?? null,
    tailored_resume_pdf_url: (r.tailored_resume_pdf_path as string) ?? null,
    submitted_at: r.submitted_at ? (r.submitted_at as Date).toISOString() : null,
    proof_of_submission: (r.proof_of_submission as string) ?? null,
    notes: (r.notes as string) ?? null,
    scrape_run_id: (r.scrape_run_id as string) ?? null,
    created_at: (r.created_at as Date).toISOString(),
    updated_at: (r.updated_at as Date).toISOString(),
  };
}

function mapScrapeRun(r: Record<string, unknown>): ScrapeRun {
  return {
    id: r.id as string,
    triggered_by: (r.triggered_by as string) ?? null,
    profile_ids: r.profile_ids as unknown as string[],
    sites: r.sites as unknown as string[],
    search_terms: r.search_terms as unknown as string[],
    location: (r.location as string) ?? null,
    results_wanted: r.results_wanted as number,
    hours_old: r.hours_old as number,
    status: r.status as ScrapeRun['status'],
    jobs_found: r.jobs_found as number,
    jobs_added: r.jobs_added as number,
    error_message: (r.error_message as string) ?? null,
    started_at: r.started_at ? (r.started_at as Date).toISOString() : null,
    completed_at: r.completed_at ? (r.completed_at as Date).toISOString() : null,
    created_at: (r.created_at as Date).toISOString(),
  };
}

function mapSnippet(r: Record<string, unknown>): QuestionSnippet {
  return {
    id: r.id as string,
    profile_id: r.profile_id as string,
    question: r.question as string,
    answer: r.answer as string,
    use_count: r.use_count as number,
    created_at: (r.created_at as Date).toISOString(),
  };
}

// --- Postgres-backed db object consumed by pages and API routes ------------
export const db = {
  // users
  async listUsers(): Promise<User[]> {
    const rows = await all('select * from users order by created_at asc');
    return rows.map(mapUser);
  },
  async getUser(id: string): Promise<User | null> {
    const row = await one('select * from users where id = $1', [id]);
    return row ? mapUser(row) : null;
  },
  async getUserByEmail(email: string): Promise<User | null> {
    const row = await one('select * from users where lower(email) = lower($1)', [email]);
    return row ? mapUser(row) : null;
  },
  async createUser(input: {
    email: string;
    role: User['role'];
    full_name: string;
    password_hash?: string;
    profile_id?: string | null;
  }): Promise<User> {
    const row = await one(
      `insert into users (email, password_hash, role, full_name, profile_id)
       values ($1, $2, $3, $4, $5) returning *`,
      [
        input.email,
        input.password_hash ?? '',
        input.role,
        input.full_name ?? '',
        input.profile_id ?? null,
      ]
    );
    return mapUser(row!);
  },
  async updateUser(
    id: string,
    patch: { password_hash?: string; full_name?: string }
  ): Promise<User | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) {
        params.push(v);
        sets.push(`${k} = $${params.length}`);
      }
    }
    if (sets.length === 0) return this.getUser(id);
    params.push(id);
    const row = await one(
      `update users set ${sets.join(', ')} where id = $${params.length} returning *`,
      params
    );
    return row ? mapUser(row) : null;
  },

  // Auth helper: fetch a user's raw row INCLUDING password_hash (never expose
  // via the public getUser). Used only by the Credentials authorize(). Returns
  // null for disabled users so they can't log in.
  async getAuthUserByEmail(email: string): Promise<{
    id: string;
    email: string;
    password_hash: string;
    role: User['role'];
    full_name: string;
  } | null> {
    const row = await one(
      `select * from users where lower(email) = lower($1) and disabled_at is null`,
      [email]
    );
    if (!row) return null;
    return {
      id: row.id as string,
      email: row.email as string,
      password_hash: row.password_hash as string,
      role: row.role as User['role'],
      full_name: row.full_name as string,
    };
  },

  // profiles
  async listProfiles(): Promise<Profile[]> {
    const rows = await all('select * from profiles order by created_at asc');
    return rows.map(mapProfile);
  },
  async getProfile(id: string): Promise<Profile | null> {
    const row = await one('select * from profiles where id = $1', [id]);
    return row ? mapProfile(row) : null;
  },
  async getProfileByWorker(workerId: string): Promise<Profile | null> {
    const row = await one('select * from profiles where assigned_worker_id = $1', [workerId]);
    return row ? mapProfile(row) : null;
  },
  async createProfile(input: Partial<Profile>): Promise<Profile> {
    const row = await one(
      `insert into profiles
         (name, email, assigned_worker_id, base_resume_path, base_resume_text,
          scrape_search_terms, scrape_location, scrape_sites, scrape_results_wanted, scrape_hours_old)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
      [
        input.name ?? 'Untitled',
        input.email ?? '',
        input.assigned_worker_id ?? null,
        input.base_resume_url ?? null,
        input.base_resume_text ?? null,
        input.scrape_search_terms ?? [],
        input.scrape_location ?? null,
        input.scrape_sites ?? [],
        input.scrape_results_wanted ?? 100,
        input.scrape_hours_old ?? 72,
      ]
    );
    return mapProfile(row!);
  },
  async updateProfile(id: string, patch: Partial<Profile>): Promise<Profile | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    const allowed = {
      name: 'name',
      email: 'email',
      assigned_worker_id: 'assigned_worker_id',
      base_resume_url: 'base_resume_path', // domain -> db column
      base_resume_text: 'base_resume_text',
      scrape_search_terms: 'scrape_search_terms',
      scrape_location: 'scrape_location',
      scrape_sites: 'scrape_sites',
      scrape_results_wanted: 'scrape_results_wanted',
      scrape_hours_old: 'scrape_hours_old',
    } as const;
    for (const [k, col] of Object.entries(allowed)) {
      if (k in patch) {
        params.push((patch as Record<string, unknown>)[k]);
        sets.push(`${col} = $${params.length}`);
      }
    }
    if (sets.length === 0) return this.getProfile(id);
    params.push(id);
    const row = await one(
      `update profiles set ${sets.join(', ')} where id = $${params.length} returning *`,
      params
    );
    return row ? mapProfile(row) : null;
  },

  // jobs
  async listJobs(filter: ListJobsFilter = {}): Promise<Job[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    const pids = filter.profile_ids ?? (filter.profile_id ? [filter.profile_id].flat() : undefined);
    if (pids && pids.length) {
      where.push(`profile_id = ANY($${params.push(pids)})`);
    }
    if (filter.status) {
      const s = Array.isArray(filter.status) ? filter.status : [filter.status];
      where.push(`status = ANY($${params.push(s)}::job_status[])`);
    }
    if (filter.search) {
      const n = params.length + 1;
      where.push(
        `(title ilike $${n} or company ilike $${n} or description ilike $${n})`
      );
      params.push(`%${filter.search}%`);
    }
    const whereSql = where.length ? `where ${where.join(' and ')}` : '';
    let sql = `select * from jobs ${whereSql} order by created_at desc`;
    if (filter.limit) {
      params.push(filter.limit);
      sql += ` limit $${params.length}`;
    }
    const rows = await all(sql, params);
    return rows.map(mapJob);
  },
  async getJob(id: string): Promise<Job | null> {
    const row = await one('select * from jobs where id = $1', [id]);
    return row ? mapJob(row) : null;
  },
  async updateJob(id: string, patch: Partial<Job>): Promise<Job | null> {
    const allowed: Record<string, string> = {
      status: 'status',
      tailored_resume: 'tailored_resume',
      tailored_resume_pdf_url: 'tailored_resume_pdf_path',
      submitted_at: 'submitted_at',
      proof_of_submission: 'proof_of_submission',
      notes: 'notes',
    };
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [k, col] of Object.entries(allowed)) {
      if (k in patch) {
        params.push((patch as Record<string, unknown>)[k]);
        sets.push(`${col} = $${params.length}`);
      }
    }
    if (sets.length === 0) return this.getJob(id);
    // auto-fill submitted_at when marking applied
    if (patch.status === 'applied' && !patch.submitted_at) {
      params.push(new Date().toISOString());
      sets.push(`submitted_at = $${params.length}`);
    }
    params.push(id);
    const row = await one(
      `update jobs set ${sets.join(', ')} where id = $${params.length} returning *`,
      params
    );
    return row ? mapJob(row) : null;
  },
  async createJobs(input: Job[]): Promise<Job[]> {
    const created: Job[] = [];
    for (const j of input) {
      const row = await one(
        `insert into jobs
           (profile_id, title, company, board, url, description,
            compensation_min, compensation_max, compensation_currency, location, status,
            tailored_resume, tailored_resume_pdf_path, submitted_at, proof_of_submission,
            notes, scrape_run_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         returning *`,
        [
          j.profile_id, j.title, j.company, j.board, j.url, j.description,
          j.compensation_min, j.compensation_max, j.compensation_currency, j.location, j.status,
          j.tailored_resume, j.tailored_resume_pdf_url, j.submitted_at, j.proof_of_submission,
          j.notes, j.scrape_run_id,
        ]
      );
      created.push(mapJob(row!));
    }
    return created;
  },
  async dedupeJobsByURL(profileId: string, incoming: { url: string }[]): Promise<boolean[]> {
    const existing = new Set(
      (await all('select url from jobs where profile_id = $1 and url is not null', [profileId])).map(
        (r) => r.url as string
      )
    );
    return incoming.map((j) => !existing.has(j.url));
  },

  // scrape runs
  async listScrapeRuns(): Promise<ScrapeRun[]> {
    const rows = await all('select * from scrape_runs order by created_at desc');
    return rows.map(mapScrapeRun);
  },
  async createScrapeRun(input: Partial<ScrapeRun>): Promise<ScrapeRun> {
    const row = await one(
      `insert into scrape_runs
         (triggered_by, profile_ids, sites, search_terms, location,
          results_wanted, hours_old, status, jobs_found, jobs_added, error_message, started_at, completed_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`,
      [
        input.triggered_by ?? null,
        input.profile_ids ?? [],
        input.sites ?? [],
        input.search_terms ?? [],
        input.location ?? null,
        input.results_wanted ?? 100,
        input.hours_old ?? 72,
        input.status ?? 'pending',
        input.jobs_found ?? 0,
        input.jobs_added ?? 0,
        input.error_message ?? null,
        input.started_at ?? null,
        input.completed_at ?? null,
      ]
    );
    return mapScrapeRun(row!);
  },
  async updateScrapeRun(id: string, patch: Partial<ScrapeRun>): Promise<ScrapeRun | null> {
    const allowed = [
      'status', 'jobs_found', 'jobs_added', 'error_message', 'started_at', 'completed_at',
    ] as const;
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const k of allowed) {
      if (k in patch) {
        params.push((patch as Record<string, unknown>)[k]);
        sets.push(`${k} = $${params.length}`);
      }
    }
    if (sets.length === 0) {
      const row = await one('select * from scrape_runs where id = $1', [id]);
      return row ? mapScrapeRun(row) : null;
    }
    params.push(id);
    const row = await one(
      `update scrape_runs set ${sets.join(', ')} where id = $${params.length} returning *`,
      params
    );
    return row ? mapScrapeRun(row) : null;
  },

  // snippets
  async listSnippets(profileId: string): Promise<QuestionSnippet[]> {
    const rows = await all(
      'select * from question_snippets where profile_id = $1 order by created_at desc',
      [profileId]
    );
    return rows.map(mapSnippet);
  },
  async createSnippet(input: {
    profile_id: string;
    question: string;
    answer: string;
  }): Promise<QuestionSnippet> {
    const row = await one(
      `insert into question_snippets (profile_id, question, answer)
       values ($1,$2,$3) returning *`,
      [input.profile_id, input.question, input.answer]
    );
    return mapSnippet(row!);
  },
  async incrementSnippet(id: string): Promise<void> {
    await query('update question_snippets set use_count = use_count + 1 where id = $1', [id]);
  },
};

export type Db = typeof db;
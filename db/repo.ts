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
import { encryptSecret, decryptSecret } from '../lib/crypto';
import type {
  AppConfig,
  Job,
  JobStatus,
  ListJobsFilter,
  Profile,
  ProfilePreset,
  QuestionSnippet,
  ScrapeRun,
  User,
} from '../lib/types';

// --- text sanitation -------------------------------------------------------
// Postgres rejects NUL (0x00) bytes in text columns ("invalid byte sequence for
// encoding UTF8", sqlstate 22021). Resume/PDF text extraction and scraped
// HTML->text can leak NULs in (pdf-parse/mammoth/JobSpy). Verified empirically:
// NUL is the ONLY byte PG rejects (all other C0 controls and lone surrogates
// are accepted), and lone surrogates are safely encoded to U+FFFD by the pg
// driver — so we strip NUL ONLY. Stripping more (e.g. surrogate-pair ranges)
// would corrupt legitimate emoji/non-BMP text.
const NUL_BYTE = /\u0000/g;

function cleanText(value: unknown): unknown {
  if (typeof value !== 'string' || !value.includes('\u0000')) return value;
  return value.replace(NUL_BYTE, '');
}

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
    presets: (r.presets as unknown as ProfilePreset[]) ?? [],
    jobs_per_week: r.jobs_per_week as number ?? 20,
    deleted_at: r.deleted_at ? (r.deleted_at as Date).toISOString() : null,
    created_at: (r.created_at as Date).toISOString(),
    updated_at: (r.updated_at as Date).toISOString(),
  };
}

// Strip tracking/query noise from a job URL so dedup treats the same posting
// (e.g. with/without ?utm_source or ?gh_src) as identical, without over-blocking
// genuinely different jobs. Missing/empty URLs normalize to a sentinel so they
// never throw (non-string job_url would crash JSON.parse/dedup upstream and
// abort a whole refill) and never collide with a real URL's key.
const EMPTY_URL = '__no_url__';
function normalizeJobURL(url: string): string {
  if (typeof url !== 'string' || url.trim() === '') return EMPTY_URL;
  try {
    const u = new URL(url);
    const keys = Array.from(u.searchParams.keys());
    const keep = keys.filter(
      (k) => !/^(utm_|source|gh_|sc_|mc_|spm_)/i.test(k) && k !== 'ref'
    );
    u.search = keep.length ? keep.map((k) => `${k}=${u.searchParams.get(k)}`).join('&') : '';
    // strip trailing slash + hash
    u.hash = '';
    let s = u.toString();
    s = s.replace(/\/+$/, '');
    return s;
  } catch {
    return url.replace(/[#?].*$/, '').replace(/\/+$/, '');
  }
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
    last_viewed_at: r.last_viewed_at ? (r.last_viewed_at as Date).toISOString() : null,
    is_new: isNewJob(r.created_at),
  };
}

// A job is flagged "NEW" if created within the last 2 days (fresh scrape).
const NEW_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;
function isNewJob(createdAt: unknown): boolean {
  if (!createdAt) return false;
  const t = typeof createdAt === 'string' ? new Date(createdAt) : (createdAt as Date);
  if (Number.isNaN(t.getTime())) return false;
  return Date.now() - t.getTime() < NEW_WINDOW_MS;
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
    patch: { password_hash?: string; full_name?: string; email?: string }
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
  async disableUser(id: string): Promise<User | null> {
    const row = await one(
      `update users set disabled_at = now() where id = $1 returning *`,
      [id]
    );
    return row ? mapUser(row) : null;
  },
  async enableUser(id: string): Promise<User | null> {
    const row = await one(
      `update users set disabled_at = null where id = $1 returning *`,
      [id]
    );
    return row ? mapUser(row) : null;
  },

  // Auth helper: fetch a user's raw row INCLUDING disabled_at (never expose
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
    // Exclude soft-deleted profiles from normal lists.
    const rows = await all(
      'select * from profiles where deleted_at is null order by created_at asc'
    );
    return rows.map(mapProfile);
  },
  async getProfile(id: string): Promise<Profile | null> {
    const row = await one('select * from profiles where id = $1', [id]);
    return row ? mapProfile(row) : null;
  },
  async setProfilePresets(id: string, presets: ProfilePreset[]): Promise<void> {
    await query(
      'update profiles set presets = $2::jsonb, updated_at = now() where id = $1',
      [id, JSON.stringify(presets)]
    );
  },
  async getProfileByWorker(workerId: string): Promise<Profile | null> {
    // Primary client (kept for landing/avatar routing). Full set is in
    // listProfilesByWorker.
    const row = await one(
      `select p.* from worker_clients wc
         join profiles p on p.id = wc.profile_id
        where wc.worker_user_id = $1 and wc.is_primary and p.deleted_at is null
        limit 1`,
      [workerId]
    );
    return row ? mapProfile(row) : null;
  },
  // ALL client profiles a worker currently handles (Option B join table).
  async listProfilesByWorker(workerId: string): Promise<Profile[]> {
    const rows = await all(
      `select p.* from worker_clients wc
         join profiles p on p.id = wc.profile_id
        where wc.worker_user_id = $1 and p.deleted_at is null
        order by wc.is_primary desc, p.name asc`,
      [workerId]
    );
    return rows.map(mapProfile);
  },
  // True if this profile is in the worker's assigned client set.
  async workerHasClient(workerId: string, profileId: string): Promise<boolean> {
    const row = await one(
      'select 1 from worker_clients where worker_user_id = $1 and profile_id = $2',
      [workerId, profileId]
    );
    return !!row;
  },
  // Assign (or import) a client to a worker. If first assignment, make primary.
  async assignClient(workerId: string, profileId: string): Promise<void> {
    await query(
      `insert into worker_clients (worker_user_id, profile_id, is_primary)
       values ($1, $2, (select not exists(
         select 1 from worker_clients where worker_user_id = $1)))
       on conflict (worker_user_id, profile_id)
       do nothing`,
      [workerId, profileId]
    );
    // Mirror the primary onto profiles.assigned_worker_id for the first/primary.
    await query(
      `update profiles set assigned_worker_id = $1
        where id = $2 and (assigned_worker_id is null or assigned_worker_id = $1)`,
      [workerId, profileId]
    );
  },
  // Remove a client from a worker (swap = unassign A, assign B). Clears the
  // primary pointer if it pointed at the removed client.
  async unassignClient(workerId: string, profileId: string): Promise<void> {
    const row = await one(
      'select is_primary from worker_clients where worker_user_id = $1 and profile_id = $2',
      [workerId, profileId]
    );
    await query(
      'delete from worker_clients where worker_user_id = $1 and profile_id = $2',
      [workerId, profileId]
    );
    if (row && row.is_primary) {
      await query(
        'update profiles set assigned_worker_id = null where id = $1 and assigned_worker_id = $2',
        [profileId, workerId]
      );
    }
  },
  // All (worker_id -> profile_ids[]) assignments for the admin assign UI.
  async listWorkerAssignments(): Promise<Record<string, string[]>> {
    const rows = await all(
      `select worker_user_id, profile_id
         from worker_clients
         where (worker_user_id, profile_id) in (
           select wc.worker_user_id, wc.profile_id
           from worker_clients wc join profiles p on p.id = wc.profile_id
           where p.deleted_at is null)`
    );
    const out: Record<string, string[]> = {};
    for (const r of rows as { worker_user_id: string; profile_id: string }[]) {
      (out[r.worker_user_id] ||= []).push(r.profile_id);
    }
    return out;
  },
  // Soft-delete a client profile: hide from lists but keep jobs/history.
  async deleteProfile(id: string): Promise<Profile | null> {
    // Detach the worker link too (they may be reassigned).
    const row = await one(
      `update profiles set deleted_at = now(), assigned_worker_id = null where id = $1 returning *`,
      [id]
    );
    return row ? mapProfile(row) : null;
  },
  // Hard-delete a user account (workers; also used by admin "delete people").
  async deleteUser(id: string): Promise<boolean> {
    await query('delete from users where id = $1', [id]);
    return true;
  },
  // Weekly stats for a worker's assigned client (current ISO week Mon-Sun).
  // applied = jobs marked applied this week; skipped = jobs skipped this week.
  // Anchored on `status_changed_at` (set only when status changes) so a mere
  // view or a late notes/proof edit can't roll a job into the current week.
  async getWorkerWeeklyStats(profileId: string | string[], weekStart: Date): Promise<{
    applied: number;
    skipped: number;
  }> {
    const ids = Array.isArray(profileId) ? profileId : [profileId];
    const row = await one(
      `select
         count(*) filter (where status = 'applied') ::int as applied,
         count(*) filter (where status = 'skipped') ::int as skipped
       from jobs
       where profile_id = ANY($1::uuid[]) and status_changed_at >= $2`,
      [ids, weekStart.toISOString()]
    );
    return {
      applied: (row?.applied as number) ?? 0,
      skipped: (row?.skipped as number) ?? 0,
    };
  },
  // Per-client weekly stats for a worker's assigned profiles (current ISO
  // week Mon-Sun). Returns a map keyed by profile_id so the queue's client
  // switcher can show each client's own applied/skipped for the week.
  async getWorkerWeeklyStatsByClient(
    profileIds: string[],
    weekStart: Date
  ): Promise<Record<string, { applied: number; skipped: number }>> {
    const rows = await all(
      `select profile_id,
              count(*) filter (where status = 'applied') ::int as applied,
              count(*) filter (where status = 'skipped') ::int as skipped
         from jobs
        where profile_id = ANY($1::uuid[]) and status_changed_at >= $2
        group by profile_id`,
      [profileIds, weekStart.toISOString()]
    );
    const out: Record<string, { applied: number; skipped: number }> = {};
    for (const r of rows as { profile_id: string; applied: number; skipped: number }[]) {
      out[r.profile_id] = { applied: r.applied ?? 0, skipped: r.skipped ?? 0 };
    }
    return out;
  },
  async createProfile(input: Partial<Profile>): Promise<Profile> {
    const row = await one(
      `insert into profiles
         (name, email, assigned_worker_id, base_resume_path, base_resume_text,
          scrape_search_terms, scrape_location, scrape_sites, scrape_results_wanted, scrape_hours_old)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
      [
        cleanText(input.name) ?? 'Untitled',
        cleanText(input.email) ?? '',
        input.assigned_worker_id ?? null,
        input.base_resume_url ?? null,
        cleanText(input.base_resume_text) ?? null,
        (input.scrape_search_terms ?? []).map(cleanText) as string[],
        cleanText(input.scrape_location) ?? null,
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
      jobs_per_week: 'jobs_per_week',
    } as const;
    for (const [k, col] of Object.entries(allowed)) {
      if (k in patch) {
        let v = (patch as Record<string, unknown>)[k];
        // Clean free-form text destined for text columns so a NUL can never
        // reach Postgres (sqlstate 22021). Arrays (search terms) map.
        if (typeof v === 'string') v = cleanText(v);
        else if (Array.isArray(v)) v = v.map(cleanText);
        params.push(v);
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
  // Hard-delete jobs older than `days` days from the candidate QUEUE only.
  // Scoped to `status = 'saved'` (not `status <> 'applied'`): the history-delete
  // guard (migration 015) protects `applied`/`skipped` rows, and a bare delete
  // that selects a `skipped` row RAISEs and aborts the WHOLE statement — which
  // silently broke the daily expire cleanup. Deleting only `saved` rows keeps
  // applied/skipped history intact (the product decision) AND never trips the
  // guard. `tailored` rows are skipped too (work in progress, not a finished
  // outcome) so the queue cycle is: saved -> (tailored) -> applied/skipped.
  async deleteExpiredJobs(days: number): Promise<number> {
    const res = await query(
      `delete from jobs
        where created_at < now() - make_interval(days => $1::int)
          and status = 'saved'`,
      [days]
    );
    return Number(res?.rowCount ?? 0);
  },
  async getJob(id: string): Promise<Job | null> {
    const row = await one('select * from jobs where id = $1', [id]);
    return row ? mapJob(row) : null;
  },
  // Resolve the owning job (and its profile) for a stored file path WITHOUT
  // loading the full jobs table. The old approach in /api/files called
  // listJobs({limit:5000}) — a `select * from jobs ... order by created_at desc`
  // that pulled up to N full rows (incl. large `description`/`tailored_resume`
  // text) into memory on EVERY file request just to find one path's owner.
  // This does a single indexed lookup against the two path columns and returns
  // only the fields the files route needs (permission + friendly filename).
  // jobbidder_files_path_idx backs both columns.
  async getJobByFilePath(
    rel: string
  ): Promise<{ id: string; profile_id: string; company: string | null; title: string | null } | null> {
    const row = await one(
      `select id, profile_id, company, title from jobs
        where tailored_resume_pdf_path = $1 or proof_of_submission = $1
        limit 1`,
      [rel]
    );
    if (!row) return null;
    return {
      id: String(row.id),
      profile_id: String(row.profile_id),
      company: (row.company as string | null) ?? null,
      title: (row.title as string | null) ?? null,
    };
  },
  async updateJob(id: string, patch: Partial<Job>): Promise<Job | null> {
    const allowed: Record<string, string> = {
      status: 'status',
      tailored_resume: 'tailored_resume',
      tailored_resume_pdf_url: 'tailored_resume_pdf_path',
      submitted_at: 'submitted_at',
      proof_of_submission: 'proof_of_submission',
      notes: 'notes',
      last_viewed_at: 'last_viewed_at',
    };
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [k, col] of Object.entries(allowed)) {
      if (k in patch) {
        let v = (patch as Record<string, unknown>)[k];
        if (typeof v === 'string') v = cleanText(v);
        params.push(v);
        sets.push(`${col} = $${params.length}`);
      }
    }
    if (sets.length === 0) return this.getJob(id);
    // auto-fill submitted_at when marking applied
    if (patch.status === 'applied' && !patch.submitted_at) {
      params.push(new Date().toISOString());
      sets.push(`submitted_at = $${params.length}`);
    }
    // Record when the status actually changed — this is the weekly-stats anchor
    // (not `updated_at`, which the trigger re-bumps on a mere view/any edit).
    if (patch.status) {
      params.push(new Date().toISOString());
      sets.push(`status_changed_at = $${params.length}`);
    }
    params.push(id);
    const row = await one(
      `update jobs set ${sets.join(', ')} where id = $${params.length} returning *`,
      params
    );
    return row ? mapJob(row) : null;
  },
  async markJobViewed(id: string): Promise<void> {
    await query('update jobs set last_viewed_at = now() where id = $1', [id]);
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
          j.profile_id,
          cleanText(j.title),
          cleanText(j.company),
          cleanText(j.board),
          cleanText(j.url),
          cleanText(j.description) ?? null,
          j.compensation_min,
          j.compensation_max,
          j.compensation_currency,
          cleanText(j.location) ?? null,
          j.status,
          cleanText(j.tailored_resume) ?? null,
          j.tailored_resume_pdf_url,
          j.submitted_at,
          j.proof_of_submission,
          cleanText(j.notes) ?? null,
          j.scrape_run_id,
        ]
      );
      created.push(mapJob(row!));
    }
    return created;
  },
  async dedupeJobsByURL(profileId: string, incoming: { url: string }[]): Promise<boolean[]> {
    const existing = new Set(
      (await all('select url from jobs where profile_id = $1 and url is not null', [profileId])).map(
        (r) => normalizeJobURL(r.url as string)
      )
    );
    return incoming.map((j) => !existing.has(normalizeJobURL(j.url)));
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
  // Delete a scrape-run history record. Jobs created by that run keep their
  // rows — `jobs.scrape_run_id` is `on delete set null`, so they're merely
  // unhooked, never removed. Returns true if a row was deleted.
  async deleteScrapeRun(id: string): Promise<boolean> {
    const res = await query('delete from scrape_runs where id = $1', [id]);
    return Number(res?.rowCount ?? 0) > 0;
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
      [input.profile_id, cleanText(input.question), cleanText(input.answer)]
    );
    return mapSnippet(row!);
  },
  async incrementSnippet(id: string): Promise<void> {
    await query('update question_snippets set use_count = use_count + 1 where id = $1', [id]);
  },

  // app_config — single-row AI provider settings (idempotent id=1).
  async getAppConfig(): Promise<AppConfig | null> {
    const row = await one('select * from app_config where id = 1');
    if (!row) return null;
    let apiKey: string | null = null;
    if (row.ai_api_key_encrypted && row.ai_api_key_nonce) {
      try {
        apiKey = decryptSecret({
          ciphertext: row.ai_api_key_encrypted as string,
          nonce: row.ai_api_key_nonce as string,
        });
      } catch (e) {
        // AUTH_SECRET changed since encryption — fall back to no key.
        apiKey = null;
      }
    }
    return {
      id: row.id as number,
      ai_provider: (row.ai_provider as AppConfig['ai_provider']) ?? 'custom',
      ai_model: (row.ai_model as string) ?? 'claude-sonnet-5',
      ai_base_url: (row.ai_base_url as string) ?? null,
      ai_api_key: apiKey,
      maintenance_message: (row.maintenance_message as string) ?? '',
      maintenance_enabled: Boolean(row.maintenance_enabled),
      updated_at: (row.updated_at as Date).toISOString(),
    };
  },
  async setMaintenance(message: string, enabled: boolean): Promise<AppConfig> {
    await one(
      `insert into app_config (id, maintenance_message, maintenance_enabled, updated_at)
       values (1, $1, $2, now())
       on conflict (id) do update set
         maintenance_message = excluded.maintenance_message,
         maintenance_enabled = excluded.maintenance_enabled,
         updated_at = now()
       returning *`,
      [message, enabled]
    );
    return (await this.getAppConfig())!;
  },
  async setAppConfig(input: {
    provider: AppConfig['ai_provider'];
    model: string;
    baseUrl: string | null;
    apiKey: string | null;
  }): Promise<AppConfig> {
    const enc = input.apiKey ? encryptSecret(input.apiKey) : null;
    const row = await one(
      `insert into app_config (id, ai_provider, ai_model, ai_base_url, ai_api_key_encrypted, ai_api_key_nonce, updated_at)
       values (1, $1, $2, $3, $4, $5, now())
       on conflict (id) do update set
         ai_provider = excluded.ai_provider,
         ai_model = excluded.ai_model,
         ai_base_url = excluded.ai_base_url,
         ai_api_key_encrypted = excluded.ai_api_key_encrypted,
         ai_api_key_nonce = excluded.ai_api_key_nonce,
         updated_at = now()
       returning *`,
      [input.provider, input.model, input.baseUrl, enc?.ciphertext ?? null, enc?.nonce ?? null]
    );
    // Return via getAppConfig to give callers the decrypted key for in-memory use.
    return (await this.getAppConfig())!;
  },
};

export type Db = typeof db;
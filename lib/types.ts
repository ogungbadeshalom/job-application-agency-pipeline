// Shared domain types — mirror the Postgres schema in db/schema.sql.

export type Role = 'admin' | 'worker' | 'client';

export type JobStatus = 'saved' | 'tailored' | 'applied' | 'skipped';

export type ScrapeRunStatus = 'pending' | 'running' | 'completed' | 'failed';

export type Board = 'indeed' | 'linkedin' | 'glassdoor';

export interface User {
  id: string;
  email: string;
  role: Role;
  full_name: string;
  profile_id: string | null;
  disabled_at: string | null;
  created_at: string;
}

export interface ProfilePreset {
  id: string;
  name: string;
  search_terms: string[];
  sites: string[];
  location: string | null;
  remote_only: boolean;
  results_wanted: number;
}

export interface Profile {
  id: string;
  name: string;
  email: string;
  assigned_worker_id: string | null;
  base_resume_url: string | null;
  base_resume_text: string | null;
  resume_design: string;
  scrape_search_terms: string[];
  scrape_location: string | null;
  scrape_sites: string[];
  scrape_results_wanted: number;
  scrape_hours_old: number;
  presets: ProfilePreset[];
  jobs_per_week: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Job {
  id: string;
  profile_id: string;
  title: string;
  company: string;
  board: string;
  url: string;
  description: string;
  compensation_min: number | null;
  compensation_max: number | null;
  compensation_currency: string | null;
  location: string | null;
  status: JobStatus;
  tailored_resume: string | null;
  tailored_resume_pdf_url: string | null;
  submitted_at: string | null;
  proof_of_submission: string | null;
  notes: string | null;
  scrape_run_id: string | null;
  created_at: string;
  updated_at: string;
  last_viewed_at: string | null;
  is_new?: boolean;
}

export interface ScrapeRun {
  id: string;
  triggered_by: string | null;
  profile_ids: string[];
  sites: string[];
  search_terms: string[];
  location: string | null;
  results_wanted: number;
  hours_old: number;
  status: ScrapeRunStatus;
  jobs_found: number;
  jobs_added: number;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface QuestionSnippet {
  id: string;
  profile_id: string;
  question: string;
  answer: string;
  use_count: number;
  created_at: string;
}

// Shapes used by API payloads / scrape integration.

export interface ScrapeConfig {
  profile_ids: string[];
  sites: string[];
  search_terms: string[];
  location: string;
  results_wanted: number;
  hours_old: number;
  remote_only?: boolean;
  job_type?: string;
  include_kw?: string[];
  exclude_kw?: string[];
  remove_easy_apply?: boolean;
}

export interface ScrapeResultJob {
  title: string;
  company: string;
  site: string;
  job_url: string;
  description: string;
  interval_amount: number | null;
  currency: string | null;
  location: string;
  date_posted: string | null;
}

export interface ScrapeRunResult {
  jobs_found: number;
  jobs_added: number;
  jobs: ScrapeResultJob[];
}

// App-level config (single row in app_config). ai_api_key, when set, is the
// DECRYPTED key — never persisted; only the encrypted form is stored.
export interface AppConfig {
  id: number;
  ai_provider: 'anthropic' | 'openrouter' | 'custom' | 'deepseek';
  ai_model: string;
  ai_base_url: string | null;
  ai_api_key: string | null;
  maintenance_message: string;
  maintenance_enabled: boolean;
  updated_at: string;
}

// Filter shape used by listJobs.
export interface ListJobsFilter {
  profile_id?: string | string[];
  profile_ids?: string[];
  status?: JobStatus | JobStatus[];
  search?: string;
  limit?: number;
}

// Status ordering — "status >= applied" shows in the client view.
export const STATUS_ORDER: Record<JobStatus, number> = {
  saved: 0,
  tailored: 1,
  applied: 2,
  skipped: 3,
};

// Client view shows applied jobs (not skipped/saved/tailored).
export const CLIENT_VISIBLE_STATUSES: JobStatus[] = ['applied'];

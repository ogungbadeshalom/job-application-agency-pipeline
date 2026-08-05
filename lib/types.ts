// Shared domain types — mirror the Postgres schema in db/schema.sql.

export type Role = 'admin' | 'worker' | 'client';

export type JobStatus =
  | 'saved'
  | 'tailored'
  | 'applied'
  | 'rejected'
  | 'interview'
  | 'offer'
  | 'withdrawn';

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

export interface Profile {
  id: string;
  name: string;
  email: string;
  assigned_worker_id: string | null;
  base_resume_url: string | null;
  base_resume_text: string | null;
  scrape_search_terms: string[];
  scrape_location: string | null;
  scrape_sites: string[];
  scrape_results_wanted: number;
  scrape_hours_old: number;
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

// Filter shape used by listJobs.
export interface ListJobsFilter {
  profile_id?: string | string[];
  profile_ids?: string[];
  status?: JobStatus | JobStatus[];
  search?: string;
  limit?: number;
}

// Status ordering — "status >= applied" for the client view.
export const STATUS_ORDER: Record<JobStatus, number> = {
  saved: 0,
  tailored: 1,
  applied: 2,
  rejected: 3,
  interview: 4,
  offer: 5,
  withdrawn: 6,
};

export const CLIENT_VISIBLE_STATUSES: JobStatus[] = [
  'applied',
  'rejected',
  'interview',
  'offer',
  'withdrawn',
];

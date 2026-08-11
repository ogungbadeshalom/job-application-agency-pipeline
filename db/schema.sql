-- Job Bidder Platform — Postgres schema (self-hosted).
-- Applies cleanly to a local Docker Postgres or an apt-installed Postgres on a VPS.
-- Run via: npm run db:migrate

-- Enums --------------------------------------------------------------
do $$ begin
  create type user_role as enum ('admin','worker','client');
exception when duplicate_object then null; end $$;

do $$ begin
  create type job_status as enum (
    'saved','tailored','applied','skipped'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type scrape_status as enum ('pending','running','completed','failed');
exception when duplicate_object then null; end $$;

-- ============================================================================
-- users  (auth accounts + roles). id uuid; email unique; password_hash for the
-- Auth.js Credentials provider. role is app-level (no DB RLS) — read from the
-- signed JWT session, backed by this column.
-- ============================================================================
create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  password_hash text not null,
  role          user_role not null default 'client',
  full_name     text not null default '',
  profile_id    uuid,                       -- for clients: their profiles.id
  disabled_at   timestamptz,                -- soft-disable: account can't log in
  created_at    timestamptz not null default now()
);

-- ============================================================================
-- profiles  (clients — the people whose jobs we apply to)
-- ============================================================================
create table if not exists profiles (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  email                 text not null,
  assigned_worker_id    uuid references users(id) on delete set null, -- 1:1 worker
  base_resume_path      text,        -- local-disk relative path (resumes/p1/x.pdf)
  base_resume_text      text,        -- extracted text for AI tailoring
  scrape_search_terms   text[] not null default '{}',
  scrape_location       text,
  scrape_sites          text[] not null default '{}',
  scrape_results_wanted int  not null default 100,
  scrape_hours_old      int  not null default 72,
  jobs_per_week        int  not null default 20,   -- worker's weekly quota for this client
  deleted_at            timestamptz,              -- soft-delete: hidden from lists, data kept
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ============================================================================
-- scrape_runs  (audit trail)
-- ============================================================================
create table if not exists scrape_runs (
  id             uuid primary key default gen_random_uuid(),
  triggered_by   uuid references users(id) on delete set null,
  profile_ids    uuid[] not null default '{}',
  sites          text[] not null default '{}',
  search_terms   text[] not null default '{}',
  location       text,
  results_wanted int not null default 100,
  hours_old      int not null default 72,
  status         scrape_status not null default 'pending',
  jobs_found     int not null default 0,
  jobs_added     int not null default 0,
  error_message  text,
  started_at     timestamptz,
  completed_at   timestamptz,
  created_at     timestamptz not null default now()
);

-- ============================================================================
-- jobs
-- ============================================================================
create table if not exists jobs (
  id                       uuid primary key default gen_random_uuid(),
  profile_id               uuid not null references profiles(id) on delete cascade,
  title                    text not null default '',
  company                  text not null default '',
  board                    text not null default '',
  url                      text not null default '',           -- dedup key
  description              text not null default '',
  compensation_min         int,
  compensation_max         int,
  compensation_currency    text default 'USD',
  location                 text,
  status                   job_status not null default 'saved',
  tailored_resume          text,
  tailored_resume_pdf_path text,
  submitted_at             timestamptz,
  proof_of_submission      text,
  notes                    text,
  scrape_run_id            uuid references scrape_runs(id) on delete set null,
  last_viewed_at           timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists jobs_profile_id_idx  on jobs(profile_id);
create index if not exists jobs_status_idx      on jobs(status);
create index if not exists jobs_profile_url_idx on jobs(profile_id, url);

-- ============================================================================
-- question_snippets  (per-client Q&A library)
-- ============================================================================
create table if not exists question_snippets (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references profiles(id) on delete cascade,
  question    text not null,
  answer      text not null,
  use_count   int not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists snippets_profile_id_idx on question_snippets(profile_id);

-- ============================================================================
-- app_config  (single-row table for in-app AI provider settings)
-- ============================================================================
create table if not exists app_config (
  id                   int primary key default 1,
  ai_provider          text not null default 'custom',
  ai_model             text not null default 'claude-sonnet-5',
  ai_base_url          text,
  ai_api_key_encrypted text,
  ai_api_key_nonce     text,
  updated_at           timestamptz not null default now(),
  check (id = 1)
);

insert into app_config (id) values (1) on conflict (id) do nothing;

-- ============================================================================
-- updated_at triggers
-- ============================================================================
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists profiles_touch_updated_at on profiles;
create trigger profiles_touch_updated_at before update on profiles
  for each row execute function touch_updated_at();

drop trigger if exists jobs_touch_updated_at on jobs;
create trigger jobs_touch_updated_at before update on jobs
  for each row execute function touch_updated_at();
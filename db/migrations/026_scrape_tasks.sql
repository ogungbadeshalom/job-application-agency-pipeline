-- 026_scrape_tasks.sql
-- Pull-based refill task queue: lets a WORKER MACHINE (e.g. Shalom's laptop on
-- a residential IP) pull scrape tasks and run boards the DC VPS can't reach.
-- The server only QUEUES tasks (status pending); the laptop agent claims one,
-- scrapes via JobSpy on its own residential IP, POSTs results back, and the
-- server ingests them through the normal dedupe+insert pipeline.
-- Laptop off = tasks just stay pending (no error). Laptop on = processes queue.
CREATE TABLE IF NOT EXISTS scrape_tasks (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid references profiles(id) on delete cascade,
  sites         text[] not null,
  search_terms  text[] not null,
  location      text not null default 'Remote',
  results_wanted int not null default 60,
  hours_old     int not null default 168,
  is_remote     boolean not null default true,
  remove_easy_apply boolean not null default true,
  status        text not null default 'pending' check (status in ('pending','claimed','done','failed')),
  claimed_at    timestamptz,
  completed_at  timestamptz,
  jobs_found    int not null default 0,
  jobs_added    int not null default 0,
  error_message text,
  created_at    timestamptz not null default now()
);
-- Only one worker should claim a task.
CREATE INDEX IF NOT EXISTS idx_scrape_tasks_status ON scrape_tasks (status, created_at);

-- API token the laptop agent uses to claim/complete tasks (auth at the API
-- layer; rotate by writing a new value).
ALTER TABLE app_config ADD COLUMN IF NOT EXISTS scrape_agent_token text;
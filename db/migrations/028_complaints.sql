-- 028_complaints.sql
-- Worker complaints/issues channel. Workers report software problems directly;
-- each entry lands in the table where it can be surfaced to the admin / agent
-- for triage and fixing.
CREATE TABLE IF NOT EXISTS complaints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  profile_id uuid,               -- optional client context (the worker's client)
  category text NOT NULL DEFAULT 'other',
  subject text NOT NULL,
  detail text NOT NULL,
  url text,                      -- optional related job posting / page
  status text NOT NULL DEFAULT 'open',  -- open | in_progress | resolved | wontfix
  admin_note text,
  notified_at timestamptz,             -- set when the owner is emailed about it (dedup guard)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS complaints_status_idx ON complaints(status);
CREATE INDEX IF NOT EXISTS complaints_created_idx ON complaints(created_at DESC);
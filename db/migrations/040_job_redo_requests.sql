-- Client "redo this application" flags.
--
-- Modeled as a FLAG on the job rather than a new job_status value: a redo is a
-- request against a delivered application, not a stage the job moves through.
-- Keeping status untouched means the existing pipeline (applied -> confirmed ->
-- interview) and the client-visibility rules keep working unchanged, and a
-- flagged job still shows the client that the application was in fact sent.
--
-- Lifecycle:
--   redo_requested_at null            -> nothing flagged
--   redo_requested_at set, resolved null -> waiting on the assigned worker
--   redo_resolved_at set              -> worker reworked it; flag closed
alter table jobs add column if not exists redo_requested_at timestamptz;
alter table jobs add column if not exists redo_reason text;
alter table jobs add column if not exists redo_note text;
alter table jobs add column if not exists redo_resolved_at timestamptz;
alter table jobs add column if not exists redo_resolved_by uuid
  references users(id) on delete set null;

-- Worker queue filters "needs rework" per client; this keeps that cheap as the
-- jobs table grows (it is already in the thousands of rows).
create index if not exists jobs_redo_open_idx
  on jobs (profile_id, redo_requested_at desc)
  where redo_requested_at is not null and redo_resolved_at is null;

-- Soft-delete for client profiles: a deleted profile is hidden from lists but
-- its jobs/history stay intact. Also add the worker's weekly-per-client quota.

alter table profiles add column if not exists deleted_at timestamptz;
alter table profiles add column if not exists jobs_per_week int not null default 20;
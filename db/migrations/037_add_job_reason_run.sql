-- Hermes: add per-job outcome reason + run attribution for the ApplyOS seam.
alter table jobs add column if not exists reason_string text;
alter table jobs add column if not exists run_id text;
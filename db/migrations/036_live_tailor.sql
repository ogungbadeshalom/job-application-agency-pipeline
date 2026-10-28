-- Live tailor: per-job tailoring stage surfaced to clients in real time.
-- Stages: generating -> ats-scoring -> improving -> finalizing -> done (null = idle / not tailoring).

alter table jobs add column if not exists tailor_status text;
create index if not exists jobs_tailor_status_idx on jobs(tailor_status);
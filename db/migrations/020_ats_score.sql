-- ATS score + structured feedback for a job, computed by the AI when a worker
-- scans a job against the client's base resume (resume-ATS integration). Stored
-- on the job so workers/clients can see the fitness score + improvement tips.
alter table jobs add column if not exists ats_score integer;
alter table jobs add column if not exists ats_feedback jsonb;
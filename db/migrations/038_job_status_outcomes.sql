-- Hermes: extend job_status so the ApplyOS seam can persist the outcome statuses
-- the app's dashboard buckets on (applied/failed/skipped/confirmed/interview).
alter type job_status add value if not exists 'failed';
alter type job_status add value if not exists 'confirmed';
alter type job_status add value if not exists 'interview';
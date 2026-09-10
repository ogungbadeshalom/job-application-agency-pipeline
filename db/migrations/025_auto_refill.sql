-- 025_auto_refill.sql
-- Admin-toggled daily auto-refill for workers.
-- auto_refill_enabled: master switch (admin sets via UI)
-- auto_refill_time:    HH:MM in server-local 24h time when the daily run fires
-- auto_refill_last_run: last time a run actually started (dedupes the daily fire)
ALTER TABLE app_config ADD COLUMN IF NOT EXISTS auto_refill_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE app_config ADD COLUMN IF NOT EXISTS auto_refill_time text NOT NULL DEFAULT '09:00';
ALTER TABLE app_config ADD COLUMN IF NOT EXISTS auto_refill_last_run timestamptz;
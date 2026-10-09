-- 032_auto_refill_flag.sql — per-profile auto-refill switch.
-- Shalom (Oct 2026): pause per-client refills without touching anything else.
alter table profiles add column if not exists auto_refill boolean not null default true;

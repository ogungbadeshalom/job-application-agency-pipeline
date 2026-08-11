-- 010: named search presets per profile (reusable refill configs).
alter table profiles add column if not exists presets jsonb not null default '[]'::jsonb;
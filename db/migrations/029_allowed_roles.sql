-- 029: per-profile strict role allowlist.
-- When non-empty, ONLY jobs whose title contains one of these phrases may enter
-- the profile's queue (refill scrape, worker refill, auto-refill, manual add).
-- Empty array = no restriction (other clients unaffected).
alter table profiles add column if not exists allowed_roles text[] not null default '{}';
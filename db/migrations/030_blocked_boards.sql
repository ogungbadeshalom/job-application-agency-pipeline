-- 030: per-profile board denylist.
-- When non-empty, these boards are removed from every refill's site list for
-- the profile (admin scrape, worker refill, auto-refill) — even if the request
-- explicitly includes them. Andrew: dice disabled (client doesn't want Dice jobs).
alter table profiles add column if not exists blocked_boards text[] not null default '{}';
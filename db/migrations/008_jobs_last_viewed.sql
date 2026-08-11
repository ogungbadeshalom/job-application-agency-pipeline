-- 008: worker "continue where I left off" — track last viewed job per profile.
alter table jobs add column if not exists last_viewed_at timestamptz;
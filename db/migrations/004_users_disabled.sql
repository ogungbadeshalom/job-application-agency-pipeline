-- Soft-disable users: disabled_at set means the user cannot log in, but
-- foreign-keyed data (jobs they applied, etc.) is preserved.

alter table users add column if not exists disabled_at timestamptz;
create index if not exists users_disabled_at_idx on users(disabled_at) where disabled_at is not null;

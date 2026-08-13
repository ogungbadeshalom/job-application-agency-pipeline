-- OPTION B: a worker may now handle MULTIPLE client profiles (join table).
-- Keeps profiles.assigned_worker_id as the "primary" client for routing/avatar,
-- but worker queues/history read from this table to span all assigned clients.
create table if not exists worker_clients (
  worker_user_id uuid references users(id) on delete cascade,
  profile_id     uuid references profiles(id) on delete cascade,
  is_primary     boolean not null default false,
  primary key (worker_user_id, profile_id)
);

-- Backfill from the existing 1:1 assignments so no current client is orphaned.
insert into worker_clients (worker_user_id, profile_id, is_primary)
select assigned_worker_id, id, true
from profiles
where assigned_worker_id is not null
  and deleted_at is null
on conflict do nothing;
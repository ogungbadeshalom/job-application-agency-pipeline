-- Reconcile: some profiles have assigned_worker_id set (legacy/other path) but no
-- corresponding worker_clients join row, so the worker never sees that client in
-- their queue. Backfill any missing rows so the join table is the single source
-- of truth for worker->clients, keeping is_primary=false (the PK is assigned by
-- the assign UI / primary pointer, don't guess more than one primary).
insert into worker_clients (worker_user_id, profile_id, is_primary)
select p.assigned_worker_id, p.id, false
from profiles p
where p.assigned_worker_id is not null
  and p.deleted_at is null
  and not exists (
    select 1 from worker_clients wc
    where wc.worker_user_id = p.assigned_worker_id and wc.profile_id = p.id
  )
on conflict do nothing;
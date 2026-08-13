-- Fix 013's backfill. `013` added the column as `not null default now()`, so PG
-- pre-populated EVERY existing row with the migration timestamp before the
-- `where status_changed_at is null` backfill could run — leaving all old rows
-- stamped "now" (wrongly counting every historical job as changed this week).
--
-- Re-derive the anchor for existing rows from their real semantics:
--   applied  -> when they were submitted (submitted_at)
--   otherwise -> the last time they were actually written (updated_at)
update jobs set status_changed_at =
  case
    when status = 'applied' and submitted_at is not null then submitted_at
    else coalesce(updated_at, created_at, status_changed_at)
  end;
-- Simplify job statuses: remove offer/interview/rejected, rename withdrawn -> skipped.
-- Resulting enum: saved, tailored, applied, skipped.
--
-- Postgres can't drop enum values in place. We create a new enum, switch the
-- column to text, rewrite values, then swap the type back and drop the old one.
-- Old values are mapped: withdrawn/offer/interview -> applied (still "done"),
-- rejected -> skipped.

-- 1. Create the new enum under a temp name.
do $$
begin
  create type job_status_new as enum ('saved','tailored','applied','skipped');
exception when duplicate_object then null; end $$;

-- 2. Drop the old default so the type can be swapped, then cast to text.
alter table jobs alter column status drop default;
alter table jobs alter column status type text;

-- 3. Rewrite values in string form, then cast to the new enum.
update jobs set status = 'skipped' where status in ('withdrawn','rejected');
update jobs set status = 'applied' where status in ('offer','interview');
alter table jobs alter column status type job_status_new
  using status::job_status_new;

-- 4. Drop the old enum and rename the new one to take its place.
drop type job_status;
alter type job_status_new rename to job_status;

-- 5. Restore the default.
alter table jobs alter column status set default 'saved'::job_status;
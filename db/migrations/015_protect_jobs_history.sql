-- Guard against accidentally deleting APPLIED / SKIPPED history.
--
-- WHY: board-level cleanups ("remove all Indeed jobs") were twice run as bare
-- `DELETE FROM jobs WHERE board='...'`, which also removed `applied`/`skipped`
-- rows — nuking real application history and dropping "Applied this week". This
-- trigger makes that impossible to do silently:
--   - A plain DELETE on an applied/skipped job now RAISES and aborts.
--   - To intentionally purge history you must first run:
--       SET jobbidder.allow_history_delete = '1';   -- same transaction/session
--     in the SAME session that does the delete (a session-local switch, off by
--     default, so a stray script can't trip it).
--
-- scoped: only guards the jobs table. Deleting SAVED (queue) rows is fine.
create or replace function guard_jobs_history_delete() returns trigger language plpgsql as $$
begin
  -- Only block when the row is an outcome (applied/skipped) AND the caller has
  -- not explicitly opted into history deletion for this session.
  if old.status in ('applied', 'skipped')
     and coalesce(current_setting('jobbidder.allow_history_delete', true), '') <> '1'
  then
    raise exception
      'Refusing to delete % job #% ("%") — applied/skipped history is protected. '
      'To intentionally delete history, SET jobbidder.allow_history_delete=''1'' in this session first.',
      old.status, old.id, left(coalesce(old.title,''),60);
  end if;
  return old;
end $$;

drop trigger if exists jobs_protect_history_delete on jobs;
create trigger jobs_protect_history_delete
  before delete on jobs
  for each row execute function guard_jobs_history_delete();
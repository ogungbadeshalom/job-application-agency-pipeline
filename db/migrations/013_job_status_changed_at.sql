-- Track when a job's status LAST changed, independently of `updated_at`.
--
-- The `jobs_touch_updated_at` trigger re-bumps `updated_at` on EVERY update —
-- including a mere mark-as-viewed. Weekly "Applied this week / Skipped this
-- week" counters (getWorkerWeeklyStats / _ByClient) were filtering on
-- `updated_at`, so a simple view (or a later notes/proof edit) silently rolled a
-- job into the current week's counts, and marking applied/skipped a *last-week*
-- scrape job never moved the counter (updateJob never touches updated_at).
--
-- `status_changed_at` is set only when status actually changes, so the weekly
-- window is accurate and immune to unrelated updates.

alter table jobs add column if not exists status_changed_at timestamptz not null default now();

-- Backfill: an applied job's most faithful "when it became applied" is its
-- submitted_at; for non-applied jobs the only sensible proxy we have is the
-- last update timestamp. New/unknown rows default to created_at.
update jobs set status_changed_at =
  case
    when status = 'applied' and submitted_at is not null then submitted_at
    else coalesce(updated_at, created_at)
  end
where status_changed_at is null;
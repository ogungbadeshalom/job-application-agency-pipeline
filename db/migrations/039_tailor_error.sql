-- Async tailoring: surface a terminal error to the UI while a background
-- tailor run is in flight. `tailor_status` carries the live stage and is
-- cleared when the run finishes (success or failure); `tailor_error` carries
-- the failure reason so the worker sees WHY it failed instead of a spinner
-- that never stops.
alter table jobs add column if not exists tailor_error text;

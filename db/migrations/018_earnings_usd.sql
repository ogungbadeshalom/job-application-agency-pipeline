-- Earnings config: switch to a USD-per-application * conversion model.
-- Each confirmed application pays usd_per_app (private), converted to naira
-- at ngn_per_usd. Display targets the naira weekly cap.
alter table earnings_config
  add column if not exists usd_per_app  numeric(12,6) not null default 0.0105,
  add column if not exists ngn_per_usd  numeric(12,2) not null default 1350;

-- backfill a sensible naira-per-app for any existing rows (for display only).
update earnings_config
  set per_app_naira = usd_per_app * ngn_per_usd
  where id = 1;
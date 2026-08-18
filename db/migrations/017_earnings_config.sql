-- Earnings pool meter config (singleton, like app_config).
-- Holds the admin-editable figures used to compute a worker's weekly naira pool.
-- These are PRIVATE (never exposed to workers). Worker UI only sees the derived
-- naira-this-week + weekly cap.
create table if not exists earnings_config (
  id            int primary key default 1 check (id = 1),
  -- per-application (naira) paid to the worker; hidden from the worker UI.
  per_app_naira numeric(12,2) not null default 0,
  -- weekly cap in naira for the pool meter.
  weekly_cap_naira numeric(12,2) not null default 3500,
  week_start     text         not null default 'monday' check (week_start in ('monday')),
  updated_at     timestamptz  not null default now()
);

insert into earnings_config (id) values (1) on conflict (id) do nothing;

-- earnings_config uses the same updated_at touch as other tables
create or replace function touch_earnings_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists earnings_config_touch_updated_at on earnings_config;
create trigger earnings_config_touch_updated_at before update on earnings_config
  for each row execute function touch_earnings_updated_at();
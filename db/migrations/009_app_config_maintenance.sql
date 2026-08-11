-- 009: maintenance / announcement banner (admin writes a toggleable message).
alter table app_config add column if not exists maintenance_message text default '';
alter table app_config add column if not exists maintenance_enabled boolean not null default false;
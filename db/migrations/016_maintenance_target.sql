-- 016: role-targeted maintenance / announcement banner.
-- Adds a target audience so a notice can be shown to workers, clients,
-- admins, or everyone. 'all' matches all roles.
alter table app_config add column if not exists maintenance_target text not null default 'all';
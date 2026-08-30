-- Per-user accent color preference (Settings → Appearance → Accent color).
-- Empty/default = the app default (RED). Valid values: red, green, blue,
-- purple, orange, cyan. Stored server-side so a worker's choice follows them
-- across any browser/device they sign in on.
alter table users add column if not exists accent text not null default '';
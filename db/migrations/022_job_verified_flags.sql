-- Verified-remote + Easy-Apply flags for jobs.
--   verified_remote  bool  : the pipeline fetched the real job description +
--                            confirmed work_type=remote, so a worker can trust
--                            it qualifies before applying (no manual re-check).
--   easy_apply       bool  : job was posted with LinkedIn "Easy Apply" — these
--                            are excluded from refills (users don't want them);
--                            flag kept so existing rows can be identified.
alter table jobs add column if not exists verified_remote boolean not null default false;
alter table jobs add column if not exists easy_apply    boolean not null default false;
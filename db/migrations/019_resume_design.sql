-- Per-client resume design preset. Default 'classic'. Workers pick this in the
-- Resume Lab; all tailored resumes for the client render in that style.
alter table profiles add column if not exists resume_design text not null default 'classic';
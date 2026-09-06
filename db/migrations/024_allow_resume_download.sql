-- Per-profile control over whether the client can download tailored resumes as
-- PDFs. Default true (existing clients keep download). Set false to lock a
-- client out of PDF download (view still allowed; download button + /api/pdf
-- are gated).
alter table profiles
  add column if not exists allow_resume_download boolean not null default true;
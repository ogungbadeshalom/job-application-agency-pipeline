-- 016: index the job file-path columns for the /api/files owner lookup.
-- The files route resolves a stored path to its owning job (profile + a friendly
-- filename) via `where tailored_resume_pdf_path = $1 or proof_of_submission = $1`.
-- Two single-column btree indexes let Postgres probe either path directly instead
-- of scanning the jobs table.
create index if not exists jobs_tailored_resume_pdf_path_idx on jobs(tailored_resume_pdf_path);
create index if not exists jobs_proof_of_submission_idx on jobs(proof_of_submission);
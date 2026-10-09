-- 033_require_proof.sql — per-profile proof requirement toggle.
-- Shalom (Oct 2026): Andrew + Olumuyiwa profiles don't need workers to attach
-- proof-of-submission; clicking 'Mark Applied' is enough to count as done.
alter table profiles add column if not exists require_proof boolean not null default true;

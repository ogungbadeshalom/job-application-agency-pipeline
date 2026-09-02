-- Structured, per-client, editable resume content for the Resume Lab.
-- When set, the Resume Lab editor + live preview + PDF generation use this
-- structured data instead of heuristically parsing base_resume_text.
alter table profiles
  add column if not exists resume_data jsonb;  -- ResumeSection[] / structured content
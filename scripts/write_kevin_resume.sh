#!/bin/bash
set -a
source "${1:-/root/job-agency/.env.local}"
set +a
# load JSON from file into psql var and write it as the profile's resume_data
psql "$DATABASE_URL" <<'SQL' >/tmp/kevin_write.log 2>&1
\set content `cat /tmp/kevin_resume.json`
UPDATE profiles
SET resume_data = :'content'::jsonb
WHERE id = '22f82386-0b76-40b8-9dc6-d674f9843d10';
SQL
cat /tmp/kevin_write.log
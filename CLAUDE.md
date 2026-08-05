# CLAUDE.md — Job Bidder Platform

Multi-tenant job-bidding agency tool. Admin clicks "Refill Jobs" → JobSpy runs → new jobs land in queue → worker uses AI to tailor resume + answer questions → marks as applied. Client sees read-only view.

## Tech Stack

Next.js 14 (App Router) + TypeScript + Tailwind (dark mode) + **PostgreSQL (self-hosted)** + **Auth.js (NextAuth v5)** + Claude API + JobSpy (Python subprocess). Local-disk storage. Deploy via PM2 + Cloudflare tunnel.

## User Roles

| Role | What They Do |
|---|---|
| **Admin** (1) | Manage clients + workers, click "Refill Jobs" to scrape, upload base resumes per client, see all jobs, reset passwords |
| **Worker** (3) | Log in, see only their assigned client's jobs, tailor/apply one at a time |
| **Client** (3) | Read-only view of jobs applied for their profile |

**Worker assignment:** 1 worker permanently assigned to 1 client. No rotation.

**Accounts:** admin + workers + clients are records in the `users` table with bcrypt-hashed passwords. Admin creates users in-app (Add Worker / Add Client modals) and resets passwords in Settings → Team.

## Architecture

**Three backend pillars — no mock, no Supabase:**

1. **PostgreSQL (self-hosted)**
   - Driver: `pg` (node-postgres). Single `DATABASE_URL` env var.
   - DB layer in `db/`: `pool.ts` (connection pool + helpers), `schema.sql` (DDL), `migrate.ts` + `seed.ts` (scripts), `repo.ts` (the `db` object used by pages/routes).
   - Local dev: `npm run db:up` (Docker Compose) then `db:migrate` + `db:seed`. On the VPS: `apt install postgresql`, create DB/role, same `DATABASE_URL`.
   - Host port for the compose DB is **5434** (avoids conflicts with other local Postgres).

2. **Auth.js (NextAuth v5, Credentials + JWT)**
   - `app/api/auth/[...nextauth]/route.ts` + `lib/auth.ts` (exports `handlers, auth, signIn, signOut, currentUser, requireRole, homeForRole, getSession`).
   - Config in `lib/auth-config.ts`: Credentials provider, bcrypt compare, role on JWT/session.
   - Login at `/login` (real email+password). Logout via `signOut` in the layout.
   - **App-level role checks only** (NO database RLS). Single chokepoint: `requireRole(...roles)` in `lib/auth.ts`. API routes use `getSession()` → `session.user`.

3. **Local disk storage**
   - Files (uploaded resumes, tailored PDFs) under `STORAGE_DIR` (default `./data/uploads`, gitignored).
   - `lib/storage.ts` — read/write/delete with safe path resolution.
   - `/api/files/[...path]` serves files after an auth check.

## Data Models (Postgres — db/schema.sql)

```sql
users:
  id uuid PK, email text unique, password_hash text, role user_role
    ('admin'|'worker'|'client'), full_name text, profile_id uuid, created_at

profiles:
  id uuid PK, name, email, assigned_worker_id uuid FK users(id),
  base_resume_path text,            -- local-disk relative path
  base_resume_text text,           -- extracted text for AI tailoring
  scrape_search_terms text[], scrape_location text, scrape_sites text[],
  scrape_results_wanted int, scrape_hours_old int, created_at, updated_at

jobs:
  id uuid PK, profile_id uuid FK, title, company, board, url (dedup key),
  description, compensation_min/max int, compensation_currency, location,
  status job_status ('saved'|'tailored'|'applied'|'rejected'|'interview'|'offer'|'withdrawn'),
  tailored_resume text, tailored_resume_pdf_path text,
  submitted_at, proof_of_submission, notes, scrape_run_id, created_at, updated_at

scrape_runs:
  id uuid PK, triggered_by uuid, profile_ids uuid[], sites text[],
  search_terms text[], location, results_wanted int, hours_old int,
  status scrape_status, jobs_found int, jobs_added int, error_message,
  started_at, completed_at, created_at

question_snippets:
  id uuid PK, profile_id uuid FK, question text, answer text, use_count int, created_at
```

**Domain types** live in `lib/types.ts` and are column-mirrored. The `db` object in `db/repo.ts` maps DB rows → domain types (e.g. `base_resume_path` → `base_resume_url`, `tailored_resume_pdf_path` → `tailored_resume_pdf_url`), so call sites stay stable.

## Pages

### `/admin/dashboard` (4 tabs, dark mode)
- **Applications tab**: Job table — # | Job Title | Client | Company | Board | Link | Compensation | Status | Resume | JD | Proof | Dates. Filters: client, status, search. **Refill Jobs** button (top right).
- **Refill Jobs Modal**: sites, search terms, location, results/term, hours old, target profiles → POST `/api/scrape` → JobSpy → "N new jobs added".
- **Profiles tab**: Client table + **Add Worker** / **Add Client** modals (creates real user accounts with passwords).
- **Resumes tab**: per-client base resume (upload → `/api/upload`, stored to disk + text extracted). Download via `/api/files/`.
- **Settings tab**: Team list with **Reset password**, API key config, scrape run history.

### `/worker/queue`
Table of jobs for the worker's assigned client. Columns — # | TITLE | COMPANY | BOARD | COMPENSATION | STATUS | ACTIONS (Tailor / Mark Applied / Skip).

### `/worker/job/[id]` (two columns)
Left: job details (title, company, board, location, comp, JD, status, dates). Right: 3 tabs — Tailor Resume, Answer Question, Submission Tracking.

### `/client/jobs` (READ ONLY)
Table of the client's applied jobs (status ≥ applied). Row → modal with tailored resume (read-only).

## Auth Flow (real credentials)

1. User submits email+password at `/login` → `signIn('credentials')`.
2. Auth.js Credentials authorize() looks up the user by email, compares bcrypt hash.
3. On success, a signed JWT session cookie is set. `role` rides on the JWT + is reflected in `session.user`.
4. Server components / routes call `requireRole(...)` (page-level) or `getSession()` (API-level) to enforce role checks.

**Admin password bootstrap:** `npm run db:seed` uses `ADMIN_EMAIL` / `ADMIN_PASSWORD` env (default `admin@jobbidder.com` / `changeme`).

## Storage (local disk)

- Root: `STORAGE_DIR` (default `./data/uploads`), gitignored.
- DB stores relative paths like `resumes/<profileId>/<hex>.pdf`.
- `lib/storage.ts`: `writeStorage / readStorage / statStorage / removeStorage / newStoragePath`.
- `/api/files/[...path]` — authorize (admin any; worker assigned client; client own profile) then stream the file.

## JobSpy Integration

**Flow:**
1. Admin clicks "Refill Jobs" → fills form → submits.
2. Node creates `scrape_runs` row with status=`running`.
3. Node spawns `python scripts/run_jobspy.py <config> <tmpfile>` (Windows uses `python`; otherwise `python3`).
4. Python writes JSON output to the temp file. It sanitizes all values (NaN/Infinity→null, numpy/pandas scalars→native) so the output is valid JSON.
5. Node reads the file, re-replaces stray `NaN`/`Infinity` defensively, dedupes by URL per profile, inserts jobs.
6. Updates `scrape_runs.status='completed'`, `jobs_added`.

**Install:** `pip install jobspy pandas`

**Anti-ban:** rely on JobSpy's built-in rate limiting. v2: rotating proxies.

## AI Integration

Two endpoints, single `callAI()` in `lib/ai.ts`:

```typescript
export async function callAI(system: string, user: string, opts?: {maxTokens?, temperature?}): Promise<string>
```

Provider via env — `AI_PROVIDER` = `anthropic` (default) | `openrouter` | `custom` (OpenCode/Ollama/LM Studio). Model via `AI_MODEL` (default `claude-sonnet-5`).

**AI stub:** on by default (`AI_STUB=true`) — no key needed, deterministic labeled output. Set `AI_STUB=false` + a real key to call the model. This prevents accidental paid calls.

**Resume tailor prompt (system):** Rewrite resume to match a JD; don't fabricate; reorder bullets; keep dates/companies/titles exact.

**Question helper prompt (system):** first-person, under 150 words, concrete resume examples.

**Environment:** pick ONE provider's key (`ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, or `AI_BASE_URL`/`AI_API_KEY`).

## Job Status Lifecycle

```
saved → tailored → applied → (rejected | interview | offer | withdrawn)
```

Status ≥ applied shows in the client view.

## Build Order

1. Postgres: `db/` (pool, schema, repo) + Docker Compose; `npm run db:migrate` + `db:seed`.
2. Auth.js: config + route + `/login` + `lib/auth.ts` helpers.
3. Storage: `lib/storage.ts` + `/api/files/[...path]`.
4. Pages: admin dashboard (4 tabs), worker queue, worker job detail, client view.
5. JobSpy + `/api/scrape` + Refill Jobs modal.
6. AI + `/api/tailor` / `/api/answer`.
7. Deploy: PM2 + Cloudflare tunnel.

## Settings Check

**Files you should keep in sync if you touch the DB layer:** `db/repo.ts`, `lib/types.ts`. **Auth:** `lib/auth.ts`, `lib/auth-config.ts`, `app/api/auth/[...nextauth]/route.ts`. **Storage:** `lib/storage.ts`.

## Deploy (PM2 + Cloudflare tunnel)

```bash
npm install && pip install jobspy pandas
npx auth secret   # set AUTH_SECRET
# set DATABASE_URL, ADMIN_PASSWORD, ANTHROPIC_API_KEY in .env.local
npm run db:migrate && npm run db:seed
npm run build
pm2 start npm --name job-bidder -- start
pm2 start cloudflared --name job-bidder-tunnel -- tunnel --url http://localhost:3000
```

## What NOT To Build

- ❌ Auto-applying (against ToS)
- ❌ Email parsing (manual is fine)
- ❌ Multi-language (English only)
- ❌ Resume version history (just latest)
- ❌ Team chat, email notifications, calendar, cover letters, built-in PDF viewer

## Reference Projects

- `/root/bintrack-demo/` — Next.js + Tailwind + dark mode patterns
- `/root/apps/job-ops/` — JobSpy Python patterns
- `/root/job-bidder/db/` — this project's own Postgres + Auth.js + storage patterns

Use these for patterns, not copy-paste.
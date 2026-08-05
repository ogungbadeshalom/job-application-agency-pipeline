# Job Bidder

Multi-tenant job-bidding agency platform. Admin clicks **Refill Jobs** → JobSpy scrapes → jobs land in the queue → worker uses AI to tailor a resume and answer questions → marks as applied → client sees a read-only view.

**Stack:** Next.js 14 (App Router) · TypeScript · Tailwind (dark mode) · **PostgreSQL (self-hosted)** · **Auth.js (NextAuth v5, credentials+JWT)** · Claude API · JobSpy (Python subprocess) · local-disk file storage.

## Roles

| Role | What they do |
|---|---|
| **Admin** (1) | Manage clients + workers, scrape jobs, upload base resumes, reset passwords, see everything |
| **Worker** (3) | Log in and tailor/apply one assigned client's jobs, one at a time |
| **Client** (3) | Read-only view of jobs applied on their behalf |

**1 worker : 1 client** assignment, no rotation. Role checks are **app-level** (`lib/auth.ts` requireRole) — no database RLS.

## Quick start (local dev)

**Prereqs:** Node 18+, Docker (for local Postgres), or a reachable Postgres you can point at.

```bash
npm install
pip install jobspy pandas          # optional: enables real scraping

# 1. Start Postgres
docker compose up -d db             # host port 5434
#    (or point DATABASE_URL at your own Postgres)

# 2. Apply schema + seed accounts
npm run db:migrate
npm run db:seed

# 3. Run
npm run dev
```

Open http://localhost:3000 → `/login`. Default admin: `admin@jobbidder.com` / `changeme` (set `ADMIN_PASSWORD` before seeding for real use). Admin can add/edit workers and clients, soft-disable accounts, reset passwords, upload resumes, run scrapes, and configure the AI provider in-app.

> If Docker Hub is unreachable, use a local Postgres and set `DATABASE_URL` in `.env.local` accordingly (port 5432 with a local install worked when Docker couldn't pull).

## Environment (`.env.local`)

```
DATABASE_URL=postgres://jobbids:jobbids@localhost:5434/job_bidder
AUTH_SECRET=...                    # npx auth secret
AUTH_TRUST_HOST=true
ADMIN_EMAIL=admin@jobbidder.com    # for npm run db:seed
ADMIN_PASSWORD=changeme
STORAGE_DIR=./data/uploads         # local disk, gitignored

# AI — provider/model/key are configured in-app at Admin → Settings → AI
# Configuration (encrypted-at-rest in app_config). The env vars below are an
# OPTIONAL fallback when no row exists (e.g. first boot).
#
# AI_STUB=true (default) = deterministic demo output, no key needed.
# AI_STUB=false + a real key (env OR app_config) = real model calls.
#
# ANTHROPIC_API_KEY=sk-ant-...
# AI_PROVIDER=anthropic
# AI_MODEL=claude-sonnet-5
AI_STUB=true
```

Other providers (env fallback only — preferred path is the in-app config):
- OpenRouter: `AI_PROVIDER=openrouter`, `OPENROUTER_API_KEY=...`
- Custom (Ollama/LM Studio/OpenCode/freeinference.org): `AI_PROVIDER=custom`, `AI_BASE_URL=...`, `AI_MODEL=...`, `AI_API_KEY=...`

## Architecture

```
app/
  (auth)/login/          Real email+password login (Auth.js credentials)
  api/auth/[...nextauth] Auth.js route handler
  admin/dashboard/       4 tabs: Applications, People & Clients, Resumes, Settings + Refill Jobs
    hooks/useJobs.ts     controlled jobs state (in-place refresh after scrape)
    tabs/                ProfilesTab, ResumesTab, SettingsTab, AIConfigPanel, EditUserModal
  worker/queue/          Job queue for the worker's client
  worker/job/[id]/       2-column detail: job info + (Tailor | Answer | Submission)
  client/jobs/           Read-only applied-jobs view
  api/
    scrape/              spawns scripts/run_jobspy.py, dedupes, inserts jobs
    tailor/  answer/     AI endpoints (stub by default; DB-backed config)
    jobs/  jobs/[id]     list + update with role checks
    profiles/  users/    admin CRUD (users also handles worker/client + passwords)
    users/[id]/          soft-disable/enable endpoint
    config/              AI provider settings GET/PUT (encrypted-at-rest)
    snippets/            per-client Q&A library
    pdf/  upload/  files/  PDF gen + upload + auth-gated file serving
db/
  pool.ts                pg pool + helpers (loads .env.local for tsx)
  schema.sql             Postgres DDL (enums, tables, triggers)
  migrations/            idempotent ALTER/CREATE scripts (run after schema.sql)
  migrate.ts  seed.ts    scripts
  repo.ts                the `db` object used by pages/routes
lib/
  auth.ts  auth-config.ts   Auth.js singleton + requireRole/getSession
  db.ts   types.ts   storage.ts   ai.ts   pdf.ts   resume-text.ts   crypto.ts
components/                DashboardLayout, JobTable, Modal, StatusBadge, panels, RefillJobsModal, Icon
scripts/
  run_jobspy.py           JobSpy runner (JSON-safe output)
  setup.sh                one-shot dev setup
  test-access.mjs          role-access tests via real Auth.js login
```

## Auth (real credentials, app-level roles)

- Accounts live in `users` with bcrypt-hashed passwords.
- `lib/auth.ts` exports `requireRole(...)` (page gate) and `getSession()` (API gate). Role rides on the signed JWT.
- Admin management: **Profiles → Add Worker / Add Client** modals, **Settings → Team → Reset password**.
- Run `node scripts/test-access.mjs` (with the server up) to verify role checks.

## Storage (local disk)

- Uploads + tailored PDFs under `STORAGE_DIR` (default `./data/uploads`, gitignored). DB stores relative paths.
- `/api/files/[...path]` serves files after an auth check (admin any; worker assigned client; client own profile).

## JobSpy

Refill Jobs spawns `python scripts/run_jobspy.py <config> <out.json>`, which calls the `jobspy` library. It sanitizes output to valid JSON (NaN/Infinity → null). Node dedupes by URL per profile and inserts. Windows uses `python`; elsewhere `python3`.

## Deploy (VPS / PM2 + Cloudflare tunnel)

```bash
# On the Hetzner VPS:
apt install postgresql
sudo -u postgres createuser -P jobbids
sudo -u postgres createdb -O jobbids job_bidder

npm install && pip install jobspy pandas
npx auth secret                     # set AUTH_SECRET
# set DATABASE_URL, ADMIN_PASSWORD, ANTHROPIC_API_KEY in .env.local
npm run db:migrate && npm run db:seed
npm run build

pm2 start npm --name job-bidder -- start
pm2 start cloudflared --name job-bidder-tunnel -- tunnel --url http://localhost:3000
pm2 logs job-bidder-tunnel          # grab the public URL
```

## What it deliberately doesn't do

No auto-applying, email parsing, multi-language, resume version history, team chat, notifications, calendar, or cover letters. Status transitions are manual.
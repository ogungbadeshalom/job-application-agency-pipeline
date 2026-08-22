# Job Bidder

**Multi-tenant AI job-application agency** — scrape job boards, auto-tailor a resume per role, and track applications across admins, workers, and clients.

Admin clicks **Refill Jobs** → JobSpy scrapes live boards → jobs land in each client's queue → a worker opens a job and the **AI tailors the client's resume to that exact JD** → marks it applied → the client sees a read-only view with week-by-week history.

> Built to run an agency at **$0** — self-hosted Postgres, free-scrape boards, and an OpenAI-compatible model (e.g. `freeinference.org`, Ollama, LM Studio) — no paid CRM, no paid enrichment.

---

## ✨ Screenshots

**Admin — Applications** (every job across clients with filters, dedup, and statuses)
![Admin Applications](docs/screenshots/admin-applications.png)

**Admin — People & Clients** (workers ↔ clients, assignment, quotas)
![Admin Profiles](docs/screenshots/admin-profiles.png)

**Admin — Resumes** (per-client base resume upload, text extraction, and a one-click **General preset** generator that auto-derives ~10 fitting roles from each resume)
![Admin Resumes](docs/screenshots/admin-resumes.png)

**Admin — Settings** (AI provider config, earnings rates, team, maintenance banner, scrape history, downloadable backups)
![Admin Settings](docs/screenshots/admin-settings.png)

**Worker — Queue** (their client's jobs with Working/Applied/Skipped tabs, a weekly earnings pool meter, and a worker self-serve **Refill** button with loading + results feedback)
![Worker Queue](docs/screenshots/worker-queue.png)

**Worker — Completion History** (applied jobs grouped by week)
![Worker History](docs/screenshots/worker-history.png)

---

## Roles

| Role | What they do |
|---|---|
| **Admin** | Manage clients + workers, run scrapes, upload base resumes, configure AI, reset passwords, broadcast maintenance notices, see everything |
| **Worker** | Tailor + apply their single assigned client's jobs, one at a time |
| **Client** | Read-only view of jobs applied on their behalf + week-by-week history |

**1 worker : 1 client**, no rotation. Role checks are app-level (`lib/auth.ts` `requireRole`) — no DB RLS.

---

## Features

- **Job scraping** via JobSpy across 10+ boards (Indeed, LinkedIn, RemoteOK, WeWorkRemotely, Remotive, WorkingNomads, Greenhouse, SmartRecruiters, BuiltIn, ZipRecruiter) with per-board timeouts so one slow board can't stall a run.
- **AI resume tailoring** — the LLM returns structured JSON; rendered into a clean A4 **PDF** per job via react-pdf (`@react-pdf/renderer`). Downloadable as a proper `.pdf`.
- **Policy-aware search** — search by title, company, **board, or location**; status + client filters.
- **Role-specific UIs** — dense tables on desktop, **compact cards on mobile**.
- **"Continue where I left off"** — DB-backed last-viewed cursor so a worker resumes exactly where they stopped (survives refresh / devices).
- **Weekly completion history** for workers and clients.
- **Maintenance / announcement banner** the admin can toggle for downtime or notices.
- **Encrypted AI keys** (AES-256-GCM), local-disk resume/PDF storage, auth-gated file serving.

---

## Quick start (local dev)

**Prereqs:** Node 18+, Docker (local Postgres) or a reachable Postgres, Python 3 for real scraping.

```bash
npm install
pip install jobspy pandas          # optional: enables real scraping

# 1. Postgres
docker compose up -d db             # host port 5434
#    or set DATABASE_URL to your own Postgres

# 2. Apply schema + seed accounts
npm run db:migrate
npm run db:seed

# 3. Run
npm run dev
```

Open http://localhost:3000 → `/login`. Default admin: `admin@jobbidder.com` / `changeme` (set `ADMIN_PASSWORD` before seeding for real use). Use **Settings → AI Configuration** to add a model key.

## Environment (`.env.local`)

```env
DATABASE_URL=postgres://jobbids:***@localhost:5434/job_bidder
AUTH_SECRET=...                    # npx auth secret
AUTH_TRUST_HOST=true
ADMIN_EMAIL=admin@jobbidder.com
ADMIN_PASSWORD=change-me
STORAGE_DIR=./data/uploads          # gitignored

# AI (fallback only — configure in-app at Settings → AI)
AI_STUB=true                       # true = deterministic demo output, no key
# AI_PROVIDER=custom                # openrouter | anthropic | deepseek | custom
# AI_MODEL=deepseek-v4-flash
# AI_BASE_URL=https://freeinference.org/v1
# AI_API_KEY=...
```

Other providers: `openrouter` (`OPENROUTER_API_KEY`), `anthropic` (`ANTHROPIC_API_KEY`), `deepseek`/`custom` (base URL + key). **All keys are encrypted at rest in `app_config`** once set in-app.

## Architecture

```
app/
  (auth)/login/          real email+password (Auth.js credentials+JWT)
  api/auth/[...nextauth] Auth.js handler
  admin/dashboard/       4 tabs + Refill Jobs (scrape) + hooks/useJobs
  worker/queue/          worker client's job queue (+ continue-where-I-left-off)
  worker/job/[id]/       2-column detail: job info + Tailor | Answer | Submission
  worker/history/        weekly completion history
  client/jobs/           read-only applied jobs
  client/history/        client app history grouped by week
  api/
    scrape/              spawns scripts/run_jobspy.py, dedup, insert
    tailor/              AI -> structured JSON -> react-pdf -> stored .pdf
    files/[...path]      auth-gated resume / tailored-PDF / proof serving
    jobs, profiles, users, config, snippets, upload, upload-proof, pdf
db/    pool.ts  schema.sql  migrations/ migrate.ts seed.ts repo.ts
lib/   auth.ts  ai.ts  resume-pdf.tsx  storage.ts  crypto.ts  types.ts
components/   DashboardLayout (sidebar), JobTable, Modal, StatusBadge, panels
scripts/run_jobspy.py  JobSpy runner (per-board timeout, JSON-safe output)
```

## JobSpy + scraping

**Refill Jobs** spawns `scripts/run_jobspy.py <config> <out.json>`, which calls the `jobspy` library per (term, site) with a **per-board deadline** (so LinkedIn blocking can't hang a run), sanitizes NaN/Infinity, and Node **dedupes by URL** per profile before inserting.

## Deploy (VPS / PM2 + Cloudflare tunnel)

```bash
apt install postgresql
sudo -u postgres createuser -P jobbids
sudo -u postgres createdb -O jobbids job_bidder

npm install && pip install jobspy pandas
npx auth secret
# set DATABASE_URL, ADMIN_PASSWORD, and in-app AI config
npm run db:migrate && npm run db:seed && npm run build

pm2 start npm --name job-bidder -- start
pm2 start cloudflared --name job-bidder-tunnel -- tunnel --url http://localhost:3000
pm2 logs job-bidder-tunnel        # the public trycloudflare URL
```

## Backups

`backup.sh` dumps the Postgres DB + uploads into one dated `.tar.gz`; `restore.sh` brings it back. Runs daily via cron. Copy archives off-server.

## What it deliberately doesn't do

No auto-email-reply sourcing, multilingual, multi-language resumes/version history, chat, calendar, or notifications. Status transitions are manual (worker-driven).
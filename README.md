# Pitchr

**Multi-tenant AI job-application agency** — scrape job boards, auto-tailor a client's resume per role, submit the application, and track everything across admins, workers, and clients. *(Formerly "Job Bidder"; rebranded to Pitchr.)*

Admin clicks **Refill Jobs** → jobs land in each client's queue → a worker opens a job and the **AI tailors the client's resume to that exact JD** → marks it applied (with proof) → the client sees a read-only view with week-by-week history and per-week resume downloads.

> Built to run the agency at **$0** — self-hosted Postgres, free-scrape boards, and an OpenAI-compatible model (e.g. `freeinference.org`, Ollama, LM Studio) — no paid CRM, no paid enrichment.

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
| **Worker** | Tailor + apply their assigned client's jobs, one at a time |
| **Client** | Read-only view of jobs applied on their behalf + week-by-week history + download tailored resumes by week |

Worker↔client assignment is managed in-app (admin); one worker can serve one or several clients, and one client can have multiple roles from the same company (the old one-role-per-company rule was removed). Role checks are app-level (`lib/auth.ts` `requireRole`) — no DB RLS.

---

## Features

- **Job scraping** via JobSpy across the enabled boards (Greenhouse, BuiltIn, Jobicy, RemoteOK, WorkingNomads, Ashby, SmartRecruiters…). Dead/blocked boards (LinkedIn anonymous, Indeed, Lever, ZipRecruiter from a datacenter IP) are pruned from the UI options. **Remote-only client queues** use the logged-in **Agent-Reach LinkedIn** path (`npm run refill:remote`) which fetches full descriptions, marks `verified_remote`, and excludes Easy Apply.
- **AI resume tailoring** — the LLM returns structured JSON; rendered into a clean A4 **PDF** per job via react-pdf (`@react-pdf/renderer`). Downloadable as a proper `.pdf`, named `Company - Role.pdf`.
- **ATS scoring** — each job gets an `ats_score` + `ats_feedback` (migration 020).
- **Policy-aware search** — by title, company, board, or location; status + client filters.
- **Role-specific UIs** — dense tables on desktop, compact cards on mobile.
- **"Continue where I left off"** — DB-backed last-viewed cursor per worker.
- **Weekly completion history** + per-week **resume ZIP download** for clients.
- **Proof capture** — Chrome extension (`Pitchr Proof Capture`) + `require_proof` per profile.
- **Maintenance / announcement banner**, encrypted AI keys (AES-256-GCM), local-disk storage, auth-gated file serving.
- **Per-profile `auto_refill` + `require_proof` flags** (migrations 032/033).
- **Public marketing site** at `/` (static pages, clean URLs) + **Pitchr FX** (currency converter + calculator PWA) at `/fx`.

---

## Quick start (local dev)

**Prereqs:** Node 18+, Docker (local Postgres) or a reachable Postgres, Python 3 for real scraping.

```bash
npm install
pip install jobspy pandas          # optional: enables real scraping

# 1. Postgres
npm run db:up                      # docker compose, host port 5434
#    or set DATABASE_URL to your own Postgres

# 2. Apply schema + seed accounts
npm run db:migrate
npm run db:seed

# 3. Run
npm run dev
```

Open http://localhost:3000 → `/login`. Default seed accounts use password `changeme` (admin = `ADMIN_EMAIL`/`ADMIN_PASSWORD` from env; set these before seeding for real use). Use **Settings → AI Configuration** to add a model key.

## Environment (`.env.local`)

```env
DATABASE_URL=postgres://jobbids:***@localhost:5434/job_bidder
AUTH_SECRET=...                    # npx auth secret
AUTH_TRUST_HOST=true
ADMIN_EMAIL=admin@jobbidder.com
ADMIN_PASSWORD=change-me
STORAGE_DIR=./data/uploads         # gitignored
DEPLOY_SECRET=...                  # HMAC secret for the auto-deploy webhook

# AI (fallback only — configure in-app at Settings → AI)
AI_STUB=true                       # true = deterministic demo output, no key
# AI_PROVIDER=custom               # openrouter | anthropic | deepseek | custom
# AI_MODEL=deepseek-v4-flash
# AI_BASE_URL=https://freeinference.org/v1
# AI_API_KEY=...
```

Other providers: `openrouter` (`OPENROUTER_API_KEY`), `anthropic` (`ANTHROPIC_API_KEY`), `deepseek`/`custom` (base URL + key). **All keys are encrypted at rest in `app_config`** once set in-app. `JOBBIDDER_TOKEN` (env) is the worker/laptop scrape-agent token — keep its name unchanged (workers depend on it).

## Architecture

```
app/
  (auth)/login/          real email+password (Auth.js credentials+JWT)
  api/auth/[...nextauth] Auth.js handler
  admin/dashboard/       4 tabs + Refill Jobs (scrape) + hooks/useJobs
  worker/queue/          worker client's job queue (+ continue-where-I-left-off)
  worker/job/[id]/       2-column detail: job info + Tailor | Answer | Submission
  worker/history/        weekly completion history
  client/jobs/           read-only applied jobs + per-week resume downloads
  client/history/        client app history grouped by week
  api/
    scrape/              spawns scripts/run_jobspy.py, dedup, insert
    tailor/              AI -> structured JSON -> react-pdf -> stored .pdf
    files/[...path]      auth-gated resume / tailored-PDF / proof serving
    deploy-webhook/      auto-deploy receiver (HMAC-verified, POST-only)
    jobs, profiles, users, config, snippets, upload, upload-proof, pdf
db/    pool.ts  schema.sql  migrations/ migrate.ts seed.ts repo.ts
lib/   auth.ts  ai.ts  aiJobMatch.ts  resume-pdf.tsx  storage.ts  crypto.ts  types.ts
components/   DashboardLayout (sidebar), JobTable, Modal, StatusBadge, panels
scripts/run_jobspy.py  JobSpy runner (per-board timeout, JSON-safe output)
scripts/refill_remote.ts  Agent-Reach LinkedIn refill (remote-only, verified)
public/    static marketing site (index.html + pages) + fx/ PWA
```

## JobSpy + scraping

**Refill Jobs** spawns `scripts/run_jobspy.py <config> <out.json>` — calls the `jobspy` library per (term, site) with a **per-board deadline** (so a blocked board can't hang a run), sanitizes NaN/Infinity, and Node **dedupes by URL** per profile before inserting. The AI role-fit gate (`lib/aiJobMatch.ts`) filters by the client's resume before rows are created.

## Deploy — AUTO-DEPLOYED via GitHub webhook (production)

Production runs on a self-hosted VPS via PM2 (`job-bidder`, port 3000) behind a named Cloudflare tunnel → **https://pitchr.com.ng**.

**Deploys are fully automatic — push to `main` and the box rebuilds itself:**
1. Push to `main` → GitHub webhook (id `695730033`) POSTs to `https://pitchr.com.ng/api/deploy-webhook`
2. The receiver `app/api/deploy-webhook/route.ts` verifies the HMAC-SHA256 (`x-hub-signature-256` vs `DEPLOY_SECRET`) and spawns `/root/auto_deploy.sh` (returns 200 immediately)
3. The script pulls (ff-only), **backs up `.next` → `.next.bak`**, frees memory (`drop_caches`, swappiness), rebuilds `--no-lint` with a capped heap, and on **any failure restores `.next.bak`** so the site is never left dark.
4. `pm2 start job-bidder` runs the new build.

**You do NOT manually rebuild** unless the auto-deploy failed (check `/tmp/jobbidder_autodeploy.log`). A ~2-3 min app downtime during a successful rebuild is normal.

### Manual deploy (if you must)
```bash
cd /root/job-agency
pm2 stop job-bidder
rm -rf .next
node node_modules/.bin/next build --no-lint   # --no-lint: repos' ESLint is noisy; type-check still runs
pm2 start job-bidder
```
Verify: `curl http://localhost:3000/login` → 200.

### VPS setup from scratch
```bash
apt install postgresql
sudo -u postgres createuser -P jobbids
sudo -u postgres createdb -O jobbids job_bidder
npm install && pip install jobspy pandas
npx auth secret
# set DATABASE_URL, ADMIN_PASSWORD, DEPLOY_SECRET, and in-app AI config
npm run db:migrate && npm run db:seed && npm run build
pm2 start npm --name job-bidder -- start
# named Cloudflare tunnel -> pitchr.com.ng (config /root/.cloudflared/pitchr.yml)
```

## Cache-control note

Production pages send `Cache-Control: private, no-cache, no-store, must-revalidate` (set in `next.config.js` `headers()`) so a rebuild is visible without a hard-refresh; hashed `/_next/static` assets are `immutable` for speed. Next's default `s-maxage=31536000` on prerendered pages was the "I must hard-refresh after every deploy" bug — overridden.

## Backups

The production box runs a cron (6h) that dumps Postgres + uploads into a dated archive and prunes to safe retention. Gate and packaging live in `~/.hermes/scripts/backup_job_bidder.sh`. The offsite GitHub repo carries the DB dump; on-site archives are the sole copy of uploaded PDFs/proofs. Restore = `pg_restore` the dump into a fresh DB + copy `data/uploads`.

## What it deliberately doesn't do

No auto-email-reply sourcing, multilingual resumes/version history, chat, calendar, or notifications. Status transitions are manual (worker-driven) plus the automated scrape/refill pipeline.
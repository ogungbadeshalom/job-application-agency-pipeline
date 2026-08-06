# Deployment Guide — Job Bidder

Target audience: an autonomous AI agent (e.g. a fresh Claude Code / worker context) that
must deploy this app to a VPS with **no human hand-holding**. Follow these steps in order.
Re-run this file start-to-finish on a clean VPS; do not skip steps.

The app is a Next.js 14 (App Router) + PostgreSQL + Auth.js (NextAuth v5) job-bidding
platform. Admin scrapes job boards → workers tailor resumes with AI → clients see the
result. Deploy target: a single Hetzner (or similar) Ubuntu VPS with PM2 + Cloudflare
tunnel. Postgres runs directly on the host (apt), not in a container.

---

## 0. Repository + assumptions

- Repo: `git@github.com:ogungbadeshalom/job-application-agency-pipeline.git` (branch `main`).
- You must have: `ssh` access to the VPS, `sudo`, PostgreSQL server packages reachable,
  outbound internet, and the ability to `git clone` (HTTPS or SSH).
- The app expects Ubuntu/Debian paths (`apt`). If the VPS is CentOS/Alpine, translate
  `apt` → `dnf`/`apk` and adjust the Postgres service start, but the app logic is identical.
- Node version: **≥ 20** (built and tested on Node 22.13.1). Python ≥ 3.10 for JobSpy.

---

## Step 1 — provision the VPS and install base packages

Run these as the deploy user (assume `root` unless told otherwise).

```bash
# system packages
apt update && apt upgrade -y
apt install -y git curl build-essential postgresql postgresql-contrib nginx
# Node 20+ via NodeSource (or use your VPS's preferred method)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
# Python + build tools for JobScraper/popular libs
apt install -y python3 python3-pip python3-venv libssl-dev libffi-dev

node -v      # confirm >= 20
python3 -V   # confirm >= 3.8
```

> **Gotcha:** If Node is < 20 the build (Next.js 14) will fail. Install Node 20/22 LTS.

---

## Step 2 — database: create role + database (Postgres apt)

```bash
# become the postgres superuser
sudo -u postgres psql

# inside psql:
CREATE ROLE jobbids WITH LOGIN PASSWORD 'jobbids';
CREATE DATABASE job_bidder OWNER jobbids;
\q
```

Record the resulting connection string:

```
DATABASE_URL=postgres://jobbids:jobbids@localhost:5432/job_bidder
```

> **Port is critical:** the row-level **NO RLS** design means one Postgres user has full
> access. This is fine for a single-tenant self-hosted tool but do not expose Postgres to
> the public internet — leave it listening on `localhost` (default).
>
> The app's default `DATABASE_URL` in `.env.example` uses port **5434** (a Docker
> convenience). On a bare apt Postgres it's **5432**. Set whichever matches reality in
> `.env.local` (Step 4).

---

## Step 3 — get the code + install deps

```bash
cd /opt
git clone https://github.com/ogungbadeshalom/job-application-agency-pipeline.git
cd job-bidder
npm install --no-audit --no-fund

# Python deps: the project's fork (JobSpy) + pandas
pip3 install --upgrade "git+https://github.com/ogungbadeshalom/JobSpy.git"
pip3 install pandas jobspy
```

> **JobSpy fork**: the app's `scripts/run_jobspy.py` shells out to a `jobspy` module.
> Install the **user's fork** (the repo README or `scripts/setup.sh` documents which
> GitHub fork). If you never install jobspy, the app still runs — scraping just returns a
> clear error. Scraping is optional for a first deployment but required for real use.

---

## Step 4 — write `.env.local`

```bash
cd /opt/job-bidder
cat > .env.local <<'EOF'
DATABASE_URL=postgres://jobbids:jobbids@localhost:5432/job_bidder
AUTH_SECRET=<a long random base64 string>
AUTH_TRUST_HOST=true

# Seed the one admin account (used by `npm run db:seed`):
ADMIN_EMAIL=admin@yourdomain.com
ADMIN_PASSWORD=<a strong admin password>

# Local disk for uploads + tailored PDFs (gitignored):
STORAGE_DIR=./data/uploads
EOF
```

**Generate `AUTH_SECRET`** with:

```bash
npx auth secret
# or: openssl rand -base64 24
```

> `AUTH_SECRET` doubles as the key for encrypting the in-app AI API key (AES-256-GCM via
> PBKDF2). If you change it later, already-saved AI keys will fail to decrypt (the app
> falls back to "no key"). Keep it stable.
>
> `AUTH_TRUST_HOST=true` is required when the app runs behind a Cloudflare tunnel /
> reverse proxy, otherwise Auth.js may reject the host.

**AI keys are NOT in the env**: the admin configures the AI provider + model + key
in-app (Settings → AI Configuration). The env fallback (e.g. `ANTHROPIC_API_KEY`) is used
only before the admin saves a row. Do not set AI keys in `.env.local` unless you want a
first-boot fallback.

**`AI_STUB`**: leave it unset for normal behavior (stub output only when no key is
configured). Set `AI_STUB=false` to force live even without a key (not recommended).

---

## Step 5 — run migrations + seed

```bash
cd /opt/job-bidder
npm run db:migrate      # creates tables + applies db/migrations/*.sql once (tracked in _migrations)
npm run db:seed        # creates the admin (ADMIN_EMAIL / ADMIN_PASSWORD) + 3 workers + 3 clients
```

Confirm success:

```bash
# Connect as the app user (password "jobbids"):
PGPASSWORD=jobbids psql -h localhost -U jobbids -d job_bidder -c "\dt"
# Expect: app_config, profiles, scrape_runs, question_snippets, jobs, users, (+ _migrations)
```

> **Gotchas:**
> - `npm run db:migrate` is idempotent and tracks applied files in `_migrations`. It will
>   NOT rerun an already-applied migration. If you add a migration later, it runs the new
>   ones only.
> - **DO NOT run the schema by hand** — always use `npm run db:migrate`.
> - The seed uses `ADMIN_PASSWORD` from `.env.local`. Change `ADMIN_EMAIL`/`ADMIN_PASSWORD`
>   before seeding to avoid a default `admin@jobbidder.com`/`changeme` account.

---

## Step 6 — build the production bundle

```bash
cd /opt/job-bidder
npm run build
```

Expected: `Compiled successfully` + `Generating static pages (19/19)`.

> **If the build fails:**
> - `next: command not found` → run `npm install` again.
> - Check Node ≥ 20.
> - TypeScript/ESLint errors are treated as build failures. Fix them before proceeding
>   (`npm run typecheck`).

Test the production server locally first:

```bash
npm start              # or: PORT=3000 node_server ...
curl -s http://localhost:3000/ | head -5
```

> Visit `/login` — the page should render. Logging in is the final smoke test (Step 8).

---

## Step 7 — persist + supervise with PM2 (systemd also fine)

```bash
npm install -g pm2
cd /opt/job-bidder
pm2 start npm --name job-bidder -- start
pm2 save
pm2 startup systemd   # prints a command; run it as instructed to boot on reboot
```

> The app writes uploaded files to `STORAGE_DIR` (default `./data/uploads`, gitignored).
> If you run PM2 with a different working directory, point `STORAGE_DIR` at an absolute
> path so it survives restarts and is on a drive with space.

---

## Step 8 — expose it (reverse proxy + TLS)

You have two supported options. **Recommended: Cloudflare tunnel** (no open port, no
cert bot):

### Option A — Cloudflare tunnel

```bash
# install cloudflared on the VPS, then:
cloudflared tunnel --url http://localhost:3000               # quick test
# persistently (if authed):
cloudflared tunnel run --token <your-tunnel-token> job-bidder
```

Then add the tunnel's public hostname (e.g. `https://jb.example`) as
`NEXTAUTH_URL=http://...` / ensure `AUTH_TRUST_HOST=true`.

### Option B — nginx reverse proxy (if you have a domain)

`/etc/nginx/sockets-enabled/default`:

```nginx
server {
  listen 80;
  server_name jobs.YOUR-DOMAIN.com;   # replace with your real hostname
  server_tokens off;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Then `nginx -t && systemctl reload nginx`, and obtain TLS with `certbot --nginx` if you
have a public domain.

> **Gotchas:**
> - Auth.js cookies are `SameSite=Lax`; keep the app + browser on the same public origin
>   (no cross-origin uploads for local dev/testing).
> - Keep `AUTH_TRUST_HOST=true`. If you change the public hostname later, clear the auth
>   cookie or set `AUTH_URL`/`NEXTAUTH_URL` correctly.

---

## Step 9 — verify / smoke test (done from the VPS or your dev machine)

1. `curl -s http://localhost:3000/` → HTTP 307 redirect to `/login` (unauthenticated).
2. Open the public URL in a browser → `/login`.
3. Log in with `ADMIN_EMAIL`/`ADMIN_PASSWORD`.
4. **Admin → Profiles**: create a worker + client, assign 1:1.
5. **Admin → Resumes**: upload a base resume (PDF or a plain `.txt`). Expect success.
6. **Admin → Applications → Refill Jobs**: pick sites → run. If jobspy is installed and
   the target boards resolve, expect inserted jobs. (See "known runtime limits".)
7. **Admin → Settings → AI Configuration**: pick provider + model + API key. Save. Verify
   the panel shows a "Configured" pill with a masked key.
8. **Worker → queue**: log in as a worker, open a job, Tailor / Answer / Submission, and
   see the status flip immediately (no hard refresh).
9. **Client**: verify the applied-jobs counter and see the proof-of-submission image.

---

## Capability + runtime limits you should surface to the team

- The scraper sources are those the **project's JobSpy fork** supports: indeed, linkedin,
  glassdoor, ziprecruiter, remoteok, builtin (see `scripts/run_jobspy.py`). The picker
  only enables `indeed, linkedin, remoteok, builtin`; glassdoor + zip_recruiter shown but
  disabled because they are anti-bot / unreliable on some networks.
- RemoteOK only matches **single-token** search terms; the app retries with single tokens
  when a multi-word search returns nothing, but may return fewer jobs than other boards.
- Board domains (e.g. `api.ziprecr.com`, `www.glassdoor.com`) are sometimes
  DNS-firewalled per VPS; expect `0` results for those sources on a blocked network.
- **No row-level security**: role checks are app-level only; safe for a trusted 1+3+3
  group, do not add users you don't trust.
- **Encryption**: the in-app AI API key is encrypted at rest with AES-256-GCM, key from
  `AUTH_SECRET`. Do not lose `AUTH_SECRET` or saved keys become undecryptable.

---

## Troubleshooting quick reference

| Symptom | Cause / fix |
|---|---|
| `npm run dev` starts but `/login` 404 | Old `.next` cached — `rm -rf .next && npm run build`. |
| Upload "hangs" | Possibly `req.formData()` under undici. The app uses a manual multipart parser; if it still hangs, check reverse proxy streaming (see §8 headers) and that `STORAGE_DIR` is writable by the PM2 user. |
| `Could not extract text` on PDF resume | The PDF is image-only / scanned; pdf-parse can't extract. Upload a DOCX or text-based PDF. |
| Login says "invalid credentials" | Account disabled (`users.disabled_at` set) or wrong password. Reset in admin. |
| Fresh agent build fails at `npm run build` | Node < 20 or missing devDeps. Re-run `npm install`. |
| Domain resolves but scrape returns 0 | Board is anti-bot / network-firewalled. Check the specific `board` with a short single-token term. |

---

## Final checklist (agent self-check before signing off)

- [ ] `npm run db:migrate && npm run db:seed` succeeded; `_migrations` + all tables exist
- [ ] `.env.local` has a real `AUTH_SECRET`, `DATABASE_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`
- [ ] `npm run build` → `Compiled successfully`, 19 static pages
- [ ] `npm start` + `curl /` → 307 to `/login`
- [ ] PM2 started + saved, `pm2 startup` configured for reboot
- [ ] Reverse proxy / tunnel serves over HTTPS, `AUTH_TRUST_HOST=true`
- [ ] Admin logs in; can add worker/client; can resume-upload; can run a Refill scrape;
      can save AI config; worker status updates instantly; client view + counter + proof
- [ ] `STORAGE_DIR` writable and persistent; not inside a build-cleaned dir
- [ ] Documented any deviations in a final summary message
#!/bin/bash
# Job Bidder Platform — development setup (Postgres + Auth.js + local disk).
# Works in Git Bash on Windows and on macOS/Linux.
set -e
echo "Setting up Job Bidder Platform…"

# --- Node dependencies ------------------------------------------------------
if [ ! -d node_modules ]; then
    echo "→ Installing npm dependencies…"
    npm install --no-fund --no-audit
else
    echo "→ node_modules present, skipping npm install."
fi

# --- .env.local -------------------------------------------------------------
if [ ! -f .env.local ]; then
    cat > .env.local <<'EOF'
DATABASE_URL=postgres://jobbids:jobbids@localhost:5434/job_bidder
AUTH_SECRET=dev-only-insecure-secret-change-me
AUTH_TRUST_HOST=true
ADMIN_EMAIL=admin@jobbidder.com
ADMIN_PASSWORD=changeme
STORAGE_DIR=./data/uploads

# AI — Anthropic (stub on by default; set AI_STUB=false + a real key to go live)
ANTHROPIC_API_KEY=placeholder
AI_PROVIDER=anthropic
AI_MODEL=claude-sonnet-5
AI_STUB=true
EOF
    echo "⚠️  Created .env.local with dev defaults. Update ADMIN_PASSWORD + AUTH_SECRET for real use."
fi

# --- Database (Docker local Postgres) ---------------------------------------
if command -v docker &> /dev/null; then
    echo "→ Starting Postgres via Docker (docker compose up -d db)…"
    docker compose up -d db
    echo "→ Applying schema + seed…"
    npm run db:migrate
    npm run db:seed
else
    echo "→ Docker not found. Install Docker (or run Postgres yourself) and set DATABASE_URL,"
    echo "  then run: npm run db:migrate && npm run db:seed"
fi

echo ""
echo "✅ Setup complete."
echo "   • npm run dev     (open http://localhost:3000)"
echo "   • Log in with ADMIN_EMAIL / ADMIN_PASSWORD above."
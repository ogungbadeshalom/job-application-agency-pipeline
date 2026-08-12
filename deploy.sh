#!/usr/bin/env bash
# Job Bidder deploy — clean rebuild + restart in one step.
# Prevents the recurring Next.js stale-.next chunk-404 (present-on-disk-but-404)
# that a bare `pm2 restart` does NOT fix. Use for every deploy.
set -euo pipefail
cd /root/job-agency

echo "→ git pull"
git pull origin main

echo "→ npm install (if deps changed)"
npm install

echo "→ migrating (if schema changed)"
npm run db:migrate || echo "  (no migration needed / skipped)"

echo "→ CLEAN rebuild (rm -rf .next && npm run build)"
pm2 stop job-bidder >/dev/null 2>&1 || true
rm -rf .next
npm run build

echo "→ start app"
pm2 start job-bidder >/dev/null 2>&1 || pm2 restart job-bidder
sleep 5

echo "→ verify"
BID=$(cat .next/BUILD_ID)
echo "  BUILD_ID=$BID"
curl -s -o /dev/null -w "  localhost /login: %{http_code}\n" --max-time 12 http://localhost:3000/login
# Report any 404-ing chunk (should be none on a clean build)
HIT=$(curl -s http://localhost:3000/login | tr '"' '\n' | grep -E "chunks/[0-9]+-[0-9a-f]+\.js" | head -1)
base=$(basename "$HIT")
curl -s -o /dev/null -w "  entry chunk $base: %{http_code}\n" --max-time 10 "http://localhost:3000/_next/static/$HIT"

echo "✓ Deploy complete. (User: hard-refresh Ctrl+Shift+R.)"
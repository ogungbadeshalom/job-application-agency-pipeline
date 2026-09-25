#!/usr/bin/env bash
# Diagnose WebShare proxy auth. The $2.99/mo residential sub unlocks LinkedIn/Indeed.
# Credentials come from /root/agency/.webshare_proxies (gitignored) — never inline.
PX=$(cat /root/agency/.webshare_proxies | tr -d '\r\n')

echo "=== 1. try URL as-is ==="
out=$(timeout 15 curl -s -x "$PX" http://ifconfig.me 2>&1 | head -c 60)
echo "  -> ${out:-empty}"

echo "=== 2. verify with webshare API (does this username exist?) ==="
# WebShare API with creds from env/file only.
code=$(timeout 15 curl -s -o /dev/null -w "%{http_code}" -x "$PX" "https://proxy.webshare.io/api/v2/proxy/list/" 2>&1)
echo "  webshare API via proxy -> HTTP ${code:-timeout}"

echo "=== 3. proxycheck through host:port (no creds) ==="
HOSTPORT=$(echo "$PX" | sed -E 's#.*@##; s#^http://##')
code=$(timeout 10 curl -s -o /dev/null -w "%{http_code}" -x "http://$HOSTPORT" https://example.com 2>&1)
echo "  host:port no-auth -> HTTP ${code:-timeout}"
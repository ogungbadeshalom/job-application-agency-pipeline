#!/usr/bin/env bash
# Test the WebShare proxy. Credentials come from the gitignored file — never inline.
WEBSHARE=$(cat /root/agency/.webshare_proxies | tr -d '\r\n')
echo "=== test webshare proxy: what IP does it present? ==="
for i in 1 2 3; do
  out=$(timeout 20 curl -s -x "$WEBSHARE" http://ifconfig.me 2>/dev/null | head -c 40)
  code=$(timeout 20 curl -s -o /dev/null -w "%{http_code}" -x "$WEBSHARE" https://example.com 2>/dev/null)
  echo "  attempt $i -> via ${out:-'-'} | https=${code:-timeout}"
done
echo "=== current real egress (direct) ==="
timeout 10 curl -s http://ifconfig.me 2>/dev/null | head -c 40; echo ""
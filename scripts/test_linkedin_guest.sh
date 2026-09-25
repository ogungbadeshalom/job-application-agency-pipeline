#!/usr/bin/env bash
# Verify the LinkedIn guest jobs API (free, DC-safe) still works from this IP.
echo "=== LinkedIn guest API: US-remote data-engineer, last 7d, page 0 ==="
code=$(timeout 25 curl -s -o /tmp/li_guest.out -w "%{http_code}" \
  -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" \
  "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=data+engineer&location=United+States&geoId=103644278&f_WT=2&f_TPR=r604800&start=0" 2>&1)
echo "HTTP ${code:-timeout}"
echo "card count: $(grep -c 'base-card' /tmp/li_guest.out 2>/dev/null || echo 0)"
echo "jobIds found: $(grep -oE '/jobs/view/[^?]+' /tmp/li_guest.out 2>/dev/null | head -3 | tr '\n' ' ')"
echo "sample titles:"; grep -oE 'base-search-card__title">[^<]+' /tmp/li_guest.out 2>/dev/null | sed 's/.*>//' | head -3
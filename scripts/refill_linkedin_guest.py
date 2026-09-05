#!/usr/bin/env python3
"""
Andrew LinkedIn Guest-API refill — FREE, DC-IP-safe volume source.

The LinkedIn guest jobs API (jobs-guest/jobs/api/seeMoreJobPostings/search) is
confirmed to return HTTP 200 with real US-remote data-engineer jobs from a
Hetzner datacenter IP — it bypasses the HTML 999 bot block WITHOUT any proxy.
This is the "~10x volume" source identified in /root/REPORT_DATACENTER_JOBSCRAPE.md.

Page through all results for each of Andrew's data-engineer terms, parse the
base-card markup, and write dedup-ready JobSpy-style JSON for the app.

Usage:
  python3 scripts/refill_linkedin_guest.py <profile_id> \
      [--terms 'data engineer,senior data engineer,data pipeline engineer']
      [--geoId 103644278] [--remote-only] [--max-pages 6] [--sleep 6]
Output: JSON array of {title, company, url, location, board:'linkedin'} to
  <script_dir>/../tmp/linkedin_guest_out.json
"""
import json, re, html, sys, time, subprocess, argparse, os, urllib.request

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"

def fetch_page(term, geo_id, start, remote_only):
    url = ("https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search"
           f"?keywords={urllib.parse.quote(term)}&location=United+States"
           f"&geoId={geo_id}&f_TPR=r604800&start={start}")
    # f_WT=2 = remote only (not mutually exclusive with location)
    if remote_only:
        url += "&f_WT=2"
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
    })
    with urllib.request.urlopen(req, timeout=25) as r:
        return r.read().decode("utf-8", "ignore"), r.status

def parse_cards(raw):
    cards = re.split(r'(?=<a[^>]+class="base-card__full-link)', raw)[1:]
    out = []
    for c in cards:
        href = re.search(r'href="([^"]*/jobs/view/[^"?]+)', c)
        title = re.search(r'base-search-card__title[^>]*>\s*([^<]+)', c)
        company = re.search(r'base-search-card__subtitle[^>]*>\s*<a[^>]*>\s*([^<]+)', c, re.S)
        if not (href and title and company):
            continue
        out.append({
            "title": html.unescape(re.sub(r'\s+', ' ', title.group(1)).strip()),
            "company": html.unescape(re.sub(r'\s+', ' ', company.group(1)).strip()),
            "url": html.unescape(href.group(1)),
            "location": "United States (Remote)",
            "board": "linkedin",
        })
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("profile_id", help="Andrew's profile uuid")
    ap.add_argument("--terms", default="data engineer,senior data engineer,data pipeline engineer,data warehouse engineer,data platform engineer,analytics engineer,ETL developer,big data engineer")
    ap.add_argument("--geoId", default="103644278")
    ap.add_argument("--remote-only", action="store_true", default=True)
    ap.add_argument("--max-pages", type=int, default=6, help="pages (25-ish cards) per term")
    ap.add_argument("--sleep", type=float, default=6.0, help="seconds between requests (DC-safe pacing)")
    args = ap.parse_args()

    terms = [t.strip() for t in args.terms.split(",") if t.strip()]
    all_jobs = []
    seen = set()
    for term in terms:
        for page in range(args.max_pages):
            start = page * 25
            try:
                raw, status = fetch_page(term, args.geoId, start, args.remote_only)
                if status != 200:
                    print(f"[warn] {term} p{page}: HTTP {status}", file=sys.stderr)
                    break
                cards = parse_cards(raw)
                if not cards:
                    break  # no more results
                for c in cards:
                    if c["url"] not in seen:
                        seen.add(c["url"])
                        all_jobs.append(c)
                print(f"[ok] {term} p{page}: +{len(cards)} cards (cum {len(all_jobs)})", file=sys.stderr)
                if len(cards) < 10:
                    break  # near end
            except Exception as e:
                print(f"[err] {term} p{page}: {e}", file=sys.stderr)
                break
            time.sleep(args.sleep)
        time.sleep(args.sleep)

    outdir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tmp")
    os.makedirs(outdir, exist_ok=True)
    outfile = os.path.join(outdir, "linkedin_guest_out.json")
    json.dump(all_jobs, open(outfile, "w"))
    print(f"DONE: {len(all_jobs)} unique linkedin-guest jobs -> {outfile}", file=sys.stderr)

if __name__ == "__main__":
    import urllib.parse  # noqa
    main()
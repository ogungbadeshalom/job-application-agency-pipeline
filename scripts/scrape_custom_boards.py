#!/usr/bin/env python3
"""Custom job-board scrapers (Jobicy + HiringCafe) that feed the run_jobspy.py
loop. These are NOT in JobSpy's supported Site enum, so we fetch them directly
and return records shaped like JobSpy's (title, company, site, job_url,
location, description, date_posted, is_remote) so the rest of the pipeline
(filtering, dedup, insert) treats them the same.

Jobicy  : free JSON API, no key. Best-in-class fit (remote-only, direct links).
HiringCafe: Next.js client-side feed behind a protected API — needs a headless
           browser, which won't run on this box. Returns [] (explicit skip).
"""
import json
import sys
import datetime
import urllib.request

_TIMEOUT = 12
_UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36"}
_JOBICY = "https://jobicy.com/api/v2/remote-jobs?count=100"


def _fetch(url: str) -> str:
    req = urllib.request.Request(url, headers=_UA)
    with urllib.request.urlopen(req, timeout=_TIMEOUT) as r:
        return r.read().decode("utf-8", "replace")


def _parse_date(s):
    if not s:
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.datetime.strptime(str(s)[:19], fmt).isoformat()
        except ValueError:
            continue
    return None


def scrape_jobicy(term: str, old_days: int) -> list:
    """Fetch top Jobicy postings and keep those related to the search term.
    Jobicy is remote-only by nature, so is_remote is always True."""
    try:
        payload = json.loads(_fetch(_JOBICY))
    except Exception as e:
        print(f"[warn] jobicy: {e}", file=sys.stderr)
        return []
    t = term.strip().lower()
    words = [w for w in t.split() if len(w) > 3] if t else []
    out = []
    for j in payload.get("jobs", []):
        title = (j.get("jobTitle") or "").lower()
        if words and not any(w in title for w in words):
            continue
        out.append({
            "title": j.get("jobTitle") or "",
            "company": j.get("companyName") or "",
            "site": "jobicy",
            "job_url": (j.get("url") or f"https://jobicy.com/jobs/{j.get('id')}"),
            "location": j.get("jobGeo") or "Remote",
            "description": (j.get("jobDescription") or j.get("jobExcerpt") or ""),
            "date_posted": _parse_date(j.get("pubDate")),
            "is_remote": True,
            "is_expired": False,
            "is_easy_apply": False,
        })
    return out


def scrape_hiringcafe(term: str, old_days: int) -> list:
    """HiringCafe stores its feed behind client-side JS / a protected API — no
    clean server-accessible JSON. Refuse politely so the caller treats it as 0
    jobs rather than a broken scrape."""
    print("[warn] hiringcafe: unsupported (Next.js client-side feed; needs headless browser)", file=sys.stderr)
    return []


BOARDS = {"jobicy": scrape_jobicy, "hiringcafe": scrape_hiringcafe}


def main():
    # CLI: query.py <term> <board>  -> prints JSON job list (for integration test)
    if len(sys.argv) < 3:
        print("Usage: scrape_custom_boards.py <term> <board>", file=sys.stderr)
        sys.exit(2)
    term, board = sys.argv[1], sys.argv[2]
    fn = BOARDS.get(board)
    if not fn:
        print(f"[]", file=sys.stderr)
        sys.exit(0)
    jobs = fn(term, 90)
    print(json.dumps(jobs, default=str))


if __name__ == "__main__":
    main()
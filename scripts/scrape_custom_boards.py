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
import os as _os

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
    """HiringCafe is a client-side Next.js feed with no public API — the only way
    to scrape it is a real (headless) browser. Drive the system Chromium via the
    dedicated Playwright scraper as an ISOLATED subprocess so the heavy ~400MB
    browser never blocks or OOMs the main HTTP pipeline. Runs only when the user
    explicitly selects 'hiringcafe' as a site (it's opt-in, not in defaults)."""
    import subprocess as _sp
    script = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)),
                           "scrape_hiringcafe_scraper.py")
    if not _os.path.exists(script):
        print("[warn] hiringcafe: scraper script missing", file=sys.stderr)
        return []
    try:
        r = _sp.run(
            ["python3", script, term, "--remote-only", "--max", "15"],
            capture_output=True, text=True, timeout=150,
            cwd=_os.path.dirname(_os.path.abspath(__file__)),
        )
    except Exception as e:
        print(f"[warn] hiringcafe: {e}", file=sys.stderr)
        return []
    # parse JSON array from the script's stdout (it prints a JSON array then a
    # [debug] line on stderr)
    import json as _json
    txt = r.stdout
    start = txt.find("[")
    end = txt.rfind("]")
    if start == -1 or end == -1 or end <= start:
        print(f"[warn] hiringcafe: no parseable output ({r.returncode})", file=sys.stderr)
        return []
    try:
        jobs = _json.loads(txt[start:end + 1])
    except Exception as e:
        print(f"[warn] hiringcafe: json err {e}", file=sys.stderr)
        return []
    # normalize + skip the stray header entry
    records = []
    for j in jobs:
        title = (j.get("title") or "").strip()
        if title.lower() in ("hiringcafe", "remote role", "full time") or not title:
            continue
        records.append({
            "title": title,
            "company": (j.get("company") or "").strip(),
            "site": "hiringcafe",
            "job_url": "",
            "location": (j.get("location") or "").strip() or "Remote",
            "description": (j.get("description") or "").strip()[:4000],
            "date_posted": None,
            "is_remote": bool(j.get("is_remote")),
            "is_expired": False,
            "is_easy_apply": False,
        })
    print(f"[ok] hiringcafe: {len(records)} remote jobs for '{term}'", file=sys.stderr)
    return records


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
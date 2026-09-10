#!/usr/bin/env python3
"""
JobBidder Laptop Refill Agent
=============================
Runs JobSpy on YOUR laptop (residential IP) for boards the data-center server
can't reach (Indeed, Glassdoor, ZipRecruiter, LinkedIn, RemoteOK), then posts
results back so jobs land in your clients' queues through the same pipeline.

Works while the laptop is ON. If it's off, queued tasks simply wait.

Setup (once):
    1. pip install jobspy pandas requests
       (Linux may need: sudo apt install -y chromium chromium-driver  -- or the equivalent for your distro; see https://github.com/zackify/jobspy)
    2. Edit the three CONFIG values below.

Run:
    python3 laptop_agent.py            # process tasks once, then exit
    python3 laptop_agent.py --watch    # keep polling every 60s (run in a terminal / tmux)
"""

import json
import os
import sys
import time
import urllib.request

# ---------------------------------------------------------------- CONFIG ----
SERVER = os.environ.get("JOBBIDDER_SERVER", "https://pitchr.com.ng")   # your Cloudflare tunnel / server
TOKEN = os.environ.get("JOBBIDDER_TOKEN", "REPLACE_WITH_YOUR_TOKEN")    # generated in Admin Settings -> Auto-refill
POLL_SECONDS = int(os.environ.get("JOBBIDDER_POLL", "60"))
# -----------------------------------------------------------------------------

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"


def api(path, payload=None, method=None):
    url = f"{SERVER}{path}"
    req = urllib.request.Request(url, method=method or ("POST" if payload is not None else "GET"))
    req.add_header("Authorization", f"Bearer {TOKEN}")
    req.add_header("User-Agent", UA)
    data = None
    if payload is not None:
        req.add_header("Content-Type", "application/json")
        data = json.dumps(payload).encode()
    try:
        with urllib.request.urlopen(req, data=data, timeout=90) as r:
            return {"ok": True, "status": r.status, "body": json.loads(r.read() or b"{}")}
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read() or b"{}")
        except Exception:
            body = {}
        return {"ok": False, "status": e.code, "body": body}
    except Exception as e:
        return {"ok": False, "status": 0, "body": {"error": str(e)}}


def run_jobspy(site, term, location, results_wanted, hours_old, is_remote):
    """Local JobSpy scrape. Returns the list of ScrapeResultJob-shaped dicts to
    POST back. Runs directly (no proxy) so it uses YOUR residential IP."""
    from jobspy import scrape_jobs

    df = scrape_jobs(
        site_name=[site],
        search_term=term,
        location=location,
        results_wanted=results_wanted,
        hours_old=hours_old,
        is_remote=is_remote,
        remove_duplicates=True,
        # Small runs fetch LinkedIn descriptions; large ones skip (same tradeoff
        # the server uses) to stay responsive.
        linkedin_fetch_description=results_wanted <= 40,
        # No proxy -> direct from residential IP.
        proxies=None,
    )
    if df is None or df.empty:
        return []

    cols = set(df.columns)
    jobs = []
    for _, r in df.iterrows():
        title = str(r.get("title") or "").strip()
        if not title:
            continue
        url = str(r.get("job_url") or r.get("job_url_direct") or "")
        comp = str(r.get("company") or "")
        if not url and not comp:
            continue
        jobs.append({
            "title": title,
            "company": comp,
            "site": str(r.get("site") or site),
            "job_url": url,
            "description": str(r.get("description") or "")[:4000],
            "interval_amount": None if pd_isna(r.get("interval_amount")) else float(r.get("interval_amount")),
            "currency": str(r.get("currency") or "USD"),
            "location": str(r.get("location") or "Remote"),
            "date_posted": str(r.get("date_posted") or "") if "date_posted" in cols else None,
        })
    return jobs


def pd_isna(v):
    try:
        import pandas as pd
        return pd.isna(v)
    except Exception:
        return v is None


def process_one(task):
    tid = task["id"]
    profile = task["profile_id"]
    sites = task.get("sites") or []
    terms = task.get("search_terms") or []
    location = task.get("location") or "Remote"
    wanted = task.get("results_wanted") or 80
    hours = task.get("hours_old") or 168
    remote = bool(task.get("is_remote", True))

    print(f"[{tid}] profile={profile[:8]} boards={','.join(sites)} terms={len(terms)}", flush=True)

    all_jobs = []
    for site in sites:
        for term in terms:
            print(f"  scraping {site} / {term} ...", flush=True)
            try:
                got = run_jobspy(site, term, location, wanted, hours, remote)
                print(f"    -> {len(got)} jobs", flush=True)
                all_jobs.extend(got)
            except Exception as e:
                print(f"    ! {site}/{term} failed: {e}", flush=True)

    if not all_jobs:
        # Still mark the task done (zero found is a valid, non-error outcome).
        complete(tid, all_jobs)
        return

    # POST results back; the server dedupes + role-fits + inserts.
    r = api(f"/api/scrape-tasks/complete?task={tid}", payload={"jobs": all_jobs})
    if r["ok"]:
        b = r["body"]
        print(f"[{tid}] submitted {len(all_jobs)} raw, added {b.get('jobs_added')}, msg: {b.get('message')}", flush=True)
    else:
        print(f"[{tid}] SUBMIT FAILED ({r['status']}): {r['body']}", flush=True)


def complete(tid, jobs):
    r = api(f"/api/scrape-tasks/complete?task={tid}", payload={"jobs": jobs})
    print(f"[{tid}] marked done (0 raw submitted) -> http {r['status']}", flush=True)


def main():
    if TOKEN.startswith("REPLACE_WITH"):
        print("ERROR: set JOBBIDDER_TOKEN (see Admin Settings -> Auto-refill).")
        sys.exit(1)
    watch = "--watch" in sys.argv

    print(f"JobBidder laptop agent -> {SERVER}")
    while True:
        r = api("/api/scrape-tasks/claim")
        if not r["ok"]:
            print(f"claim failed ({r['status']}): {r['body']} — retrying...", flush=True)
        else:
            task = r["body"].get("task")
            if task:
                process_one(task)
                print("  -> processed; continuing to next task.", flush=True)
                continue  # immediately grab next task
            else:
                print("[idle] no pending tasks.", flush=True)
        if not watch:
            return
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
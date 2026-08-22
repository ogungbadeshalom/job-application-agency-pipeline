#!/usr/bin/env python3
"""
Standalone upstream-JobSpy LinkedIn scraper.

The Job Bidder app's default `run_jobspy.py` imports the local fork at
/root/JobSpy-improved, whose LinkedIn path returns recruiter spam. The upstream
pip/system `jobspy` package returns real US-remote companies for LinkedIn, so
this script runs under a python that sees the UPSTREAM package (python3.14 ->
/usr/local/lib/python3.14/dist-packages) and emits clean JobSpy-style records.

Usage:
  python3.14 scripts/scrape_linkedin_upstream.py '<json_args>' '<outfile>'
  json_args: {"term": "...", "location": "...", "results_wanted": 30, "hours_old": 72, "is_remote": true}
"""
import sys, json

try:
    args = json.loads(sys.argv[1])
    outfile = sys.argv[2]
except Exception as e:
    print(f"bad args: {e}", file=sys.stderr); sys.exit(2)

try:
    import pandas as _pd  # noqa: F401  (ensure available; jobspy needs it too)
except Exception:
    pass
proxy = args.get("proxy", "") or ""
site = args.get("site", "linkedin").lower()
# Force the UPSTREAM package in, not the fork.
sys.path = [p for p in sys.path if "JobSpy-improved" not in p]

import warnings; warnings.filterwarnings("ignore")
from jobspy import scrape_jobs

kw = {}
if proxy:
    kw["proxies"] = {"http": proxy, "https": proxy}

try:
    df = scrape_jobs(
        site_name=[site],
        search_term=args.get("term", ""),
        location=args.get("location", "United States"),
        results_wanted=int(args.get("results_wanted", 30)),
        hours_old=int(args.get("hours_old", 72)),
        is_remote=bool(args.get("is_remote", True)),
        linkedin_fetch_description=False,
        **kw,
    )
    if df is None or df.empty:
        print("linkedin upstream: 0 rows", file=sys.stderr)
        json.dump([], open(outfile, "w")); sys.exit(0)
    recs = df.to_dict("records")
    json.dump(recs, open(outfile, "w"), default=str)
    print(f"linkedin upstream: {len(recs)} rows", file=sys.stderr)
except Exception as e:
    print(f"linkedin upstream FAILED: {e}", file=sys.stderr)
    json.dump([], open(outfile, "w"))
    sys.exit(1)
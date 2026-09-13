#!/usr/bin/env python3
"""
JobBidder Board Performance Probe (self-contained)
==================================================
Runs the SAME board matrix through the SAME scraper code the app uses, directly
in-process (no subprocess, no Linux-only orchestration), so it runs identically
on the VPS (data-center IP) and on a Windows PC (residential IP). Reports RAW
per-board yield + failure reason, no DB write, no dedup — the only honest way
to compare the two machines, because both scrape into the same queue (whoever
runs second would see the other's jobs as duplicates).

Boards map to their real production scraper:
  * custom ATS boards (greenhouse/lever/ashby/dice/jobicy/sprout) via
    scrape_custom_boards.py — the exact functions the app's run_jobspy.py calls.
  * JobSpy-native boards (indeed/linkedin/remoteok/builtin/workingnomads/
    weworkremotely/smart_recruiters/glassdoor/zip_recruiter) via jobspy.scrape_jobs.

Usage:
    pip install jobspy pandas requests        # once, on each machine
    python scripts/bench_boards.py            # VPS  (MUBENG_PROXY auto-used by JobSpy boards? no — see note)
    python scripts/bench_boards.py            # PC on Windows (same command)

Output writes bench_result.json (+ prints a table). Compare the two files.

PROXY NOTE: on the VPS the app routes fragile JobSpy boards through mubeng on
:8899. To match that, set MUBENG_PROXY=http://127.0.0.1:8899 on the VPS; leave it
unset on your PC (residential IP). Custom ATS boards never use a proxy.
"""

import json
import os
import platform
import sys
import time
import traceback

# ---- comparison matrix (keep IDENTICAL across both machines) ----------------
SITES = [
    "greenhouse", "builtin", "jobicy", "workingnomads", "ashby",
    "dice", "remoteok", "weworkremotely", "smart_recruiters", "sprout",
    "indeed", "glassdoor", "zip_recruiter", "linkedin", "lever",
]
TERMS = ["data engineer", "software engineer"]
LOCATION = os.environ.get("BENCH_LOCATION", "United States")
RESULTS_WANTED = int(os.environ.get("BENCH_WANTED", "40"))
HOURS_OLD = int(os.environ.get("BENCH_HOURS", "168"))
OUT = os.environ.get("BENCH_OUT", "bench_result.json")
PER_CALL_TIMEOUT_S = float(os.environ.get("BENCH_TIMEOUT_S", "45"))
# ------------------------------------------------------------------------------

SITE_LABELS = {
    "indeed": "Indeed", "linkedin": "LinkedIn", "remoteok": "RemoteOK",
    "builtin": "BuiltIn", "greenhouse": "Greenhouse", "lever": "Lever",
    "smart_recruiters": "SmartRecruiters", "workingnomads": "WorkingNomads",
    "jobicy": "Jobicy", "sprout": "Sprout Social", "glassdoor": "Glassdoor",
    "zip_recruiter": "ZipRecruiter", "ashby": "Ashby", "dice": "Dice",
    "weworkremotely": "WeWorkRemotely",
}

# Custom ATS boards — functions from scrape_custom_boards (urllib only, Windows-safe).
CUSTOM_BOARDS = {"greenhouse", "lever", "ashby", "dice", "jobicy", "sprout"}


def custom_board_yield(site, term, want, hours):
    """Call scrape_custom_boards.<site>(term, hours) and return (jobs_found, sample)."""
    import sys
    from scripts import scrape_custom_boards as scb  # repo root on path
    fn = getattr(scb, f"scrape_{site}", None)
    if fn is None:
        return None, "no-scraper"
    records = fn(term, hours)
    jobs = [r for r in records if r.get("title") or r.get("job_url")]
    return len(jobs), [str(r.get("title")) for r in jobs[:5]]


def jobspy_yield(site, term):
    """Call jobspy.scrape_jobs for a JobSpy-native board. Returns (jobs_found, sample) or raises."""
    from jobspy import scrape_jobs
    import pandas as pd

    proxy = os.environ.get("MUBENG_PROXY", "").strip() or None
    kw = dict(
        site_name=[site],
        search_term=term,
        location=LOCATION,
        results_wanted=RESULTS_WANTED,
        hours_old=HOURS_OLD,
        is_remote=True,
        remove_duplicates=True,
        proxies=proxy,
        ca_cert=False if proxy else None,
    )
    if site == "linkedin":
        kw["linkedin_fetch_description"] = RESULTS_WANTED <= 20
    df = scrape_jobs(**kw)
    if df is None or df.empty:
        return 0, []
    titles = [str(t) for t in df["title"].head(5).tolist() if not pd.isna(t)]
    return int(len(df)), titles


def timed_call(fn):
    """Run a scraper with a hard timeout (POSIX; Windows falls back to no timeout)."""
    import signal

    done = {}
    def _handler(sig, frame):
        raise TimeoutError(f"exceeded {PER_CALL_TIMEOUT_S}s")
    if hasattr(signal, "SIGALRM"):
        signal.signal(signal.SIGALRM, _handler)
        signal.alarm(int(PER_CALL_TIMEOUT_S))
    try:
        t0 = time.time()
        res = fn()
        done["n"] = res[0]
        done["sample"] = res[1]
        done["dt"] = time.time() - t0
    finally:
        if hasattr(signal, "SIGALRM"):
            signal.alarm(0)
    return done


def main():
    # ensure repo root is importable so `from scripts import scrape_custom_boards` works
    sys_path_root = os.path.dirname(os.path.abspath(__file__))
    sys_parent = os.path.dirname(sys_path_root)
    if sys_parent not in sys.path:
        sys.path.insert(0, sys_parent)
    if sys_path_root not in sys.path:
        sys.path.insert(0, sys_path_root)

    env = {
        "machine": platform.node() or "unknown",
        "os": f"{platform.system()} {platform.release()}",
        "location": LOCATION,
        "results_wanted": RESULTS_WANTED,
        "hours_old": HOURS_OLD,
        "python": platform.python_version(),
        "proxy": "mubeng :8899" if os.environ.get("MUBENG_PROXY") else "none",
        "method": "self-contained (custom_boards + jobspy)",
    }
    print(f"JobBidder bench — machine={env['machine']} os={env['os']} proxy={env['proxy']} loc={LOCATION}")
    print(f"sites={len(SITES)} terms={TERMS}\n")

    results = {"environment": env, "timestamp": time.time(), "boards": {}}

    for site in SITES:
        found = 0
        samples = []
        errors = []
        fast = RESULTS_WANTED if site in CUSTOM_BOARDS else RESULTS_WANTED
        for term in TERMS:
            try:
                if site in CUSTOM_BOARDS:
                    out = timed_call(lambda: custom_board_yield(site, term, fast, HOURS_OLD))
                else:
                    out = timed_call(lambda: jobspy_yield(site, term))
                n = out["n"]
                found += n
                samples.extend(t for t in out["sample"] if t not in samples)
                print(f"  {SITE_LABELS[site]} / {term}: {n} jobs in {out['dt']:.1f}s")
            except Exception as e:
                msg = (str(e) or type(e).__name__).strip()[:160]
                errors.append(f"{term}: {msg}")
                print(f"  {SITE_LABELS[site]} / {term}: FAILED — {msg}")
        results["boards"][site] = {
            "label": SITE_LABELS[site],
            "jobs_found": found,
            "attempts": len(TERMS),
            "successful_terms": len(TERMS) - len(errors),
            "errors": errors,
            "sample_titles": samples[:5],
        }

    with open(OUT, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\nWrote {OUT}")

    print(f"\n{'board':18} {'jobs':>6}  ok_terms  notes")
    for site, r in results["boards"].items():
        note = "; ".join(r["errors"]) if r["errors"] else ("0" if r["jobs_found"] == 0 else "")
        print(f"{r['label']:18} {r['jobs_found']:6}  {r['successful_terms']}/{r['attempts']}   {note}")
    print(f"\nTOTAL raw jobs: {sum(r['jobs_found'] for r in results['boards'].values())}")


if __name__ == "__main__":
    main()
#!/usr/bin/env python3
"""
JobBidder Board Performance Probe (production-faithful)
========================================================
Runs the SAME board matrix through the APP'S REAL scrape path and reports raw
per-board yield. On the VPS it invokes scripts/run_jobspy.py (the exact script
the admin /api/scrape + worker refill use, incl. the custom greenhouse/lever/
jobicy scrapers and the mubeng proxy) so the numbers match production. On your
PC it calls the same run_jobspy.py with no proxy, so you compare the two
machines on identical code.

Key point: it does NOT write to the DB and does NOT dedupe — raw "found per
board" is the only honest comparison, because both machines scrape into the
same queue (whichever runs second would see the other's jobs as duplicates).

Usage:
    pip install jobspy pandas requests    # once, on each machine
    # VPS:   python3 scripts/bench_boards.py
    # PC:    python scripts/bench_boards.py   (Windows: python, not python3)
    # On the VPS, MUBENG_PROXY defaults to the local :8899 mubeng instance.

Output writes bench_result.json (+ prints a table). Compare the two files.
"""

import json
import os
import platform
import subprocess
import sys
import time

# ---- comparison matrix (edit to run fewer/faster; keep IDENTICAL across both) ----
SITES = [
    "greenhouse", "builtin", "jobicy", "workingnomads", "ashby",
    "dice", "remoteok", "weworkremotely", "smart_recruiters", "sprout",
    "indeed", "glassdoor", "zip_recruiter", "linkedin", "lever",
]
TERMS = ["data engineer", "software engineer"]
LOCATION = os.environ.get("BENCH_LOCATION", "United States")
RESULTS_WANTED = int(os.environ.get("BENCH_WANTED", "40"))
HOURS_OLD = int(os.environ.get("BENCH_HOURS", "168"))
SCRIPT = os.environ.get("BENCH_SCRIPT", "scripts/run_jobspy.py")
OUT = os.environ.get("BENCH_OUT", "bench_result.json")
# ------------------------------------------------------------------------------

SITE_LABELS = {
    "indeed": "Indeed", "linkedin": "LinkedIn", "remoteok": "RemoteOK",
    "builtin": "BuiltIn", "greenhouse": "Greenhouse", "lever": "Lever",
    "smart_recruiters": "SmartRecruiters", "workingnomads": "WorkingNomads",
    "jobicy": "Jobicy", "hiringcafe": "HiringCafe", "sprout": "Sprout Social",
    "glassdoor": "Glassdoor", "zip_recruiter": "ZipRecruiter",
    "ashby": "Ashby", "dice": "Dice", "weworkremotely": "WeWorkRemotely",
}


def run_script_board(site, term, tmpfile):
    """Call the production run_jobspy.py for ONE board+term and return job dicts."""
    py = "python3" if os.name != "nt" else "python"
    config = {
        "sites": [site],
        "search_terms": [term],
        "location": LOCATION,
        "results_wanted": RESULTS_WANTED,
        "hours_old": HOURS_OLD,
        "is_remote": True,
        "remove_easy_apply": True,
    }
    # run_jobspy.py reads MUBENG_PROXY from env itself; nothing to pass here.
    cmd = [py, SCRIPT, json.dumps(config), tmpfile]
    try:
        subprocess.run(cmd, timeout=120, check=False,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except subprocess.TimeoutExpired:
        return None, "timeout"
    except FileNotFoundError:
        return None, "script-not-found"
    try:
        with open(tmpfile) as f:
            data = json.load(f)
        if isinstance(data, dict) and "error" in data:
            return None, str(data["error"])[:150]
        return data, None
    except Exception as e:
        return None, str(e)[:150]


def main():
    env = {
        "machine": platform.node() or "unknown",
        "os": f"{platform.system()} {platform.release()}",
        "location": LOCATION,
        "results_wanted": RESULTS_WANTED,
        "hours_old": HOURS_OLD,
        "python": platform.python_version(),
        "raw_scrape_path": "run_jobspy.py (production)",
    }
    print(f"JobBidder bench (production path) — machine={env['machine']} os={env['os']} loc={LOCATION}")
    print(f"sites={len(SITES)} terms={TERMS}\n")

    results = {"environment": env, "timestamp": time.time(), "boards": {}}

    for site in SITES:
        found = 0
        errors = []
        for term in TERMS:
            tmp = f"./tmp_bench_{site.replace('_','')}_{int(time.time())}.json"
            jobs, err = run_script_board(site, term, tmp)
            try:
                if os.path.exists(tmp):
                    os.remove(tmp)
            except Exception:
                pass
            if err:
                errors.append(f"{term}: {err}")
                print(f"  {SITE_LABELS[site]} / {term}: FAILED — {err}")
            else:
                n = len(jobs) if jobs else 0
                found += n
                print(f"  {SITE_LABELS[site]} / {term}: {n} jobs")
        results["boards"][site] = {
            "label": SITE_LABELS[site],
            "jobs_found": found,
            "attempts": len(TERMS),
            "successful_terms": len(TERMS) - len(errors),
            "errors": errors,
            "sample_titles": [],
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
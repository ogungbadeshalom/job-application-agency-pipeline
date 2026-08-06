#!/usr/bin/env python3
"""JobBidder JobSpy runner.

Usage:
    python scripts/run_jobspy.py <config_json> <output_file>

config_json keys:
    sites          list[str]   e.g. ["indeed", "linkedin", "glassdoor"]
    search_terms   list[str]   e.g. ["backend engineer"]
    location       str         e.g. "United States"
    results_wanted int         per term (default 100)
    hours_old      int         default 72

Writes a JSON array of job dicts to <output_file>. Errors print to stderr and
exit non-zero so the Node caller can surface them to the UI.

Install: pip install jobspy pandas
"""
import sys
import json
import traceback

# --- arg parsing ------------------------------------------------------------
if len(sys.argv) < 3:
    print("Usage: run_jobspy.py <config_json> <output_file>", file=sys.stderr)
    sys.exit(2)

try:
    config = json.loads(sys.argv[1])
except Exception as exc:
    print(f"Invalid config JSON: {exc}", file=sys.stderr)
    sys.exit(2)

output_file = sys.argv[2]

# --- imports (deferred so arg errors fail fast) -----------------------------
try:
    from jobspy import scrape_jobs
except Exception as exc:
    print(
        "Could not import jobspy. Run: pip install jobspy pandas\n"
        f"Details: {exc}",
        file=sys.stderr,
    )
    sys.exit(3)

sites = config.get("sites", ["indeed"])
search_terms = config.get("search_terms", [])
location = config.get("location", "United States")
results_wanted = int(config.get("results_wanted", 100))
hours_old = int(config.get("hours_old", 72))
is_remote = bool(config.get("is_remote", False))

if not search_terms:
    print("No search_terms provided in config.", file=sys.stderr)
    sys.exit(2)

# --- scrape -----------------------------------------------------------------
all_jobs = []
errors = []

for term in search_terms:
    term = (term or "").strip()
    if not term:
        continue
    try:
        df = scrape_jobs(
            site_name=sites,
            search_term=term,
            location=location,
            results_wanted=results_wanted,
            hours_old=hours_old,
            is_remote=is_remote,
            linkedin_fetch_description=True,
        )
        if df is not None and not df.empty:
            all_jobs.extend(df.to_dict("records"))
    except Exception as exc:
        # Record per-term failures but keep going; surface at the end.
        msg = "".join(traceback.format_exception_only(type(exc), exc)).strip()
        errors.append(f"{term}: {msg}")
        print(f"[warn] term '{term}' failed: {msg}", file=sys.stderr)

# --- JSON-safe sanitizer -----------------------------------------------------
# JobSpy rows contain numpy scalars, pandas.Timestamp, and NaN/Infinity.
# Python's json.dump writes NaN/Infinity as bare literals (invalid JSON) and
# can't serialize numpy/pandas scalars, so we normalize everything recursively
# into plain JSON-safe values before writing.

import math
from datetime import date, datetime

def _sanitize(value):
    if value is None:
        return None
    # Return scalars that are already JSON-safe.
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, str)):
        return value
    # datetime/date/timestamp -> ISO string (also handles pandas.Timestamp
    # because it is a subclass of datetime).
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    # numpy / pandas scalar floats and ints.
    if hasattr(value, "item") and callable(value.item) and type(value).__module__.startswith(("numpy", "pandas")):
        item = value.item()
        return _sanitize(item)
    # Plain float.
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None          # NaN/Inf -> null (not valid JSON)
        return value
    # dict / list / tuple -> recurse.
    if isinstance(value, dict):
        return {str(k): _sanitize(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_sanitize(v) for v in value]
    # Fallback: stringify anything else (numpy arrays, Series, etc.).
    return str(value)

# --- write output -----------------------------------------------------------
# Normalize keys: jobspy columns -> our ScrapeResultJob shape.
records = []
for r in all_jobs:
    # When a remote-only scrape was requested, hard-filter here so no on-site
    # posting leaks through — JobSpy's per-site is_remote flag is a soft signal
    # and some scrapers (LinkedIn) still return geo jobs despite it. A job is
    # kept only if its row-level is_remote flag is true OR its location text
    # clearly says remote.
    # When a remote-only scrape was requested, hard-filter here so no on-site
    # posting leaks through. JobSpy's per-site is_remote flag is unreliable —
    # Indeed marks some office jobs as remote and truncates others to bare
    # state codes. Heuristic: a job is remote if its location text explicitly
    # says remote, OR the row flag is true AND the location names no specific
    # city (vague state-only like "MO, US" / "US" => remote-capable).
    if is_remote:
        loc_txt = (r.get("location") or "").lower()
        row_remote = bool(r.get("is_remote"))
        loc_remote = any(
            marker in loc_txt
            for marker in ("remote", "anywhere", "work from home", "wfh")
        )
        if loc_remote:
            keep = True
        elif loc_txt.strip() in {"", "us", "usa", "united states", "anywhere"}:
            keep = True  # bare country/empty => treat as remote-capable
        elif loc_txt.count(",") >= 2:
            keep = False  # "City, State, Country" => on-site office posting
        else:
            # One comma = "MO, US" state-only, or a single name => no city, so
            # trust the remote flag (remote jobs show as state/country only).
            keep = row_remote
        if not keep:
            continue
    rec = {
        "title": _sanitize(r.get("title")),
        "company": _sanitize(r.get("company")),
        "site": str(r.get("site", "")).lower() if r.get("site") else None,
        "job_url": _sanitize(r.get("job_url")),
        "description": _sanitize(r.get("description")),
        "location": _sanitize(r.get("location")),
        "interval_amount": _sanitize(r.get("interval_amount") or r.get("min_amount")),
        "currency": _sanitize(r.get("currency")),
        "date_posted": _sanitize(r.get("date_posted")),
    }
    records.append(rec)

with open(output_file, "w", encoding="utf-8") as f:
    json.dump(records, f, ensure_ascii=False)

# If every term failed, exit non-zero so the caller treats it as a failure.
if not records and errors:
    print("All search terms failed:\n" + "\n".join(errors), file=sys.stderr)
    sys.exit(1)

print(f"[ok] {len(records)} jobs written to {output_file}", file=sys.stderr)

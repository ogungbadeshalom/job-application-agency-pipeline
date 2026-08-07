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
job_type = (config.get("job_type") or "").strip()
include_kw = [k.strip().lower() for k in (config.get("include_kw") or []) if k and k.strip()]
exclude_kw = [k.strip().lower() for k in (config.get("exclude_kw") or []) if k and k.strip()]
remove_easy_apply = bool(config.get("remove_easy_apply", True))  # default on

# Map friendly labels -> JobSpy JobType VALUES (get_enum_from_value matches
# against JobType.value, e.g. "fulltime", "parttime", "contract", "perdiem").
_JOBTYPE_MAP = {
    "": None,
    "any": None,
    "full time": "fulltime",
    "fulltime": "fulltime",
    "part time": "parttime",
    "parttime": "parttime",
    "contract": "contract",
    "temporary": "temporary",
    "internship": "internship",
    "per diem": "perdiem",
    "volunteer": "volunteer",
}
job_type_value = _JOBTYPE_MAP.get(job_type.lower(), job_type or None)

if not search_terms:
    print("No search_terms provided in config.", file=sys.stderr)
    sys.exit(2)

# --- scrape -----------------------------------------------------------------
all_jobs = []
errors = []

# Optional rotating proxy (mubeng) for IP-blocked boards (Glassdoor, ZipRecruiter,
# LinkedIn). Enabled by setting MUBENG_PROXY (default off unless the env var is set
# AND localhost is listening). We route ONLY the fragile boards through it so the
# fast/reliable boards stay on the direct IP.
import os
PROXY = os.environ.get("MUBENG_PROXY", "").strip() or "http://127.0.0.1:8899"
FRAGILE = {"glassdoor", "zip_recruiter", "linkedin"}

def _use_proxy(site_names):
    """Return the proxy for the fragile boards if mubeng is actually up."""
    if not any(s in site_names for s in FRAGILE):
        return None  # reliable boards stay on direct IP
    if not _proxy_alive():
        return None  # mubeng down -> go direct (may 403, but no worse)
    return PROXY

def _proxy_alive():
    try:
        import socket
        h, _, p = PROXY.replace("http://", "").rpartition(":")
        with socket.create_connection((h.strip(), int(p or 8899)), timeout=1):
            return True
    except Exception:
        return False

# Scrape each (term, site) independently so one board failing (e.g. Indeed's
# anti-bot KeyError) doesn't discard the other boards for a term. A per-site
# hard cap keeps a slow/hung board (LinkedIn over proxies) from stalling the run.
import signal as _signal
SITE_TIMEOUT_S = 45

for term in search_terms:
    term = (term or "").strip()
    if not term:
        continue
    term_ok = 0
    for site in sites:
        def _deadline(_signum, _frame):
            raise TimeoutError(f"site '{site}' exceeded {SITE_TIMEOUT_S}s")
        _has_alarm = hasattr(_signal, "SIGALRM") and hasattr(_signal, "setitimer")
        try:
            if _has_alarm:
                _signal.signal(_signal.SIGALRM, _deadline)
                _signal.setitimer(_signal.ITIMER_REAL, SITE_TIMEOUT_S)
            df = scrape_jobs(
                site_name=[site],
                search_term=term,
                location=location,
                results_wanted=results_wanted,
                hours_old=hours_old,
                is_remote=is_remote,
                job_type=job_type_value,
                linkedin_fetch_description=True,
                proxies=_use_proxy([site]),
                ca_cert=False if _use_proxy([site]) else None,
            )
            if df is not None and not df.empty:
                rec = df.to_dict("records")
                all_jobs.extend(rec)
                term_ok += len(rec)
        except Exception as exc:
            # Record per-site failures but keep going with the other boards.
            msg = "".join(traceback.format_exception_only(type(exc), exc)).strip()
            errors.append(f"{term} / {site}: {msg}")
            print(f"[warn] {term} / {site}: {msg}", file=sys.stderr)
        finally:
            # Cancel the deadline timer so it can't stray into the next site.
            if _has_alarm:
                _signal.setitimer(_signal.ITIMER_REAL, 0)
    if term_ok == 0:
        print(f"[warn] term '{term}' returned no jobs", file=sys.stderr)

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
# Normalize keys: jobspy columns -> our ScrapeResultJob shape. Dedup across
# boards by URL so the same posting (e.g. LinkedIn + Greenhouse) counts once.
records = []
seen_urls = set()
for r in all_jobs:
    # When a remote-only scrape was requested, hard-filter here so no on-site
    # posting leaks through. JobSpy's per-site is_remote flag is unreliable —
    # Indeed marks some office jobs as remote and truncates others to bare
    # state codes. Heuristic: a job is remote if its location text explicitly
    # says remote, OR the row flag is true AND the location names no specific
    # city (vague state-only like "MO, US" / "US" => remote-capable).
    if is_remote:
        _loc = r.get("location")
        loc_txt = ("" if not isinstance(_loc, str) else _loc).lower()
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

    # Keyword include / exclude filters. Match ONLY the job description —
    # a generic title like "Software Engineer" shouldn't satisfy an include/be
    # vetoed by an exclude; the stack/tech signals live in the description.
    # Guard: some scrapers return description as a float/NaN (e.g. numpy) —
    # coerce to str so .lower() never raises.
    if include_kw or exclude_kw:
        _desc = r.get("description")
        hay = ("" if not isinstance(_desc, str) else _desc).lower()
        if include_kw and not any(k in hay for k in include_kw):
            continue  # description must contain at least one included keyword
        if exclude_kw and any(k in hay for k in exclude_kw):
            continue  # description must NOT contain any excluded keyword

    # Remove easy-apply listings (LinkedIn's one-click apply etc.) when enabled.
    if remove_easy_apply:
        _t = r.get("title")
        _d = r.get("description")
        _u = r.get("job_url")
        _all = f"{_t if isinstance(_t, str) else ''} {_d if isinstance(_d, str) else ''} {_u if isinstance(_u, str) else ''}".lower()
        if any(m in _all for m in ("easy apply", "easy-apply", "easyapply", "quick apply", "quick-apply")):
            continue

    # Cross-board dedup by job URL.
    jurl = (r.get("job_url") or "").strip()
    if jurl:
        if jurl in seen_urls:
            continue
        seen_urls.add(jurl)

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

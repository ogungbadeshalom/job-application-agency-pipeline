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

# Custom board scrapers (Jobicy, HiringCafe) that aren't in JobSpy's Site enum.
# Import at module level but guard so run_jobspy.py still works even if this
# file has an issue. Scripts live in the same scripts/ dir — add it to path so
# the bare import resolves regardless of the caller's cwd.
import os as _os
try:
    _sys_dir = _os.path.dirname(_os.path.abspath(__file__))
    if _sys_dir not in sys.path:
        sys.path.insert(0, _sys_dir)
    from scrape_custom_boards import BOARDS as _CUSTOM_BOARDS
except Exception:
    _CUSTOM_BOARDS = {}


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
        # Hard-skip boards that are unusable from this server at the transport
        # level. zip_recruiter's TLS cert is invalid here (x509 unknown
        # authority) which, even inside the per-site try/except, can surface as
        # a fatal "JobSpy exited 1 ... jobs_found=0" and abort the whole batch.
        if site in ("zip_recruiter",):
            print(f"[warn] {term} / {site}: board blacklisted (TLS unusable)", file=sys.stderr)
            continue
        # Custom non-JobSpy boards (jobicy, hiringcafe) — fetch via their own
        # module and merge into the same record stream. Not subject to the
        # JobSpy signal-alarm path; they self-timeout.
        if site in _CUSTOM_BOARDS:
            try:
                recs = _CUSTOM_BOARDS[site](term, hours_old)
                if recs:
                    all_jobs.extend(recs)
                    term_ok += len(recs)
                    print(f"[ok] {site}: {len(recs)} jobs for '{term}'", file=sys.stderr)
            except Exception as exc:
                msg = "".join(traceback.format_exception_only(type(exc), exc)).strip()
                errors.append(f"{term} / {site}: {msg}")
                print(f"[warn] {term} / {site}: {msg}", file=sys.stderr)
            continue
        def _deadline(_signum, _frame):
            raise TimeoutError(f"site '{site}' exceeded {SITE_TIMEOUT_S}s")
        _has_alarm = hasattr(_signal, "SIGALRM") and hasattr(_signal, "setitimer")
        # Resolve the proxy once: _use_proxy does a 1s TCP liveness check, so
        # calling it twice per (term, site) doubled the wait on a down proxy.
        _proxy = _use_proxy([site])
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
                proxies=_proxy,
                ca_cert=False if _proxy else None,
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
        # Strip NUL (0x00) — Postgres rejects it in text columns (sqlstate
        # 22021). Scraped HTML→text can embed NULs; drop them before JSON so
        # they never reach the DB insert (which strips them too). NUL is the
        # only byte PG rejects, so don't strip anything else.
        if isinstance(value, str) and "\x00" in value:
            return value.replace("\x00", "")
        return value
    # datetime/date/timestamp -> ISO string (also handles pandas.Timestamp
    # because it is a subclass of datetime).
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    # numpy / pandas scalar floats and ints.
    if hasattr(value, "item") and callable(value.item) and type(value).__module__.startswith(("numpy", "pandas")):
        try:
            return _sanitize(value.item())
        except Exception:
            # Multi-element bytecodes arrays (e.g. a 2-element pay range) have no
            # scalar .item(); fall back to a JSON-safe list so the sanitize call
            # never crashes and aborts the whole refill.
            return [_sanitize(v) for v in value]
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

def _text(value):
    """Coerce a text column to a JSON-safe string, mapping None/NaN to ''.

    Some scrapers leak floats into text columns (description/location/title),
    e.g. a numpy value, which would otherwise be written as a bare number and
    then handed to the DB as a numeric in a text column. Normalize to a string.
    """
    if value is None:
        return ""
    try:
        cleaned = _sanitize(value)
    except Exception:
        return str(value)
    if cleaned is None:
        return ""
    return str(cleaned)

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
        elif isinstance(_loc, str) and _loc.strip():
            # A location that names a real city (2+ commas => "City, State,
            # Country") is on-site — drop it.
            if _loc.count(",") >= 2:
                keep = False
            elif _loc.strip().lower() in {"", "us", "usa", "united states", "anywhere"}:
                # Bare country/empty is ambiguous. ONLY treat as remote if the
                # row flag also says remote (BuiltIn reports many ON-SITE jobs
                # with just "US" + is_remote=False — those must NOT keep through).
                keep = row_remote
            else:
                # One comma = "MO, US" state-only, or a single name, or e.g.
                # "Remote" variants already handled above. Trust is_remote only
                # if the text doesn't name a concrete place (>=1 comma + not
                # remote-capable). Conservative: require the remote row flag.
                keep = row_remote and not _loc.count(",")  # no-city (single token) remote
        else:
            # empty/non-string location — keep only if the board flagged remote
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

    # Remove easy-apply + non-direct-apply listings when enabled.
    #
    # Two signals matter:
    #  - easy_apply (bool): JobSpy tags LinkedIn/GH one-click-apply jobs. 
    #    Falling back to string grep on title/description/url for boards that
    #    don't set the flag (e.g. Indeed "Quick Apply").
    #  - job_url_direct: where JobSpy gives us a dedicated direct-apply URL, we
    #    keep the posting; where the ONLY url is a dead-end / lazy-redirect page
    #    (LinkedIn job/view, lnkd.in, a careers-search page, a JS apply wall),
    #    skip it because the worker can't get to an application form directly.
    if remove_easy_apply:
        _t = r.get("title")
        _d = r.get("description")
        _u = str(r.get("job_url") or "")
        _direct = str(r.get("job_url_direct") or "")
        _all = f"{_t if isinstance(_t, str) else ''} {_d if isinstance(_d, str) else ''} {_u}".lower()
        # 1) native easy-apply flag OR text match
        if r.get("easy_apply") is True:
            continue
        if any(m in _all for m in ("easy apply", "easy-apply", "easyapply", "quick apply", "quick-apply", "one click apply", "one-click apply", "one click to apply")):
            continue
        # 2) Non-direct-apply URLs. This must be CONSERVATIVE: LinkedIn posts a
        #    login-walled /jobs/view page with an in-app "Easy Apply" button that
        #    no worker can reach directly, so drop those. Board posting URLs like
        #    Stripe's stripe.com/jobs/search?gh_jid=… and careers.* career pages
        #    ARE direct apply pages with a form, so they are kept. Never block a
        #    posting that has a job_url_direct (that field is the real apply link).
        _ut = str(_direct or _u).strip()
        if _ut:
            _ul = _ut.lower()
            if (
                _ul.startswith("https://www.linkedin.com/jobs/view")
                or _ul.startswith("http://www.linkedin.com/jobs/view")
                or "rin.linkedin.com/jobs/view" in _ul
                or "lnkd.in/" in _ul
            ) and not _direct:
                continue

    # Cross-board dedup by job URL.
    # job_url can be a numpy/float NaN (truthy) rather than a string; coerce so
    # .strip()/.lower() can never raise and abort the whole refill.
    jurl = str(r.get("job_url") or "").strip()
    if jurl:
        if jurl in seen_urls:
            continue
        seen_urls.add(jurl)

    rec = {
        "title": _text(r.get("title")),
        "company": _text(r.get("company")),
        "site": (str(r.get("site") or "").lower()) or None,
        "job_url": _text(r.get("job_url")),
        "description": _text(r.get("description")),
        "location": _text(r.get("location")),
        "interval_amount": _sanitize(r.get("interval_amount") or r.get("min_amount")),
        "currency": _text(r.get("currency")),
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

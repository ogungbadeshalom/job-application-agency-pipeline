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


def _is_direct_apply_url(url):
    """True if a job URL is a real, directly-applicable posting page the worker
    can reach an application form on — a company career/ATS page (Greenhouse
    gh_jid or boards.greenhouse.io / job-boards.greenhouse.io, Lever, Workday,
    iCIMS, careers.* / jobs.* subdomains, or a concrete /jobs/<id> path) or a
    LinkedIn /jobs/view page — as opposed to a dead-end / aggregator / login
    wall. The remove_easy_apply filter must KEEP these (they ARE the direct
    apply link) and only drop URLs that genuinely can't be applied to directly.
    """
    if not url:
        return False
    from urllib.parse import urlparse
    u = url.strip().lower()
    # LinkedIn job-view pages: worker applies via their own LinkedIn login.
    if "linkedin.com/jobs/view" in u or "lnkd.in/" in u:
        return True
    # Concrete job id in query string (Greenhouse gh_jid, Lever jid, Workday
    # jobRequisition, generic jid/jobId/job_id) -> a specific posting.
    if any(q in u for q in ("gh_jid=", "jobid=", "jid=", "job_id=",
                            "jobrid=", "requisitionid=")):
        return True
    # Known ATS / career-board hosts that host real postings.
    for host in ("boards.greenhouse.io", "job-boards.greenhouse.io",
                 "jobs.lever.co", "jobs.ashbyhq.com", "apply.workable.com",
                 "greenhouse.io", "lever.co", "workday", "icims",
                 "smartrecruiters", "recruiting.paylocity", "app.careerpuck.com"):
        if host in u:
            return True
    # careers.* / jobs.* subdomains can be either a dedicated posting host
    # (jobs.elastic.co/o/<role>) or a listing root (jobs.dou.ua/). Only count
    # them when the path names a concrete posting, not a bare root or listing.
    netloc = urlparse(url).netloc.lower()
    if netloc.startswith(("careers.", "jobs.")) or netloc.startswith("job-"):
        path = urlparse(url).path.rstrip("/")
        last = path.rsplit("/", 1)[-1] if path else ""
        if last and last.lower() not in ("jobs", "careers", "search", "index",
                                         "all", "list", "listing", "browse"):
            return True
        return False
    # A concrete posting path on a company domain: a non-empty last path
    # segment under a /careers/ /jobs/ /job/ prefix (e.g. /careers/12345,
    # /jobs/apply/xyz). A bare listing page ends in /jobs or /careers with no
    # id and is NOT a single posting — that stays droppable.
    path = urlparse(url).path.rstrip("/")
    last = path.rsplit("/", 1)[-1] if path else ""
    if ("/jobs/" in u or "/job/" in u or "/careers/" in u) and last and \
            not last.lower() in ("jobs", "careers", "search", "index", "all"):
        return True
    return False


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
FRAGILE = {"glassdoor", "zip_recruiter", "linkedin", "indeed", "remoteok"}

def _use_proxy(site_names):
    """Return the proxy (dict, as JobSpy expects) for fragile boards if mubeng is up."""
    if not any(s in site_names for s in FRAGILE):
        return None  # reliable boards stay on direct IP
    if not _proxy_alive():
        return None  # mubeng down -> go direct (may 403, but no worse)
    return PROXY  # JobSpy accepts a proxy URL string (rotating session)

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
# GLOBAL budget: Node's caller (app/api/scrape route's runJobSpy) SIGKILLs this
# whole subprocess after 300s — at which point EVERYTHING is lost, even the
# boards that finished. We stay safely under that by tracking an overall
# deadline and STOPPING once we hit it, so a slow/multi-term batch (e.g. 10
# terms x LinkedIn + HiringCafe browsers) returns the partial results it got
# instead of aborting empty on the outer kill.
import time as _time
TOTAL_BUDGET_S = 225   # comfortably under Node's 300s kill
_dead_total = _time.monotonic() + TOTAL_BUDGET_S

def _over_budget() -> bool:
    """True once the total wall-clock budget is spent (stops the term/site loop)."""
    return _time.monotonic() > _dead_total

# HiringCafe is a headless-Chromium scrape: heavy (~500MB) and slow (~15-30s
# per launch). Running it once PER TERM is what blows the total budget on
# multi-term refills. De-dupe: launch the browser at most ONCE for the whole
# batch; later terms reuse the same fetch results. (Jobicy is cheap/fast and is
# still called per term.)
_hiringcafe_done = False

# LinkedIn via the UPSTREAM jobspy package (real companies, not the fork's
# recruiter spam). Fronted by a bounded subprocess so a hung scrape can't stall
# the batch; returns the record list, or None on any failure so the caller can
# fall back to the in-process fork scrape.
def _scrape_linkedin_upstream(site, term, location, results_wanted, hours_old, is_remote, proxy=None):
    import subprocess as _subprocess
    import tempfile as _tempfile
    script = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "scrape_linkedin_upstream.py")
    # Upstream JobSpy's LinkedIn scraper requires a valid COUNTRY name (e.g.
    # "usa", "united states", "worldwide"); a bare "Remote" (our Remote-only
    # toggle value) makes it throw 'Invalid country string' and return 0 jobs.
    # Detect non-country pseudo-locations and coerce them to a real country for
    # the upstream call. This is what makes LinkedIn actually yield volume.
    _lc = (location or "").strip().lower()
    _COUNTRY_LOCS = {
        "remote": "usa",
        "worldwide": "worldwide",
        "usa": "usa",
        "us": "usa",
        "united states": "usa",
        "united states of america": "usa",
        "us/canada": "usa",
        "usa/ca": "usa",
    }
    if _lc in _COUNTRY_LOCS:
        _up_loc = _COUNTRY_LOCS[_lc]
    elif _lc and _lc not in ("", "any"):
        # Pass through named countries unchanged (e.g. "canada", "germany").
        _up_loc = location
    else:
        _up_loc = "usa"
    args = {
        "site": site,
        "term": term,
        "location": _up_loc,
        "results_wanted": min(int(results_wanted or 0), 40),
        "hours_old": int(hours_old or 72),
        "is_remote": bool(is_remote),
        "proxy": proxy or "",
    }
    with _tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        out = f.name
    py = "python3.14"
    try:
        _res = _subprocess.run([py, script, json.dumps(args), out], timeout=45, check=False,
                        capture_output=True)
        # Surface the subprocess stderr so failures are diagnosable.
        if _res.returncode != 0:
            print(f"[warn] linkedin upstream rc={_res.returncode}: {_res.stderr.decode()[-200:]}", file=sys.stderr)
        with open(out, "r") as fh:
            recs = json.load(fh)
        _os.unlink(out)
    except Exception as _e:
        print(f"[warn] linkedin upstream exception: {_e}", file=sys.stderr)
        _os.unlink(out)
        return None
    if not recs or not isinstance(recs, list) or len(recs) == 0:
        return None
    # Return a pandas DataFrame so the existing downstream (`df.empty`,
    # `df.to_dict('records')`) path works unchanged, matching scrape_jobs.
    try:
        import pandas as _pd
        return _pd.DataFrame(recs)
    except Exception:
        return None

for term in search_terms:
    if _over_budget():
        print("[warn] total time budget exceeded — returning partial results", file=sys.stderr)
        break
    term = (term or "").strip()
    if not term:
        continue
    term_ok = 0
    for site in sites:
        if _over_budget():
            print("[warn] total time budget exceeded — stopping", file=sys.stderr)
            break
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
                if site == "hiringcafe":
                    # Run the heavy headless browser at most ONCE for the whole
                    # batch; reuse its results for every later term.
                    if _hiringcafe_done:
                        print(f"[warn] {site}: skipped (already scraped this batch)", file=sys.stderr)
                        continue
                    _hiringcafe_done = True
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
        # Retry fragile boards (LinkedIn is the main one — its guest API throws
        # transient 502/429 storms under anti-bot) once with a short backoff.
        # A 2nd attempt after a brief pause often clears the burst; if it still
        # fails we record it and move on rather than aborting the whole batch.
        _attempts = 2 if site in FRAGILE else 1
        df = None
        for _attempt in range(1, _attempts + 1):
            if _over_budget():
                break
            try:
                if site in ("linkedin", "indeed", "remoteok") and _attempt == 1:
                    # Fragile boards route through the UPSTREAM jobspy package
                    # (real companies, no recruiter spam) + the rotating proxy,
                    # which beats the fork/IP-blocked path on these boards.
                    _up = _scrape_linkedin_upstream(
                        site, term, location, results_wanted, hours_old, is_remote, proxy=_proxy
                    )
                    if _up is not None:
                        df = _up
                        break
                    _time.sleep(2)
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
                    # LinkedIn is the biggest budget-burner: with
                    # linkedin_fetch_description=True it makes a SEPARATE
                    # jobs/view/<id> request for EVERY job card. On a large
                    # (or multi-term) refill that's 100+ sequential flaky
                    # LinkedIn requests -> easily blows past the 300s outer cap
                    # and SIGKILLs the whole subprocess. Only request full
                    # descriptions on SMALL LinkedIn runs; large refills skip
                    # them so the listing itself (fast) is what gets scraped
                    # and the run completes. (Matches upstream default: False.)
                    linkedin_fetch_description=results_wanted <= 40,
                    proxies=_proxy,
                    ca_cert=False if _proxy else None,
                )
                break  # success on first try
            except Exception as exc:
                msg = "".join(traceback.format_exception_only(type(exc), exc)).strip()
                # Re-arm hazard: the signal alarm is disarmed in finally after the
                # WHOLE block, so on a retry we must re-setitimer — done above.
                if _attempt < _attempts:
                    print(f"[warn] {term} / {site} attempt {_attempt}/{_attempts} failed ({msg[:120]}) — retrying…", file=sys.stderr)
                    if _has_alarm:
                        _signal.setitimer(_signal.ITIMER_REAL, 0)
                    _time.sleep(3)  # backoff before retry
                else:
                    errors.append(f"{term} / {site}: {msg}")
                    print(f"[warn] {term} / {site}: {msg}", file=sys.stderr)
            finally:
                if _has_alarm:
                    _signal.setitimer(_signal.ITIMER_REAL, 0)
        if df is not None and not df.empty:
            rec = df.to_dict("records")
            all_jobs.extend(rec)
            term_ok += len(rec)
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
        _title = r.get("title")
        _desc = r.get("description")
        def _s(v):
            return "" if not isinstance(v, str) else v.lower()
        loc_txt = _s(_loc)
        title_txt = _s(_title)
        desc_txt = _s(_desc)
        row_remote = bool(r.get("is_remote"))
        region = _s(r.get("work_from_home_type"))

        # STRICT remote classifier. A job must be verifiably remote and NOT
        # contradict itself. Signal sources: location, is_remote flag, title and
        # description wording (hybrid/on-site/remote-friendly ever present => drop).
        def _has_any(text, words):
            return any(w in text for w in words)

        # Location names remote (excluding "remote-friendly", which is office-first).
        loc_remote = _has_any(loc_txt, ("remote", "anywhere", "work from home", "wfh", "fully remote", "100% remote")) and "remote-friendly" not in loc_txt
        # "Remote-Friendly" means office-first + optional remote -> NOT strictly remote.
        remote_friendly_only = "remote-friendly" in loc_txt and not _has_any(loc_txt, ("remote -", "fully remote", "100% remote", "remote,", "remote;", " or remote", "-remote"))
        # Description / title confirm remote only with strong phrasing. The bare
        # word "remote" appears in ~every JD ("remote team"), so only explicit
        # remote-work declarations count.
        desc_remote = _has_any(desc_txt, (
            "remote position", "remote role", "remote job", "work from home",
            "fully remote", "100% remote", "remote-first", "remote first",
            "remote only", "100% remotely", "fully work from home", "remote - us",
            "remote (us", "remote in us", "this role is remote", "open to remote",
        ))
        title_remote = _has_any(title_txt, ("remote", "wfh", "fully remote"))
        wfh_remote = _has_any(region, ("remote", "fully remote", "wfh"))

        # Hybrid / on-site / in-office anywhere => definitely not strictly remote.
        hybrid_signal = (
            _has_any(loc_txt, ("hybrid", "on-site", "onsite", "on site", "in-office", "office hub"))
            or _has_any(desc_txt, ("hybrid", "on-site", "onsite", "on site", "in-office", "office hub", "office location", "office hubs"))
            or _has_any(title_txt, ("hybrid", "on-site", "onsite"))
        )
        # A location naming a concrete city (City, ST) or a bare foreign region.
        is_city_loc = isinstance(_loc, str) and _loc.count(",") >= 1 and not loc_remote
        foreign_region = _has_any(loc_txt, ("poland", "spain", "canada", "germany", "france", "united kingdom", "europe", "emea", "latam", "india", "australia", "brazil", "costa rica", "mexico"))
        bare_country = isinstance(_loc, str) and _loc.strip().lower() in {"us", "usa", "united states", "uk", "remote"} and not loc_remote

        if hybrid_signal or remote_friendly_only:
            keep = False
        else:
            if loc_remote:
                # The LOCATION itself names remote — the strongest, most reliable signal.
                keep = True
            elif not _loc or not _loc.strip():
                # Empty location: only keep with remote proof.
                keep = (desc_remote or title_remote or wfh_remote or row_remote) and not foreign_region
            elif is_city_loc or foreign_region:
                # A concrete city or foreign region: only keep if the description
                # (or location) clearly declares remote work.
                keep = (desc_remote or wfh_remote or loc_remote) and not foreign_region
            elif bare_country:
                # Bare "US"/"USA"/"UK" with no remote wording -> not proof of remote.
                keep = (desc_remote or wfh_remote)
            else:
                keep = (desc_remote or title_remote or wfh_remote) and not foreign_region
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
        # 2) Non-direct-apply URLs. This must be CONSERVATIVE: only drop a job
        #    when its URL is a genuine dead-end the worker CANNOT reach an
        #    application form on. Real company career/ATS posting URLs
        #    (Greenhouse gh_jid / boards.greenhouse.io, Lever, Workday,
        #    careers.* / jobs.* subdomains, /jobs/<id> paths) ARE direct apply
        #    pages and MUST be kept — previously they were dropped because the
        #    existence check only exempted LinkedIn URLs, silently discarding
        #    essentially the whole Greenhouse board on every scrape. LinkedIn
        #    /jobs/view links are also kept (workers apply via their login;
        #    reach > a directly-embedded form).
        _ut = str(_direct or _u).strip()
        if _ut:
            if not (bool(_direct) or _is_direct_apply_url(_ut)):
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
# BUT: per-board failures (a board returned 0 / 502 / timeout, e.g. LinkedIn
# anti-bot) are NOT fatal — the refill should still complete (as "0 added"
# with the reason) rather than abort with a hard 500 that loses the run. Only
# a genuinely fatal script error (no search terms / nothing usable at all)
# keeps the non-zero exit. We distinguish by: no records AND no fatal flag.
if not records and errors:
    # Still emit the reasons so the caller shows them, but exit 0 so the run
    # is recorded as completed-with-0 (the caller surfaces errors). The empty
    # JSON (already written above) is a valid "no jobs" result.
    print("All boards failed for these terms (no jobs returned):\n"
          + "\n".join(errors), file=sys.stderr)
    # Keep exit 0 so the Node runner records a completed (0-job) run instead of
    # a hard failure — a lone LinkedIn 502 shouldn't nuke the whole refill.
    sys.exit(0)

print(f"[ok] {len(records)} jobs written to {output_file}", file=sys.stderr)

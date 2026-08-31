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
import re
import sys
import datetime
import urllib.request
import urllib.parse
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


# GregHouse + Lever are per-company ATS feeds (not a global search). Both have
# open, pragmatic JSON APIs reachable from this box. We curl a curated list of
# company slugs, pull their postings, and filter to those matching the search
# term (word-level on title) + remote (remote detection best-effort). Good
# companies respond even when a specific slug 404s -> we skip it silently.
GREENHOUSE_ORGS = [
    # Non-enterprise orgs that post US-remote software/AI/ML roles. Enterprise
    # giants (stripe/datadog/figma/twilio/dropbox/etc.) are deliberately NOT
    # listed here — they're filtered by the enterprise blocklist anyway, so
    # leaving them out saves 30+ no-op API calls per refill.
    "gusto", "monzo", "newrelic", "pagerduty", "planetscale", "wisetack",
    "hashicorp", "remitly", "dbtlabs", "contenda", "supabase", "render",
    "sentry", "deel", "box", "wise", "amplitude", "mercari", "discord",
    # v2.48 base: data/ML-heavy non-enterprise orgs (verified return jobs)
    "okta", "elastic", "mongodb", "zscaler", "fastly", "transloadit",
    # v2.71: expanded non-enterprise US-remote SWE/AI supply (verified from this box)
    "postman", "checkr", "veriff", "skyscanner", "webflow", "mattermost",
    "verkada", "purestorage", "glance", "singlestore", "neo4j", "prisma",
    "cloudflare", "circleci",
    # more non-enterprise remote-friendly engineering orgs (response-verified)
    "canonical", "nango", "athenahealth", "betterment",
]
LEVER_ORGS = ["leverdemo"]


def _title_matches(title: str, term: str) -> bool:
    """Role-relevance filter. A term like 'data engineer' must match a data-ish
    title (data/platform/analytics/engineering+data), NOT every generic
    'Engineer' listing. Falls back to full-term substring match."""
    if not term:
        return True
    t = title.strip().lower()
    term = term.strip().lower()
    # Exact/full-phrase substring match -> strong signal.
    if term in t:
        return True
    # Loose word match ONLY when at least one keyword in the term also points to
    # the discipline, to avoid every 'Backend Engineer' matching 'data engineer'.
    kb = ("data", "analytics", "etl", "warehouse", "bi ", "sql", "big data",
          "database", "platform", "pipeline", "lakehouse", "snowflake", "spark")
    if any(k in t for k in kb):
        words = [w for w in term.split() if len(w) > 3]
        return any(w in t for w in words)
    return False


def _looks_remote(loc, workplace) -> bool:
    blob = f"{loc or ''} {workplace or ''}".lower()
    return ("remote" in blob) or ("remote" in (loc or "").lower())


def scrape_greenhouse(term: str, old_days: int) -> list:
    out = []
    for org in GREENHOUSE_ORGS:
        url = f"https://api.greenhouse.io/v1/boards/{org}/jobs"
        try:
            payload = json.loads(_fetch(url))
        except Exception as e:
            print(f"[warn] greenhouse:{org} {e}", file=sys.stderr)
            continue
        for j in payload.get("jobs", []):
            title = j.get("title") or ""
            if not _title_matches(title, term):
                continue
            # remote detection: location name may include 'remote'; otherwise keep
            # role but mark is_remote from location string only.
            loc = (j.get("location") or {}).get("name") or ""
            out.append({
                "title": title,
                "company": j.get("company_name") or org,
                "site": "greenhouse",
                "job_url": j.get("absolute_url") or "",
                "location": loc or "Remote",
                "description": "",
                "date_posted": j.get("first_published"),
                "is_remote": _looks_remote(loc, None),
                "is_expired": bool(loc and j.get("is_expired")),
                "is_easy_apply": False,
            })
    print(f"[ok] greenhouse: {len(out)} jobs for '{term}'", file=sys.stderr)
    return out


def scrape_lever(term: str, old_days: int) -> list:
    out = []
    for org in LEVER_ORGS:
        url = f"https://api.lever.co/v0/postings/{org}?mode=json"
        try:
            payload = json.loads(_fetch(url))
        except Exception as e:
            print(f"[warn] lever: {org} {e}", file=sys.stderr)
            continue
        if not isinstance(payload, list):
            continue
        for p in payload:
            title = p.get("text") or ""
            if not _title_matches(title, term):
                continue
            cats = p.get("categories") or {}
            loc = cats.get("location") or ""
            wt = p.get("workplaceType") or ""
            if not _looks_remote(loc, wt):
                continue
            out.append({
                "title": title,
                "company": cats.get("team") or org,
                "site": "lever",
                "job_url": p.get("hostedUrl") or "",
                "location": loc or "Remote",
                "description": (p.get("descriptionPlain") or "")[:4000],
                "date_posted": p.get("createdAt"),
                "is_remote": "remote" in (loc + " " + wt).lower(),
                "is_expired": False,
                "is_easy_apply": False,
            })
    print(f"[ok] lever: {len(out)} jobs for '{term}'", file=sys.stderr)
    return out


# Ashby board API — clean JSON with an explicit isRemote + workplaceType + jobUrl.
# Verified from this VPS (late 2026): API is datacenter-safe and returns remote
# US roles for these non-enterprise orgs. Enterprise giants on Ashby (openai,
# notion, vercel, linear, ramp, quora, supabase) are excluded here — most are
# already filtered by the enterprise blocklist anyway.
ASHBY_ORGS = [
    "xero", "bastion", "cursor", "ditto", "sourcegraph", "methodology", "toggl",
    "smartcar", "orkes", "losant", "chainalysis", "hasura", "prisma", "upstash",
]

def _title_matches_ashby(title, term):
    if not term:
        return True
    t = title.strip().lower()
    term = term.strip().lower()
    if term in t:
        return True
    # loose word match for multi-word terms (mirrors greenhouse logic)
    kb = ("data", "software", "engineer", "developer", "full", "back", "front",
          "ai", "ml", "platform", "llm", "infra", "backend")
    if any(k in t for k in kb):
        words = [w for w in term.split() if len(w) > 3]
        return any(w in t for w in words)
    return False

def scrape_ashby(term, old_days):
    out = []
    for org in ASHBY_ORGS:
        url = f"https://api.ashbyhq.com/posting-api/job-board/{org}"
        try:
            payload = json.loads(_fetch(url))
        except Exception as e:
            print(f"[warn] ashby:{org} {e}", file=sys.stderr)
            continue
        for j in payload.get("jobs", []):
            if not j.get("isRemote"):
                continue  # strict: only explicitly-remote roles
            # The isRemote flag alone is unreliable (some orgs set it true even
            # for city/on-site roles, e.g. Xero's AU/NZ/CA entries). Require a
            # US or generic-Remote location too, so strict-remote-only holds.
            loc = (j.get("location") or "").strip()
            address = ((j.get("address") or {}).get("postalAddress") or {})
            country = (address.get("addressCountry") or "").lower()
            loc_l = loc.lower()
            is_us_remote = (
                country == "united states"
                or "united states" in loc_l
                or loc_l.startswith("us")
                or loc_l in ("remote", "anywhere", "global", "usa")
            )
            non_us_region = any(r in loc_l or r in country for r in
                                ("australia", "au:", "new zealand", "nz:", "europe",
                                 "canada", "can:", "germany", "uk", "london",
                                 "india", "singapore", "poland", "netherlands"))
            if non_us_region and not is_us_remote:
                continue  # limit AU/NZ/EU/CA to US-remote only
            title = j.get("title") or ""
            if not _title_matches_ashby(title, term):
                continue
            out.append({
                "title": title,
                "company": org,
                "site": "ashby",
                "job_url": j.get("jobUrl") or j.get("applyUrl") or "",
                "location": loc or "Remote",
                "description": "",
                "date_posted": j.get("publishedAt"),
                "is_remote": True,
                "is_expired": False,
                "is_easy_apply": False,
            })
    print(f"[ok] ashby: {len(out)} jobs for '{term}'", file=sys.stderr)
    return out


def scrape_dice(term, old_days):
    """Dice (US tech board) — from Tailor-AI's diceScraper approach. Search
    dice.com/jobs for job-detail UUIDs, fetch each detail page, parse the
    schema.org JSON-LD JobPosting (title/company/location/salary/description).
    Verified from this VPS: detail pages return clean JSON-LD. Dice serves a
    JS-heavy search shell, so we only extract the /job-detail/ UUID links, then
    hit the detail pages (which are datacenter-safe HTML+JSON-LD). Remote-only
    enforced via the workplaceTypes=Remote filter + per-job remote check."""
    q = term.strip()
    base = ("https://www.dice.com/jobs?q=" + urllib.parse.quote(q) +
            "&filters.workplaceTypes=Remote")
    seen = set()
    uuids = []
    page = 1
    while len(uuids) < 150 and page <= 5:
        url = base if page == 1 else base + f"&page={page}"
        try:
            html = _fetch(url)
        except Exception as e:
            print(f"[warn] dice:page{page} {e}", file=sys.stderr)
            break
        found = re.findall(r'href="/job-detail/([a-f0-9-]+)"', html)
        new = 0
        for u in found:
            if u not in seen:
                seen.add(u)
                uuids.append(u)
                new += 1
        if new == 0:
            break
        page += 1

    out = []
    for u in uuids[:40]:
        detail_url = f"https://www.dice.com/job-detail/{u}"
        try:
            dhtml = _fetch(detail_url)
        except Exception as e:
            print(f"[warn] dice:{u[:8]} {e}", file=sys.stderr)
            continue
        m = re.search(r'type="application/ld\+json"[^>]*>(.*?)</script>', dhtml, re.S)
        if not m:
            continue
        try:
            ld = json.loads(m.group(1))
        except Exception:
            continue
        if not isinstance(ld, dict) or ld.get("@type") != "JobPosting":
            continue
        title = (ld.get("title") or "").strip()
        if not _title_matches_ashby(title, term):
            continue
        # remote detection: location/description
        loc = ld.get("jobLocation") or {}
        addr = loc.get("address") or {}
        loc_str = " ".join(str(addr.get(k) or "") for k in
                           ("addressLocality", "addressRegion", "addressCountry"))
        blob = f"{loc_str} {ld.get('description') or ''}".lower()
        is_remote = "remote" in blob
        if not is_remote:
            continue  # strict remote-only
        desc = re.sub(r"<[^>]+>", " ", ld.get("description") or "")
        desc = re.sub(r"\s+", " ", desc).strip()
        co = ld.get("hiringOrganization") or {}
        sal = (ld.get("baseSalary") or {}).get("value") or {}
        out.append({
            "title": title,
            "company": (co.get("name") if isinstance(co, dict) else "") or "",
            "site": "dice",
            "job_url": detail_url,
            "location": loc_str.strip() or "Remote",
            "description": desc[:4000],
            "date_posted": ld.get("datePosted"),
            "is_remote": True,
            "is_expired": False,
            "is_easy_apply": False,
        })
    print(f"[ok] dice: {len(out)} jobs for '{term}'", file=sys.stderr)
    return out


def scrape_sprout(term, old_days):
    """Sprout Social careers (sproutsocial.com/careers/open-positions/).

    Next.js site. The open-positions page embeds a __NEXT_DATA__ JSON blob with
    departmentsData.departments[].jobs[] — title/location/url per opening.
    Remote-only enforced by location name. Matches the record shape used by the
    rest of the pipeline (like ashby/dice).
    """
    url = "https://sproutsocial.com/careers/open-positions/"
    try:
        html = _fetch(url)
    except Exception as e:
        print(f"[warn] sprout {e}", file=sys.stderr)
        return []
    m = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html, re.S)
    if not m:
        print("[warn] sprout: no __NEXT_DATA__", file=sys.stderr)
        return []
    try:
        data = json.loads(m.group(1))
        depts = data["props"]["pageProps"]["departmentsData"]["departments"]
    except Exception as e:
        print(f"[warn] sprout: parse {e}", file=sys.stderr)
        return []
    t = term.strip().lower()
    words = [w for w in t.split() if len(w) > 3] if t else []
    out = []
    for d in depts:
        for j in d.get("jobs", []):
            title = (j.get("title") or "").strip()
            loc = ((j.get("location") or {}).get("name") or "").strip()
            # Strict remote-only (US/CAN remote ok; skip hybrid/onsite/other-country office).
            loc_l = loc.lower()
            if not ("remote" in loc_l):
                continue
            if any(r in loc_l for r in ("hybrid", "in-office", "on-site", "poland", "ireland")):
                continue
            if words and not any(w in title.lower() for w in words):
                continue
            out.append({
                "title": title,
                "company": j.get("company_name") or "Sprout Social",
                "site": "sprout",
                "job_url": j.get("absolute_url") or f"https://sproutsocial.com/careers/open-positions/{j.get('id')}",
                "location": loc or "Remote",
                "description": "",
                "date_posted": j.get("first_published"),
                "is_remote": True,
                "is_expired": False,
                "is_easy_apply": False,
            })
    print(f"[ok] sprout: {len(out)} jobs for '{term}'", file=sys.stderr)
    return out


BOARDS = {"jobicy": scrape_jobicy, "hiringcafe": scrape_hiringcafe,
           "greenhouse": scrape_greenhouse, "lever": scrape_lever,
           "ashby": scrape_ashby, "dice": scrape_dice, "sprout": scrape_sprout}


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
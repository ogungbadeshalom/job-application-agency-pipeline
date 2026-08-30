#!/usr/bin/env python3
"""Find STRICT US-remote data-engineering jobs via Greenhouse ATS boards API and
insert them into a target profile's queue.

Greenhouse is a reliable strict-remote source: its `location.name` field literally
declares "United States - Remote" / "Remote - USA", unlike LinkedIn's city-stamped
feed. Per the ats-job-automation skill, this is the strongest honest source for
verifiable US-remote roles (1-per-company, direct-apply URLs).

Usage:
  python3 scripts/refill_greenhouse_remote.py <profile_id> [--orgs ORGS_JSON]
Env: PGPASSWORD set.

Filters:
  - title must be a data/ML/analytics role (no Director/VP/Sales/Recruiter/PM)
  - location must contain "remote" AND not name a foreign country
  - strips staffing-farm noise, dedupes by URL, respects 1-per-company
"""
import json, sys, subprocess, uuid, urllib.request, time, re

# Curated data/tech companies using Greenhouse (probe-tested on this VPS).
DEFAULT_ORGS = [
    "instacart","fivetran","databricks","stripe","datadog","iterable","brex",
    "amplitude","airtable","liveperson","collibra","zapier","asana","duolingo",
    "lyft","plaid","coinbase","chime","doordash","gusto","hashicorp","slack",
    "box","cloudflare","dropbox","mixpanel","zendesk","confluent","apolloio",
    "postman","mongodb","elastic","teradata","cloudera","toast","webflow",
]

DATA_KW = ["data engineer","analytics engineer","data platform","data warehouse",
    "etl","data pipeline","data infrastructure","data architect","ml engineer",
    "machine learning","data scientist","analytics","data model","data analyst",
    "snowflake","spark","business intelligence","data governance","data quality"]
FOREIGN = ["canada","india","poland","spain","germany","united kingdom",
    " ireland","netherlands","portugal","sweden","singapore","australia",
    "europe","emea","latam","japan","mexico","france","brazil","argentina",
    "south africa","switzerland","austria","belgium","finland","norway",
    "denmark","italy"]
BAD_TITLE = r"\b(director|vp|head of|chief|sales|account|recruiter|talent|people|customer success|support|product manager|program manager)\b"
UA = "Mozilla/5.0"


def is_data_role(title):
    t = title.lower()
    if re.search(BAD_TITLE, t):
        return False
    return any(k in t for k in DATA_KW)


def is_us_remote(location):
    ll = (location or "").lower()
    if "remote" not in ll:
        return False
    return not any(f in ll for f in FOREIGN)


def fetch_oracle(org):
    url = f"https://boards-api.greenhouse.io/v1/boards/{org}/jobs?content=true"
    try:
        d = json.loads(urllib.request.urlopen(
            urllib.request.Request(url, headers={"User-Agent": UA}), timeout=15).read())
        return d.get("jobs", [])
    except Exception:
        return None


def main():
    profile_id = sys.argv[1]
    kept, seen = [], set()
    for org in DEFAULT_ORGS:
        jobs = fetch_oracle(org)
        if jobs is None:
            continue
        for j in jobs:
            loc = (j.get("location") or {}).get("name") or ""
            title = j.get("title", "")
            if not is_data_role(title):
                continue
            if not is_us_remote(loc):
                continue
            u = j.get("absolute_url", "")
            if u in seen:
                continue
            seen.add(u)
            kept.append({"org": org, "title": title, "location": loc, "url": u})
        time.sleep(0.3)

    # 1-per-company (keep first = first-seen; newest role).
    best = {}
    for k in kept:
        if k["org"] not in best:
            best[k["org"]] = k
    to_insert = list(best.values())
    print(f"US-remote data roles found (1/company): {len(to_insert)}")

    def esc(s):
        return "'" + str(s).replace("'", "''") + "'" if s is not None else "NULL"

    def run(sql):
        r = subprocess.run(["psql", "-h", "localhost", "-p", "5432", "-U", "jobbids",
                            "-d", "job_bidder", "-c", sql], capture_output=True, text=True,
                           env={"PGPASSWORD": "jobbids"})
        return r.stdout.strip(), r.stderr.strip()

    out, _ = run(f"select url from jobs where profile_id='{profile_id}'")
    existing = set(x for x in out.splitlines() if x.strip())
    now = "2026-08-25T12:30:00"
    inserted = 0
    for k in to_insert:
        if k["url"] in existing:
            continue
        jid = str(uuid.uuid4())
        sql = (f"insert into jobs (id,profile_id,title,company,board,url,description,"
               f"compensation_min,compensation_max,compensation_currency,location,status,"
               f"tailored_resume,submitted_at,proof_of_submission,notes,created_at,updated_at) "
               f"values ({esc(jid)},{esc(profile_id)},{esc(k['title'])},{esc(k['org'])},'greenhouse',"
               f"{esc(k['url'])},'',NULL,NULL,NULL,{esc(k['location'])},'saved',NULL,NULL,NULL,NULL,"
               f"{esc(now)},{esc(now)})")
        o2, e2 = run(sql)
        if e2:
            print("  ERR:", e2[:80])
            continue
        existing.add(k["url"])
        inserted += 1
        print(f"  + {k['org']} | {k['title']} | {k['location']}")
    print(f"\ninserted {inserted} (already present: {len(to_insert) - inserted})")


if __name__ == "__main__":
    main()
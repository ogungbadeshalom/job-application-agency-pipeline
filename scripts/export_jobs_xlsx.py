#!/usr/bin/env python3
"""EXPIRIMENTAL — export scraped jobs to a spreadsheet (no DB insert).

Usage:
    python scripts/export_jobs_xlsx.py <config_json> <jobs_json> <out.xlsx>

Reads the jobs JSON produced by run_jobspy.py and writes an .xlsx for the admin
to inspect what a scrape actually returns. This lets you audit the pipeline
without polluting the candidate's queue. May be removed later.
"""
import sys, json
import pandas as pd

if len(sys.argv) < 4:
    print("Usage: export_jobs_xlsx.py <config_json> <jobs_json> <out.xlsx>", file=sys.stderr)
    sys.exit(2)

config = json.loads(sys.argv[1])
with open(sys.argv[2], 'r', encoding='utf-8') as f:
    jobs_file = f.read()
jobs = json.loads(jobs_file)
out_file = sys.argv[3]

def cell(v):
    if isinstance(v, float) and (v != v):   # NaN
        return None
    return v

rows = []
for j in jobs:
    rows.append({
        'title': cell(j.get('title')),
        'company': cell(j.get('company')),
        'board/site': cell(j.get('site')),
        'url': cell(j.get('job_url')),
        'comp_min': cell(j.get('interval_amount')),
        'currency': cell(j.get('currency')),
        'location': cell(j.get('location')),
        'date_posted': cell(j.get('date_posted')),
        'description': (cell(j.get('description')) or '').strip() or None,
    })
    if 'description' in j:
        del j['description']  # not included to keep rows compact? no—already captured above

# Headline summary
meta = {
    'search_terms': ', '.join(config.get('search_terms', [])),
    'sites': ', '.join(config.get('sites', [])),
    'location': config.get('location', ''),
    'remote_only': config.get('remote_only'),
    'jobs_scraped': len(rows),
}

import pandas as pd
with pd.ExcelWriter(out_file, engine='openpyxl') as writer:
    pd.DataFrame([meta]).T.rename(columns={0: 'value'}).to_excel(writer, sheet_name='Overview', header=False)
    pd.DataFrame(rows).to_excel(writer, sheet_name='Jobs', index=False)

print(f"[ok] {len(rows)} jobs written to {out_file}", file=sys.stderr)
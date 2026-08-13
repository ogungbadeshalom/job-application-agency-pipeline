#!/usr/bin/env python3
"""Playheadless Chromium scraper for HiringCafe (OPT-IN, remote jobs).

Why headless browser: HiringCafe renders everything client-side (Next.js RSC)
with no public API. Its DOM is unstable/virtualized, so we do NOT depend on CSS
selectors — we drive a headless Chrome, search a term, let results render, then
parse the visible text into structured job records.

HEAVY on RAM (~1 Chromium process, ~400MB). This box has ~900MB free with the
app running. SO: call this ONLY as an opt-in single search (the Experimental
export path), never inside a large multi-term batch — it can OOM the app.

Usage:
    python scrape_hiringcafe_scraper.py "<term>" [--max N]
Prints a JSON array of job records shaped like JobSpy output.
"""
import argparse
import json
import os
import sys

CHROME_CANDIDATES = ["/usr/bin/chromium-browser", "/snap/bin/chromium", "/usr/bin/google-chrome"]
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/124.0 Safari/537.36")
MARKERS = ("remote", "hybrid", "on-site", "onsite", "field")


def _chrome() -> str:
    for c in CHROME_CANDIDATES:
        if os.path.exists(c):
            return c
    raise SystemExit("No Chromium binary found. Run: apt install chromium-browser")


def _jobs_from_lines(lines, max_results, remote_only=True):
    """Parse visible text into job records. A job card reads roughly:
        <Title line>
        <Marker: Remote/Hybrid/On-site>   <- we key on this
        Full Time
        <Company>: <description>
        ...
    Title is the line just before the marker. remote_only drops On-site/Hybrid.
    """
    jobs = []
    i = 0
    n = len(lines)
    while i < n and len(jobs) < max_results:
        line = lines[i].lower()
        if any(m in line for m in MARKERS):
            is_remote = "remote" in line
            if remote_only and not is_remote:
                i += 1
                continue
            title = lines[i - 2].strip() if i >= 2 else ""
            loc = lines[i - 1].strip() if i >= 1 else ""
            # peek following lines: "Full Time", then "<Company>: desc"
            block = [lines[i]]
            for j in range(i + 1, min(i + 14, n)):
                block.append(lines[j])
                if len(block) >= 5:
                    break
            company = ""
            desc_parts = []
            for b in block[1:]:
                if ":" in b:
                    company = b.split(":", 1)[0].strip()
                    desc_parts.append(b.split(":", 1)[1].strip())
                elif b != "Full Time" and "@" not in b and len(b) < 40:
                    pass
                else:
                    desc_parts.append(b)
            jobs.append({
                "title": title or "Remote role",
                "location": loc,
                "company": company,
                "site": "hiringcafe",
                "is_remote": is_remote,
                "description": "\n".join(desc_parts[:3]),
            })
            i += len(block)
        else:
            i += 1
    return jobs


def scrape(term: str, max_results: int, remote_only: bool = True) -> list:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=_chrome(),
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--single-process"],
        )
        page = browser.new_page(user_agent=UA)
        page.goto("https://hiringcafe.com/jobs", timeout=45000, wait_until="domcontentloaded")
        page.wait_for_timeout(3500)
        # Dismiss consent banner
        for sel in ("text=Accept All", "button:has-text('Accept')", "text=Accept all"):
            try:
                el = page.query_selector(sel)
                if el:
                    el.click()
                    page.wait_for_timeout(1200)
                    break
            except Exception:
                continue
        # Search
        inp = page.query_selector("input[type='search']") or page.query_selector("input[placeholder]")
        if inp:
            inp.fill(term)
            page.keyboard.press("Enter")
            page.wait_for_timeout(1200)
            try:
                page.keyboard.press("Enter")
            except Exception:
                pass
        page.wait_for_timeout(12000)
        body = page.inner_text("body")
        lines = [l.strip() for l in body.split("\n") if l.strip()]
        jobs = _jobs_from_lines(lines, max_results, remote_only)
        try:
            browser.close()
        except Exception:
            pass
    return jobs


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("term")
    ap.add_argument("--max", type=int, default=20)
    ap.add_argument("--remote-only", dest="remote_only", action="store_true")
    args = ap.parse_args()
    out = scrape(args.term, args.max, args.remote_only)
    print(json.dumps(out, default=str, indent=2))
    print(f"\n[debug] {len(out)} jobs for '{args.term}'", file=sys.stderr)
#!/usr/bin/env python3
"""
Resolve SportyBet booking codes on a residential IP (run on Shalom's PC).
Logs in, enters each booking code, captures exactly what the site shows
(teams / markets / odds per leg), and writes results to resolve_out.txt.

Usage (Windows):
    python -m pip install playwright
    python -m playwright install chromium
    python sporty_resolve.py
"""
import json
import os
import time

# Credentials come from env vars — NEVER hardcoded (kept out of git).
USERNAME = os.environ.get("SPORTY_USER", "")
PASSWORD = os.environ.get("SPORTY_PASS", "")
CODES = json.loads(os.environ.get("SPORTY_CODES", '["JX368B", "QB2Q1E"]'))
BASE = "https://sportybet.com/ng"

if not USERNAME or not PASSWORD:
    import sys
    print("Set SPORTY_USER and SPORTY_PASS env vars before running.", file=sys.stderr)
    sys.exit(1)

from playwright.sync_api import sync_playwright

results = {}

def visible(page):
    return page.evaluate("document.body ? document.body.innerText : ''")

def extract_codes_block(text):
    """Try to carve out the block of meaningful ticket text (skip nav/footer)."""
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    # Keep lines that look like team/market/odds or are short labels; drop nav garnish heuristically.
    return lines

def run():
    with sync_playwright() as p:
        b = p.chromium.launch(headless=False, executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe")
        ctx = b.new_context(viewport={"width": 1366, "height": 900})
        page = ctx.new_page()
        print("[1] opening site...", flush=True)
        page.goto(BASE, timeout=60000, wait_until="domcontentloaded")
        page.wait_for_timeout(6000)  # let the JS challenge settle
        print("[2] page state:", visible(page)[:120].replace("\n", " | "), flush=True)

        # ---- DIAGNOSTIC DUMP: every interactive element on the page ----
        dump = page.evaluate("""() => {
            const out = [];
            document.querySelectorAll('input, button, [role="button"], [role="link"]').forEach(el => {
                const r = el.tagName;
                const place = el.getAttribute && el.getAttribute('placeholder') || '';
                const id = el.id || '';
                const name = el.name || '';
                const cls = (el.className && typeof el.className === 'string') ? el.className.slice(0,60) : '';
                const txt = (el.innerText || el.textContent || '').trim().slice(0,40);
                out.push([r, 'place='+place, 'id='+id, 'name='+name, 'cls='+cls, 'txt='+txt].join(' | '));
            });
            return out.slice(0, 150);
        }""")
        print("[DIAG] interactive elements:", flush=True)
        for line in dump:
            print("   ", line, flush=True)
        try:
            page.screenshot(path="sporty_page.png", full_page=True)
            print("[DIAG] saved sporty_page.png", flush=True)
        except Exception as e:
            print("[DIAG] screenshot failed:", e, flush=True)
        # ----------------------------------------------------------------

        # Try to log in if there's a login affordance
        try:
            page.get_by_role("button", name=re("Log in")).click(timeout=8000)
            page.wait_for_timeout(2000)
        except Exception:
            pass
        try:
            # generic form fill — selectors may vary
            for sel in ['input[placeholder*="username" i]', 'input[placeholder*="phone" i]', '#txtUserName', 'input[name*="user"]']:
                try:
                    page.fill(sel, USERNAME, timeout=4000)
                    print("[3] filled username via", sel, flush=True)
                    break
                except Exception:
                    continue
            for sel in ['input[type="password"]', 'input[placeholder*="password" i]', '#txtPassword']:
                try:
                    page.fill(sel, PASSWORD, timeout=4000)
                    print("[4] filled password via", sel, flush=True)
                    break
                except Exception:
                    continue
            page.get_by_role("button", name=re("Log in")).last.click(timeout=6000)
            page.wait_for_timeout(5000)
        except Exception as e:
            print("[i] login step skipped:", e, flush=True)

        for code in CODES:
            block = {}
            try:
                print(f"[5] resolving {code}...", flush=True)
                # enter the booking code in the dedicated field
                for sel in ['input[placeholder*="booking" i]', 'input[placeholder*="code" i]', 'input[name*="booking"]', '#txtBookCode', '.booking-code input']:
                    try:
                        page.fill(sel, code, timeout=5000)
                        page.keyboard.press("Enter")
                        page.wait_for_timeout(5000)
                        print(f"   entered via {sel}", flush=True)
                        break
                    except Exception:
                        continue
                block["text"] = extract_codes_block(visible(page))
            except Exception as e:
                block["error"] = str(e)
            results[code] = block
            print("=== begin block for", code, "===", flush=True)
            for ln in block.get("text", [])[:120]:
                print("   ", ln, flush=True)
            print("=== end block ===", flush=True)

        b.close()

    with open("resolve_out.txt", "w", encoding="utf-8") as f:
        f.write(json.dumps(results, indent=2, ensure_ascii=False))

def re(p):
    import re as _re
    return _re.compile(p, _re.IGNORECASE)

if __name__ == "__main__":
    run()
    print("\nDONE -> wrote resolve_out.txt", flush=True)
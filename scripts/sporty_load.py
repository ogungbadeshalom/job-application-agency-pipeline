#!/usr/bin/env python3
"""
Resolve SportyBet booking codes via their anonymous JSON API.
Runs on Shalom's PC (residential IP — the VPS gets CloudFront-blocked).

Usage (Windows):
    python sporty_load.py JX368B QB2Q1E
  or pass a saved file: python sporty_load.py @codes.txt
  or default: python sporty_load.py   (uses JX368B QB2Q1E)
"""
import json
import sys

import requests

BASE = "https://www.sportybet.com/api/ng/orders/share"
HEADERS = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "Current-Country": "NG",
    "User-Agent": "Mozilla/5.0",
}

def flatten(g):
    """Turn a game entry into readable lines."""
    team = (g.get("teamName") or g.get("teams") or g.get("home") or
            f"{g.get('homeTeam','')} vs {g.get('awayTeam','')}").strip()
    pick = g.get("outcomeName") or g.get("pick") or g.get("selection") or ""
    mkt = g.get("marketName") or g.get("description") or g.get("market") or ""
    odds = g.get("odds") or g.get("odd") or ""
    return {"team": team, "pick": pick, "market": mkt, "odds": odds,
            "raw": g}

def main():
    if len(sys.argv) > 1 and sys.argv[1].startswith("@"):
        raw = open(sys.argv[1][1:]).read().split()
        codes = [c.strip() for c in raw if c.strip()]
    elif len(sys.argv) > 1:
        codes = sys.argv[1:]
    else:
        codes = ["JX368B", "QB2Q1E"]

    out = {}
    for code in codes:
        print(f"\n===== {code} =====")
        try:
            r = requests.get(f"{BASE}/{code}", headers=HEADERS, timeout=25)
            print(f"HTTP {r.status_code}")
            try:
                data = r.json()
            except Exception:
                print("[raw]", r.text[:300])
                out[code] = {"status": r.status_code, "error": r.text[:300]}
                continue
            out[code] = data

            if isinstance(data, dict) and data.get("games"):
                games = data["games"]
                total = data.get("totalOdds") or data.get("total") or ""
                print(f"  {len(games)} leg(s) | total odds: {total}")
                for i, g in enumerate(games, 1):
                    f = flatten(g)
                    l = f"{i:>2}. {f['team']:<35} | {f['pick']:<18} | {f['market']:<25} | {f['odds']}"
                    print("   " + l)
            else:
                print("[json]", json.dumps(data, indent=2)[:1200])
        except Exception as e:
            print("[error]", repr(e))
            out[code] = {"error": str(e)}

    with open("load_out.json", "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=2, ensure_ascii=False)
    print(f"\nDONE -> wrote load_out.json")

if __name__ == "__main__":
    main()
#!/usr/bin/env python3
"""Build public/carddata/popularity.json — card names ordered by EDHREC rank.

Scryfall carries EDHREC's own popularity ranking on every card as `edhrec_rank`
(1 = most played in Commander), so this needs no EDHREC scraping and stays
within Scryfall's documented API.

The output is a plain array of names, most-played first, so the index into the
array IS the popularity rank. Two uses:

  * SNAPTEST can sample the cards players actually own instead of drawing
    uniformly from 110k printings, where 81% of the draw sits outside the EDHREC
    top 2000 and 10% is tokens, art-series prints and Un-set jokes.
  * Recognition can treat "nobody plays this" as weak evidence against a match.

Run:  python3 scripts/build_popularity.py [--limit 20000]
"""

import argparse
import json
import os
import time
import urllib.parse
import urllib.request

API = "https://api.scryfall.com/cards/search"
HEADERS = {"Accept": "application/json", "User-Agent": "snapcast-popularity/1.0"}
CARDDATA = os.path.join(os.path.dirname(__file__), "..", "public", "carddata")
OUT = os.path.join(CARDDATA, "popularity.json")
OUT_TOKENS = os.path.join(CARDDATA, "tokens.json")


def fetch(limit):
    names, seen, page = [], set(), 1
    query = urllib.parse.urlencode({
        "q": "has:edhrec -is:digital",
        "order": "edhrec",
        "unique": "cards",
    })
    while len(names) < limit:
        url = f"{API}?{query}&page={page}"
        with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS)) as r:
            payload = json.load(r)
        for card in payload["data"]:
            name = card["name"]
            # Modal double-faced cards are "A // B" on Scryfall, but the card
            # index keys them by the front face alone. Normalise here so every
            # consumer does not have to rediscover this — it accounts for all
            # 400 names that otherwise fail to resolve against the index.
            if " // " in name and card.get("layout") in (
                    "modal_dfc", "transform", "flip", "adventure", "split"):
                name = name.split(" // ")[0]
            # `unique=cards` still repeats a name across faces/variants.
            if name in seen:
                continue
            seen.add(name)
            names.append(name)
            if len(names) >= limit:
                break
        if not payload.get("has_more"):
            break
        page += 1
        # Scryfall asks for 50-100ms between requests; be a good citizen.
        time.sleep(0.12)
    return names


def fetch_tokens():
    """Token names, most-printed first.

    Tokens carry no edhrec_rank, but they matter a great deal in practice — a
    Treasure or Soldier on the battlefield is exactly the thing a player clicks,
    since "what token is that?" is the question a remote table cannot answer by
    leaning over. How often Wizards has printed a token is a good stand-in for
    how often one shows up, and that count is already in our own card index.
    """
    names, page = set(), 1
    query = urllib.parse.urlencode({"q": "is:token -is:digital", "unique": "cards"})
    while True:
        url = f"{API}?{query}&page={page}"
        with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS)) as r:
            payload = json.load(r)
        for card in payload["data"]:
            names.add(card["name"])
        if not payload.get("has_more"):
            break
        page += 1
        time.sleep(0.12)

    with open(os.path.join(CARDDATA, "cards.json"), encoding="utf-8") as f:
        rows = json.load(f)
    counts = {}
    for row in rows:
        if row[4] == 0:
            counts[row[0]] = counts.get(row[0], 0) + 1
    present = [(n, counts[n]) for n in names if n in counts]
    present.sort(key=lambda x: -x[1])
    return [n for n, _ in present]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=20000)
    args = ap.parse_args()
    names = fetch(args.limit)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(names, f, ensure_ascii=False, separators=(",", ":"))
    print(f"wrote {len(names)} names -> {os.path.relpath(OUT)}")
    print(f"  most played: {', '.join(names[:5])}")
    print(f"  rank 15000 : {names[14999] if len(names) > 14999 else '(n/a)'}")
    tokens = fetch_tokens()
    with open(OUT_TOKENS, "w", encoding="utf-8") as f:
        json.dump(tokens, f, ensure_ascii=False, separators=(",", ":"))
    print(f"wrote {len(tokens)} token names -> {os.path.relpath(OUT_TOKENS)}")
    print(f"  most printed: {', '.join(tokens[:5])}")


if __name__ == "__main__":
    main()

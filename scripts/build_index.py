#!/usr/bin/env python3
"""Build the browser card index from Scryfall into public/carddata/.

Runs in GitHub Actions (see .github/workflows/build-index.yml) — no local
setup needed. Outputs:
  public/carddata/hashes.bin  raw uint8, N x 64 bytes (256-bit pHash + 256-bit dHash)
  public/carddata/cards.json  [[name, set, collector_number, scryfall_id, face], ...]

Usage:
  python scripts/build_index.py --bulk default_cards   # every printing (default)
  python scripts/build_index.py --query "set:otj"      # quick test index
"""
import argparse, io, json, os, sys, time
import numpy as np
import cv2
import requests
from PIL import Image

API = "https://api.scryfall.com"
HEADERS = {"User-Agent": "Snapcaster/1.0 (fan project)", "Accept": "*/*"}
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "carddata")
CACHE = os.path.join(ROOT, ".cache")

HASH_SIZE = 16
CARD_W, CARD_H = 244, 340


def phash_bits(gray):
    img = cv2.resize(gray, (64, 64), interpolation=cv2.INTER_AREA)
    dct = cv2.dct(img.astype(np.float32))
    low = dct[:HASH_SIZE, :HASH_SIZE]
    return (low > np.median(low)).flatten()


def dhash_bits(gray):
    img = cv2.resize(gray, (HASH_SIZE + 1, HASH_SIZE), interpolation=cv2.INTER_AREA)
    return (img[:, 1:] > img[:, :-1]).flatten()


def compute_hashes(bgr):
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    return np.concatenate([np.packbits(phash_bits(gray)), np.packbits(dhash_bits(gray))]).astype(np.uint8)


def iter_query_cards(query):
    url, params = f"{API}/cards/search", {"q": query, "unique": "prints"}
    while url:
        r = requests.get(url, params=params, headers=HEADERS, timeout=30)
        r.raise_for_status()
        data = r.json()
        yield from data["data"]
        url, params = data.get("next_page"), None
        time.sleep(0.1)


def iter_bulk_cards(bulk_type):
    r = requests.get(f"{API}/bulk-data", headers=HEADERS, timeout=30)
    r.raise_for_status()
    entry = next(b for b in r.json()["data"] if b["type"] == bulk_type)
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f"{bulk_type}.json")
    if not os.path.exists(path):
        print(f"Downloading bulk metadata ({entry['size'] / 1e6:.0f} MB)...", flush=True)
        with requests.get(entry["download_uri"], headers=HEADERS, stream=True, timeout=120) as resp:
            resp.raise_for_status()
            with open(path, "wb") as f:
                for chunk in resp.iter_content(1 << 20):
                    f.write(chunk)
    with open(path, encoding="utf-8") as f:
        yield from json.load(f)


def faces(card):
    """Yield (face_index, image_url, display_name). face 0=front, 1=back."""
    if card.get("image_uris"):
        u = card["image_uris"].get("small") or card["image_uris"].get("normal")
        if u:
            yield 0, u, card["name"]
        return
    for i, f in enumerate(card.get("card_faces") or []):
        if f.get("image_uris"):
            u = f["image_uris"].get("small") or f["image_uris"].get("normal")
            if u:
                yield min(i, 1), u, f.get("name", card["name"])


def fetch_image(url, session):
    r = session.get(url, headers=HEADERS, timeout=30)
    r.raise_for_status()
    img = Image.open(io.BytesIO(r.content)).convert("RGB")
    bgr = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)
    return cv2.resize(bgr, (CARD_W, CARD_H), interpolation=cv2.INTER_AREA)


def main():
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--query")
    g.add_argument("--bulk")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()
    if not args.query and not args.bulk:
        args.bulk = "default_cards"

    cards_iter = iter_query_cards(args.query) if args.query else iter_bulk_cards(args.bulk)
    session = requests.Session()

    hashes, meta = [], []
    n = fails = 0
    t0 = time.time()
    for card in cards_iter:
        if card.get("digital"):
            continue  # skip Arena/MTGO-only printings
        for face, url, name in faces(card):
            for attempt in range(3):
                try:
                    bgr = fetch_image(url, session)
                    hashes.append(compute_hashes(bgr))
                    meta.append([name, card.get("set", ""), card.get("collector_number", ""),
                                 card["id"], face])
                    break
                except Exception as e:
                    if attempt == 2:
                        fails += 1
                        print(f"  ! {name}: {e}", file=sys.stderr)
                    else:
                        time.sleep(2)
            time.sleep(0.075)  # Scryfall rate-limit courtesy (~13 req/s max)
        n += 1
        if n % 1000 == 0:
            rate = n / (time.time() - t0)
            print(f"  {n} cards, {len(meta)} faces, {rate:.1f} cards/s", flush=True)
        if args.limit and n >= args.limit:
            break

    if not hashes:
        sys.exit("No cards indexed — check the query.")

    os.makedirs(OUT, exist_ok=True)
    np.stack(hashes).tofile(os.path.join(OUT, "hashes.bin"))
    with open(os.path.join(OUT, "cards.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, separators=(",", ":"))
    print(f"Done: {len(meta)} card faces indexed ({fails} failures) -> public/carddata/")


if __name__ == "__main__":
    main()

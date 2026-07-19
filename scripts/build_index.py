#!/usr/bin/env python3
"""Build a sharded browser index containing every English paper printing.

Outputs:
  manifest.json          index version and counts
  names.json             unique card names used by OCR fuzzy matching
  shards/00..ff.json     metadata + visual hash, partitioned by card name

Each shard row is:
  [name, set, collector_number, scryfall_id, face, base64_hash]

Existing shards (or the legacy cards.json/hashes.bin pair) are reused by
Scryfall ID + face, so scheduled updates download only newly released artwork.
"""
import argparse
import base64
import concurrent.futures
import io
import json
import os
import shutil
import sys
import threading
import time
import unicodedata

import cv2
import numpy as np
import requests
from PIL import Image

API = "https://api.scryfall.com"
HEADERS = {"User-Agent": "Snapcaster/2.0 (fan project)", "Accept": "*/*"}
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_OUT = os.path.join(ROOT, "public", "carddata")
DEFAULT_CACHE = os.path.join(ROOT, ".cache")

HASH_SIZE = 16
CARD_W, CARD_H = 244, 340
VEC_BYTES = 64
SHARD_COUNT = 256


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


def normalize_name(name):
    value = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    return " ".join("".join(ch if ch.isalnum() else " " for ch in value).split())


def shard_key(name):
    value = normalize_name(name).encode("utf-8")
    result = 0x811C9DC5
    for byte in value:
        result ^= byte
        result = (result * 0x01000193) & 0xFFFFFFFF
    return f"{result & 0xFF:02x}"


def iter_query_cards(query):
    url, params = f"{API}/cards/search", {"q": query, "unique": "prints"}
    while url:
        response = requests.get(url, params=params, headers=HEADERS, timeout=30)
        response.raise_for_status()
        data = response.json()
        yield from data["data"]
        url, params = data.get("next_page"), None
        time.sleep(0.1)


def iter_bulk_cards(bulk_type, cache_dir):
    response = requests.get(f"{API}/bulk-data", headers=HEADERS, timeout=30)
    response.raise_for_status()
    entry = next(item for item in response.json()["data"] if item["type"] == bulk_type)
    os.makedirs(cache_dir, exist_ok=True)
    path = os.path.join(cache_dir, f"{bulk_type}-{entry['updated_at'][:10]}.json")
    if not os.path.exists(path):
        print(f"Downloading bulk metadata ({entry['size'] / 1e6:.0f} MB)...", flush=True)
        with requests.get(entry["download_uri"], headers=HEADERS, stream=True, timeout=180) as download:
            download.raise_for_status()
            with open(path, "wb") as output:
                for chunk in download.iter_content(1 << 20):
                    output.write(chunk)
    with open(path, encoding="utf-8") as source:
        yield from json.load(source)


def faces(card):
    """Yield (face_index, image_url, display_name)."""
    if card.get("image_uris"):
        url = card["image_uris"].get("small") or card["image_uris"].get("normal")
        if url:
            yield 0, url, card["name"]
        return
    for index, face in enumerate(card.get("card_faces") or []):
        if face.get("image_uris"):
            url = face["image_uris"].get("small") or face["image_uris"].get("normal")
            if url:
                yield min(index, 1), url, face.get("name", card["name"])


def load_existing(out_dir):
    """Return {(scryfall_id, face): row} from v2 shards or legacy files."""
    existing = {}
    shard_dir = os.path.join(out_dir, "shards")
    if os.path.isdir(shard_dir):
        for filename in os.listdir(shard_dir):
            if not filename.endswith(".json"):
                continue
            with open(os.path.join(shard_dir, filename), encoding="utf-8") as source:
                for row in json.load(source):
                    existing[(row[3], int(row[4]))] = row
        return existing

    cards_path = os.path.join(out_dir, "cards.json")
    hashes_path = os.path.join(out_dir, "hashes.bin")
    if os.path.exists(cards_path) and os.path.exists(hashes_path):
        with open(cards_path, encoding="utf-8") as source:
            cards = json.load(source)
        hashes = np.fromfile(hashes_path, dtype=np.uint8)
        if hashes.size == len(cards) * VEC_BYTES:
            hashes = hashes.reshape((-1, VEC_BYTES))
            for row, vector in zip(cards, hashes):
                existing[(row[3], int(row[4]))] = [
                    *row[:5], base64.b64encode(vector.tobytes()).decode("ascii")
                ]
    return existing


class RateLimiter:
    def __init__(self, requests_per_second=9):
        self.interval = 1 / requests_per_second
        self.next_at = 0.0
        self.lock = threading.Lock()

    def wait(self):
        with self.lock:
            now = time.monotonic()
            delay = max(0, self.next_at - now)
            self.next_at = max(now, self.next_at) + self.interval
        if delay:
            time.sleep(delay)


def fetch_and_hash(task, limiter):
    name, set_code, collector_number, card_id, face, url = task
    session = requests.Session()
    for attempt in range(4):
        try:
            limiter.wait()
            response = session.get(url, headers=HEADERS, timeout=30)
            response.raise_for_status()
            image = Image.open(io.BytesIO(response.content)).convert("RGB")
            bgr = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
            bgr = cv2.resize(bgr, (CARD_W, CARD_H), interpolation=cv2.INTER_AREA)
            vector = compute_hashes(bgr)
            return [name, set_code, collector_number, card_id, face,
                    base64.b64encode(vector.tobytes()).decode("ascii")]
        except Exception as error:
            if attempt == 3:
                return error
            time.sleep(2 ** attempt)


def write_index(rows, out_dir):
    shards = {f"{index:02x}": [] for index in range(SHARD_COUNT)}
    for row in rows:
        shards[shard_key(row[0])].append(row)
    for values in shards.values():
        values.sort(key=lambda row: (normalize_name(row[0]), row[1], str(row[2]), row[3], row[4]))

    os.makedirs(out_dir, exist_ok=True)
    temp_dir = os.path.join(out_dir, "shards-next")
    shutil.rmtree(temp_dir, ignore_errors=True)
    os.makedirs(temp_dir)
    for key, values in shards.items():
        if values:
            with open(os.path.join(temp_dir, f"{key}.json"), "w", encoding="utf-8") as output:
                json.dump(values, output, separators=(",", ":"))

    shard_dir = os.path.join(out_dir, "shards")
    shutil.rmtree(shard_dir, ignore_errors=True)
    os.replace(temp_dir, shard_dir)
    names = sorted({row[0] for row in rows}, key=normalize_name)
    with open(os.path.join(out_dir, "names.json"), "w", encoding="utf-8") as output:
        json.dump(names, output, separators=(",", ":"))
    with open(os.path.join(out_dir, "manifest.json"), "w", encoding="utf-8") as output:
        json.dump({
            "version": 2,
            "count": len(rows),
            "names": len(names),
            "shards": SHARD_COUNT,
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }, output, separators=(",", ":"))

    # Lazy visual fallback for cards whose title treatment is not OCR-friendly
    # (some Secret Lairs in particular). The browser only downloads these files
    # after title OCR fails; ordinary scans stay on the much smaller name shard.
    ordered = sorted(rows, key=lambda row: (
        normalize_name(row[0]), row[1], str(row[2]), row[3], row[4]
    ))
    with open(os.path.join(out_dir, "cards.json"), "w", encoding="utf-8") as output:
        json.dump([row[:5] for row in ordered], output, separators=(",", ":"))
    with open(os.path.join(out_dir, "hashes.bin"), "wb") as output:
        for row in ordered:
            output.write(base64.b64decode(row[5]))

def main():
    parser = argparse.ArgumentParser()
    scope = parser.add_mutually_exclusive_group()
    scope.add_argument("--query")
    scope.add_argument("--bulk")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--out", default=DEFAULT_OUT)
    parser.add_argument("--cache", default=DEFAULT_CACHE)
    args = parser.parse_args()
    if not args.query and not args.bulk:
        args.bulk = "default_cards"

    existing = load_existing(args.out)
    cards_iter = iter_query_cards(args.query) if args.query else iter_bulk_cards(args.bulk, args.cache)
    tasks, reused = [], []
    card_count = 0
    for card in cards_iter:
        if card.get("digital") or "paper" not in (card.get("games") or []):
            continue
        for face, url, name in faces(card):
            key = (card["id"], face)
            if key in existing:
                reused.append(existing[key])
            else:
                tasks.append((
                    name, card.get("set", ""), card.get("collector_number", ""),
                    card["id"], face, url,
                ))
        card_count += 1
        if args.limit and card_count >= args.limit:
            break

    print(f"Scope: {card_count} cards; reusing {len(reused)} faces; hashing {len(tasks)} new faces", flush=True)
    limiter = RateLimiter()
    added, failures = [], 0
    started = time.time()
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = [executor.submit(fetch_and_hash, task, limiter) for task in tasks]
        for index, future in enumerate(concurrent.futures.as_completed(futures), 1):
            result = future.result()
            if isinstance(result, Exception):
                failures += 1
                print(f"  ! {result}", file=sys.stderr)
            else:
                added.append(result)
            if index % 500 == 0:
                rate = index / max(1, time.time() - started)
                print(f"  {index}/{len(tasks)} new faces ({rate:.1f}/s), {failures} failures", flush=True)

    rows = reused + added
    if not rows:
        sys.exit("No card faces indexed.")
    write_index(rows, args.out)
    print(f"Done: {len(rows)} faces, {len({row[0] for row in rows})} names, "
          f"{failures} failures -> {args.out}", flush=True)


if __name__ == "__main__":
    main()

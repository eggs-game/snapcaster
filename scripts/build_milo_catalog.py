#!/usr/bin/env python3
"""Build Milo's complete, row-aligned browser catalog; never infer remotely.

Reuse the upstream compatible seed and our cached additions. Only new faces
need local ONNX inference. Publish nothing if a face fails or tables disagree.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import io
import json
from pathlib import Path
import threading
import time

import numpy as np
from PIL import Image
import requests

ROOT = Path(__file__).resolve().parents[1]
REVISION = '9bcc5e809e936b8c5630d1e7101aae1de1e76621'
MODEL_SHA = 'bd13d8d60383c69da04dce261f32e93fdaeaa8fd618fbc991e7385f71b3d45df'
SEED_SHA = 'c5cb0dc150eb9f5b183396dd25aecaa9efc5ce3d001dd8bef282fcc73ee778be'
SEED_FILE = 'milo1-scryfall-mtg-2026-07-09.npz'
PREPROCESS = 'milo1-rgb-portrait-ccw-bilinear448-imagenet-v1'
HEADERS = {'User-Agent': 'Snapcast/2.0 (fan project)', 'Accept': '*/*'}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def pinned(path, remote, checksum):
    if not path.exists():
        r = requests.get(f'https://huggingface.co/HanClinto/milo/resolve/{REVISION}/{remote}', headers=HEADERS, timeout=180)
        r.raise_for_status()
        if sha(r.content) != checksum:
            raise ValueError('Downloaded Milo asset checksum mismatch')
        path.write_bytes(r.content)
    if sha(path.read_bytes()) != checksum:
        raise ValueError('Cached Milo asset checksum mismatch')


def preprocess(image):
    if image.width > image.height:
        image = image.transpose(Image.Transpose.ROTATE_90)
    pixels = np.array(image.convert('RGB').resize((448, 448), Image.Resampling.BILINEAR), dtype=np.float32)
    pixels = (pixels / 255 - np.array([.485, .456, .406], np.float32)) / np.array([.229, .224, .225], np.float32)
    return np.ascontiguousarray(pixels.transpose(2, 0, 1)[None])


def validate_vectors(ids, vectors):
    if len(set(ids)) != len(ids) or vectors.shape != (len(ids), 128):
        raise ValueError('Duplicate faces or incompatible embedding shape')
    if not np.isfinite(vectors).all() or np.any(np.abs(np.linalg.norm(vectors, axis=1) - 1) > .002):
        raise ValueError('Invalid Milo embeddings')


def publish(rows, vectors, cards_bytes, dest):
    """All validation precedes mutation, including full face coverage."""
    ids = [r[3] + ('_back' if r[4] else '') for r in rows]
    validate_vectors(ids, vectors)
    quant = np.rint(vectors * 127).clip(-127, 127).astype(np.int8)
    norms = np.linalg.norm(quant.astype(np.float32), axis=1).astype('<f4')
    if np.any(norms <= 0) or not np.isfinite(norms).all():
        raise ValueError('Invalid quantized embeddings')
    names = {}
    groups = []
    for row in rows:
        if row[0] not in names:
            names[row[0]] = len(names)
        groups.append(names[row[0]])
    tables = {'vectors.bin': quant.tobytes(), 'norms.bin': norms.tobytes(),
              'names.bin': np.array(groups, dtype='<u4').tobytes()}
    manifest = {'version': 1, 'model': 'milo1', 'revision': REVISION, 'model_sha256': MODEL_SHA,
                'preprocess': PREPROCESS, 'dimension': 128, 'count': len(rows), 'names': len(names),
                'cards_sha256': sha(cards_bytes), 'seed_sha256': SEED_SHA,
                'files': {k: {'bytes': len(v), 'sha256': sha(v)} for k, v in tables.items()}}
    dest.mkdir(parents=True, exist_ok=True)
    for name, data in tables.items():
        (dest / name).with_suffix('.part').write_bytes(data)
    for name in tables:
        (dest / name).with_suffix('.part').replace(dest / name)
    (dest / 'manifest.json').write_text(json.dumps(manifest, separators=(',', ':')) + '\n')
    return manifest


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--cache', type=Path, default=ROOT / '.cache/milo')
    parser.add_argument('--seed-cache', type=Path, default=ROOT / '.cache/ai-lookup')
    parser.add_argument('--workers', type=int, default=4)
    parser.add_argument('--cards', type=Path, default=ROOT / 'public/carddata/cards.json')
    parser.add_argument('--output', type=Path, default=ROOT / 'public/carddata/milo')
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    args.seed_cache.mkdir(parents=True, exist_ok=True)
    model = args.seed_cache / 'model.onnx'
    seed = args.seed_cache / SEED_FILE
    pinned(model, 'model.onnx', MODEL_SHA)
    pinned(seed, 'catalogs/' + SEED_FILE, SEED_SHA)
    cards_bytes = args.cards.read_bytes()
    rows = json.loads(cards_bytes)
    ids = [r[3] + ('_back' if r[4] else '') for r in rows]
    known = {}
    for path in [seed, args.cache / 'current.npz']:
        if not path.exists():
            continue
        with np.load(path, allow_pickle=False) as archive:
            if path != seed and (str(archive['model_sha256']) != MODEL_SHA or str(archive['preprocess']) != PREPROCESS):
                continue
            old_ids = archive['card_ids'].tolist()
            old_vectors = archive['embeddings']
            validate_vectors(old_ids, old_vectors)
            known.update(zip(old_ids, old_vectors))
    missing = [(key, row) for key, row in zip(ids, rows) if key not in known]
    print(f'{len(rows)} faces: reuse {len(rows) - len(missing)}, embed {len(missing)}', flush=True)
    if missing:
        import onnxruntime as ort
        options = ort.SessionOptions()
        options.intra_op_num_threads = options.inter_op_num_threads = 1
        session = ort.InferenceSession(str(model), options, providers=['CPUExecutionProvider'])
        lock, next_request = threading.Lock(), [0.0]

        def embed(item):
            key, row = item
            url = f'https://cards.scryfall.io/normal/{"back" if row[4] else "front"}/{row[3][0]}/{row[3][1]}/{row[3]}.jpg'
            for attempt in range(4):
                try:
                    with lock:
                        delay = max(0, next_request[0] - time.monotonic())
                        next_request[0] = max(time.monotonic(), next_request[0]) + .12
                    if delay:
                        time.sleep(delay)
                    response = requests.get(url, headers=HEADERS, timeout=30)
                    response.raise_for_status()
                    with Image.open(io.BytesIO(response.content)) as image:
                        vector = session.run(['embedding'], {'image': preprocess(image)})[0][0]
                    validate_vectors([key], vector[None])
                    return key, vector
                except Exception:
                    if attempt == 3:
                        raise
                    time.sleep(2 ** attempt)

        failures = []
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = {pool.submit(embed, item): item[0] for item in missing}
            for count, future in enumerate(as_completed(futures), 1):
                try:
                    key, vector = future.result()
                    known[key] = vector
                except Exception as error:
                    failures.append((futures[future], str(error)))
                if count % 100 == 0 or count == len(missing):
                    print(f'{count}/{len(missing)} additions, {len(failures)} failures', flush=True)
        # Keep successful new embeddings even when publication is refused.
        cached_ids = [key for key in ids if key in known]
        np.savez_compressed(args.cache / 'current.npz', card_ids=np.array(cached_ids),
                            embeddings=np.stack([known[key] for key in cached_ids]),
                            model_sha256=MODEL_SHA, preprocess=PREPROCESS)
        if failures:
            raise ValueError(f'Milo publication refused: {len(failures)} failed faces: {failures[:5]}')
    vectors = np.stack([known[key] for key in ids]).astype(np.float32)
    manifest = publish(rows, vectors, cards_bytes, args.output)
    cache_part = args.cache / 'current.part.npz'
    np.savez_compressed(cache_part, card_ids=np.array(ids), embeddings=vectors,
                        model_sha256=MODEL_SHA, preprocess=PREPROCESS)
    cache_part.replace(args.cache / 'current.npz')
    vendor = ROOT / 'public/vendor/vision/milo1'
    vendor.mkdir(parents=True, exist_ok=True)
    (vendor / 'model.onnx').write_bytes(model.read_bytes())
    print(json.dumps({'faces': manifest['count'], 'names': manifest['names'], 'cards_sha256': manifest['cards_sha256']}))


if __name__ == '__main__':
    main()

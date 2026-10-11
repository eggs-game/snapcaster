#!/usr/bin/env python3
"""Check catalog provenance, checksums, complete coverage and numeric tables."""
import argparse
import json
from pathlib import Path
import numpy as np
from build_milo_catalog import ROOT, MODEL_SHA, REVISION, PREPROCESS, sha


def verify(root):
    root = Path(root)
    directory = root / 'public/carddata/milo'
    manifest = json.loads((directory / 'manifest.json').read_text())
    cards = (root / 'public/carddata/cards.json').read_bytes()
    rows = json.loads(cards)
    assert manifest['cards_sha256'] == sha(cards), 'Milo rows belong to a different card index'
    assert manifest['revision'] == REVISION and manifest['model_sha256'] == MODEL_SHA
    assert manifest['preprocess'] == PREPROCESS and manifest['dimension'] == 128 and manifest['version'] == 1
    assert manifest['count'] == len(rows)
    for file, metadata in manifest['files'].items():
        data = (directory / file).read_bytes()
        assert len(data) == metadata['bytes'] and sha(data) == metadata['sha256'], 'Milo file corrupted'
    vectors = np.fromfile(directory / 'vectors.bin', np.int8).reshape(-1, 128)
    norms = np.fromfile(directory / 'norms.bin', '<f4')
    groups = np.fromfile(directory / 'names.bin', '<u4')
    assert len(vectors) == len(norms) == len(groups) == len(rows)
    assert np.isfinite(norms).all() and np.all(norms > 0)
    assert np.max(np.abs(norms - np.linalg.norm(vectors.astype(np.float32), axis=1))) < .001
    expected, names = [], {}
    for row in rows:
        if row[0] not in names:
            names[row[0]] = len(names)
        expected.append(names[row[0]])
    assert manifest['names'] == len(names) and np.array_equal(groups, expected), 'Name diversity map is misaligned'
    vendor = root / 'public/vendor/vision/milo1'
    assert sha((vendor / 'model.onnx').read_bytes()) == MODEL_SHA
    assert (vendor / 'AGPL-3.0.txt').is_file() and (vendor / 'SOURCE.txt').is_file()
    print(f'OK: complete Milo catalog: {len(rows)} faces, {len(names)} names, model/table/index checksums verified')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('root', nargs='?', default=ROOT)
    verify(parser.parse_args().root)

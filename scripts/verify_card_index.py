#!/usr/bin/env python3
"""Verify the shipped card rows, shard payloads and binary tables stay aligned."""
import argparse
import base64
import json
from pathlib import Path
from build_index import CARD_FIELDS, SHARD_FIELDS, normalize_name, shard_key


def verify(directory):
    directory = Path(directory)
    manifest = json.loads((directory/'manifest.json').read_text())
    cards = json.loads((directory/'cards.json').read_text())
    names = json.loads((directory/'names.json').read_text())
    assert manifest['version'] == 4
    assert manifest['cards_fields'] == CARD_FIELDS and manifest['shard_fields'] == SHARD_FIELDS
    assert manifest['count'] == len(cards) and manifest['names'] == len(names)
    assert len(names) == len(set(names)) and set(names) == {r[0] for r in cards}
    # Distinct printed names can normalize identically. Their tie order in a
    # sorted set depends on Python's hash seed and has no lookup semantics.
    normalized = [normalize_name(name) for name in names]
    assert normalized == sorted(normalized)
    keys = [(r[3], r[4]) for r in cards]
    assert len(keys) == len(set(keys)), 'Duplicate printing/face'
    tables = [(directory/name).read_bytes() for name in ['hashes.bin', 'colors.bin', 'arthashes.bin']]
    sizes = [64, 13, 32]
    for table, size in zip(tables, sizes):
        assert len(table) == len(cards)*size, 'Binary table has wrong length'
    positions = {key:i for i,key in enumerate(keys)}
    seen = set()
    for file in (directory/'shards').glob('*.json'):
        for row in json.loads(file.read_text()):
            assert len(row) == len(SHARD_FIELDS)
            assert shard_key(row[0]) == file.stem, 'Wrong name shard'
            key = (row[3], row[4]); assert key not in seen; seen.add(key)
            i = positions[key]; assert row[:5] == cards[i]
            assert all(isinstance(v, str) for v in row[8:])
            for encoded, table, size in zip(row[5:8], tables, sizes):
                assert base64.b64decode(encoded, validate=True) == table[i*size:(i+1)*size], 'Shard/binary mismatch'
    assert seen == set(keys), 'Missing shard rows'
    print(f"OK: {len(cards)} unique printing faces, {len(names)} names, all shard/binary rows aligned")


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('directory', nargs='?', default=str(Path(__file__).resolve().parent.parent/'public/carddata'))
    verify(parser.parse_args().directory)

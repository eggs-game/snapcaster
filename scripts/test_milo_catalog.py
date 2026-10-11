#!/usr/bin/env python3
"""Publication must refuse missing faces, corrupt vectors and duplicate IDs."""
import json
from pathlib import Path
import tempfile
import numpy as np
from build_milo_catalog import publish

rows = [['Card', 'set', '1', 'id1', 0], ['Card', 'set', '2', 'id2', 0], ['Other', 'set', '3', 'id3', 1]]
vectors = np.zeros((3, 128), np.float32)
vectors[:, 0] = 1
with tempfile.TemporaryDirectory() as temp:
    dest = Path(temp)
    data = json.dumps(rows).encode()
    manifest = publish(rows, vectors, data, dest)
    assert manifest['count'] == 3 and manifest['names'] == 2
    assert np.fromfile(dest / 'names.bin', '<u4').tolist() == [0, 0, 1]
    before = {p.name: p.read_bytes() for p in dest.iterdir()}
    corrupt = vectors.copy()
    corrupt[0, 0] = float('nan')
    for bad_rows, bad_vectors in [(rows, vectors[:2]), (rows, corrupt), (rows, vectors * 0), (rows + [rows[0]], np.concatenate([vectors, vectors[:1]]))]:
        try:
            publish(bad_rows, bad_vectors, data, dest)
            raise AssertionError('Invalid catalog was published')
        except ValueError:
            pass
        assert {p.name: p.read_bytes() for p in dest.iterdir()} == before, 'Failed update changed the last usable catalog'
print('Milo publication refuses incomplete/corrupt catalogs and preserves the last valid output')

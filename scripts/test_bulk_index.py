#!/usr/bin/env python3
"""Protect the Scryfall format change and prevent incomplete index publication."""
import contextlib
import gzip
import io
import json
import os
import tempfile
from unittest.mock import patch

from build_index import iter_bulk_cards, main, write_index
from test_index_metadata import visual_row
from verify_card_index import verify


class Response:
    def __init__(self, data=None, body=b'', interrupted=False):
        self.data, self.body, self.interrupted = data, body, interrupted

    def raise_for_status(self):
        pass

    def json(self):
        return self.data

    def iter_content(self, size):
        yield self.body
        if self.interrupted:
            raise OSError('Interrupted bulk download')

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass


def test_bulk_formats():
    cards = [{'id': 'first'}, {'id': 'second'}]
    for modern, compressed in [(True, True), (True, False), (False, False)]:
        entry = {'type': 'default_cards', 'updated_at': '2026-10-10T21:06:04+00:00'}
        entry['jsonl_download_uri' if modern else 'download_uri'] = 'https://example.test/cards'
        # The new API has compressed_size and no size/download_uri. Neither
        # size field is required for importing the records.
        if modern:
            entry['compressed_size'] = 100
        body = ('\n'.join(json.dumps(c) for c in cards)+'\n\n').encode() if modern else json.dumps(cards).encode()
        if compressed:
            body = gzip.compress(body)
        with tempfile.TemporaryDirectory() as cache:
            info = {}
            with patch('build_index.requests.get', side_effect=[Response({'data': [entry]}), Response(body=body)]) as get:
                assert list(iter_bulk_cards('default_cards', cache, info)) == cards
                assert get.call_count == 2
            assert info['updated_at'] == entry['updated_at']
            assert info['format'] == ('jsonl' if modern else 'json')
            with patch('build_index.requests.get', return_value=Response({'data': [entry]})) as get:
                assert list(iter_bulk_cards('default_cards', cache)) == cards
                assert get.call_count == 1, 'Completed immutable snapshot should be reused'
            # A second same-day snapshot must not accidentally reuse the first.
            entry = {**entry, 'updated_at': '2026-10-10T22:00:00+00:00'}
            with patch('build_index.requests.get', side_effect=[Response({'data': [entry]}), Response(body=body)]) as get:
                assert list(iter_bulk_cards('default_cards', cache)) == cards
                assert get.call_count == 2


def test_interrupted_download():
    entry = {'type': 'default_cards', 'updated_at': '2026-10-10T21:00:00Z', 'jsonl_download_uri': 'https://example.test/cards'}
    with tempfile.TemporaryDirectory() as cache:
        with patch('build_index.requests.get', side_effect=[Response({'data': [entry]}), Response(body=b'partial', interrupted=True)]):
            try:
                list(iter_bulk_cards('default_cards', cache))
                raise AssertionError('Interrupted download was accepted')
            except OSError:
                pass
        assert all(name.endswith('.part') for name in os.listdir(cache))


def test_failed_face_preserves_index():
    card = {'id': 'new-card', 'name': 'New Card', 'games': ['paper'], 'image_uris': {'small': 'https://example.test/card.jpg'}}
    with tempfile.TemporaryDirectory() as out:
        sentinel = os.path.join(out, 'cards.json')
        with open(sentinel, 'w') as f:
            f.write('old-index')
        with patch('sys.argv', ['build_index.py', '--out', out]), patch('build_index.iter_bulk_cards', return_value=iter([card])), patch('build_index.fetch_and_hash', return_value=RuntimeError('missing image')), patch('build_index.write_index') as publish, contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            try:
                main()
                raise AssertionError('Failed face did not fail the build')
            except SystemExit as e:
                assert 'Refusing to replace' in str(e)
            publish.assert_not_called()
        with open(sentinel) as f:
            assert f.read() == 'old-index'


def test_manifest_provenance():
    with tempfile.TemporaryDirectory() as out:
        provenance = {'provider': 'scryfall', 'bulk_type': 'default_cards', 'updated_at': '2026-10-10T21:06:04Z', 'format': 'jsonl'}
        write_index([visual_row()+['', '', '']], out, provenance)
        with open(os.path.join(out, 'manifest.json')) as f:
            assert json.load(f)['source'] == provenance


def test_corrupt_table_is_rejected():
    with tempfile.TemporaryDirectory() as out:
        write_index([visual_row()+['', '', '']], out)
        with contextlib.redirect_stdout(io.StringIO()):
            verify(out)
        filename = os.path.join(out, 'hashes.bin')
        with open(filename, 'r+b') as f:
            f.write(b'\x01')
        try:
            verify(out)
            raise AssertionError('Corrupted binary table was accepted')
        except AssertionError as e:
            assert 'Shard/binary mismatch' in str(e)


if __name__ == '__main__':
    test_bulk_formats()
    test_interrupted_download()
    test_failed_face_preserves_index()
    test_manifest_provenance()
    test_corrupt_table_is_rejected()
    print('OK: compressed JSONL, legacy JSON, immutable snapshot cache, complete publication, provenance and corruption rejection')

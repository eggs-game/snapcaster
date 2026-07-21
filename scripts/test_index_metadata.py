#!/usr/bin/env python3
"""Verify the v4 metadata schema without downloading Scryfall artwork."""

import base64
import json
import os
import tempfile

from build_index import face_metadata, load_existing, write_index


def visual_row():
    return [
        "Example Elemental", "tst", "1", "example-id", 0,
        base64.b64encode(bytes(64)).decode("ascii"),
        base64.b64encode(bytes(13)).decode("ascii"),
        base64.b64encode(bytes(32)).decode("ascii"),
    ]


def test_face_metadata():
    single = {
        "image_uris": {"small": "https://example.test/card.jpg"},
        "mana_cost": "{2}{R}{U}",
        "type_line": "Creature — Elemental",
        "oracle_text": "Trample\nWhen this creature enters...",
    }
    assert face_metadata(single, 0) == (
        "{2}{R}{U}",
        "Creature — Elemental",
        "Trample\nWhen this creature enters...",
    )

    double_faced = {
        "card_faces": [
            {
                "mana_cost": "{1}{W}",
                "type_line": "Creature — Human",
                "oracle_text": "Vigilance",
            },
            {
                "type_line": "Land",
                "oracle_text": "{T}: Add {W}.",
            },
        ],
    }
    assert face_metadata(double_faced, 0) == (
        "{1}{W}", "Creature — Human", "Vigilance",
    )
    assert face_metadata(double_faced, 1) == (
        "", "Land", "{T}: Add {W}.",
    )

    shared_image = {
        "image_uris": {"small": "https://example.test/split.jpg"},
        "card_faces": [
            {
                "mana_cost": "{1}{R}",
                "type_line": "Instant",
                "oracle_text": "Create a token.",
            },
            {
                "mana_cost": "{1}{U}",
                "type_line": "Instant",
                "oracle_text": "Draw a card.",
            },
        ],
    }
    assert face_metadata(shared_image, 0) == (
        "{1}{R} // {1}{U}",
        "Instant // Instant",
        "Create a token.\n//\nDraw a card.",
    )


def test_v3_reuse_and_v4_output():
    with tempfile.TemporaryDirectory() as out_dir:
        shard_dir = os.path.join(out_dir, "shards")
        os.makedirs(shard_dir)
        visual = visual_row()
        with open(os.path.join(shard_dir, "00.json"), "w", encoding="utf-8") as output:
            json.dump([visual], output)

        assert load_existing(out_dir)[("example-id", 0)] == visual

        metadata = ["{2}{R}{U}", "Creature — Elemental", "Trample"]
        write_index([visual + metadata], out_dir)

        with open(os.path.join(out_dir, "manifest.json"), encoding="utf-8") as source:
            manifest = json.load(source)
        assert manifest["version"] == 4
        assert manifest["cards_fields"] == [
            "name", "set", "collector_number", "scryfall_id", "face",
        ]
        assert manifest["shard_fields"][-3:] == [
            "mana_cost", "type_line", "oracle_text",
        ]

        shard_name = os.listdir(os.path.join(out_dir, "shards"))[0]
        with open(os.path.join(out_dir, "shards", shard_name), encoding="utf-8") as source:
            assert json.load(source)[0][8:] == metadata

        # Full Oracle text must not inflate the worker's eager global table.
        with open(os.path.join(out_dir, "cards.json"), encoding="utf-8") as source:
            assert json.load(source) == [visual[:5]]
        assert os.path.getsize(os.path.join(out_dir, "hashes.bin")) == 64
        assert os.path.getsize(os.path.join(out_dir, "colors.bin")) == 13
        assert os.path.getsize(os.path.join(out_dir, "arthashes.bin")) == 32


if __name__ == "__main__":
    test_face_metadata()
    test_v3_reuse_and_v4_output()
    print("OK: v4 card metadata and v3 visual reuse")

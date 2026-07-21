#!/usr/bin/env python3
"""Measure how useful v4 card metadata could be for recognition.

This is deliberately an offline analysis, not a recognition heuristic. Run it
after a v4 index build:

    python scripts/analyze_metadata.py public/carddata

It reports the expected candidate-bucket size for exact mana cost, coarse card
type, both together, and the rarest meaningful Oracle-text word. Those numbers
let us choose which evidence is worth extracting from a webcam crop before we
put more OCR or image processing on the live path.
"""

import argparse
from collections import Counter
import json
import os
import re
import statistics


TYPE_WORDS = (
    "land", "creature", "artifact", "enchantment", "planeswalker",
    "battle", "instant", "sorcery", "kindred",
)

# Frequent connective/reminder words carry almost no identifying information.
ORACLE_STOP_WORDS = {
    "about", "after", "against", "also", "another", "before", "being",
    "card", "cards", "choose", "chosen", "control", "controls", "could",
    "counter", "creature", "creatures", "damage", "does", "each", "equal",
    "first", "from", "gets", "have", "instead", "less", "more", "other",
    "owner", "player", "players", "put", "spell", "target", "than", "that",
    "their", "there", "these", "they", "this", "those", "until", "when",
    "whenever", "where", "with", "would", "your",
}


def oracle_words(text):
    return {
        word for word in re.findall(r"[a-z]{4,}", (text or "").lower())
        if word not in ORACLE_STOP_WORDS
    }


def coarse_type(type_line):
    value = (type_line or "").lower()
    found = [word for word in TYPE_WORDS if re.search(rf"\b{word}\b", value)]
    return "+".join(found) or "none"


def percentile(values, fraction):
    if not values:
        return 0
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int((len(ordered) - 1) * fraction))]


def bucket_summary(signatures):
    counts = Counter(signatures)
    sizes = [counts[value] for value in signatures]
    return {
        "buckets": len(counts),
        "unique_rate": round(sum(size == 1 for size in sizes) / len(sizes), 4),
        "expected_candidates": round(sum(sizes) / len(sizes), 2),
        "median_candidates": statistics.median(sizes),
        "p90_candidates": percentile(sizes, 0.9),
    }


def load_profiles(carddata_dir):
    manifest_path = os.path.join(carddata_dir, "manifest.json")
    with open(manifest_path, encoding="utf-8") as source:
        manifest = json.load(source)
    if manifest.get("version", 0) < 4:
        raise SystemExit("Metadata analysis requires a v4 card index.")

    fields = manifest.get("shard_fields") or []
    required = ("name", "face", "mana_cost", "type_line", "oracle_text")
    missing = [field for field in required if field not in fields]
    if missing:
        raise SystemExit(f"Manifest is missing shard fields: {', '.join(missing)}")
    positions = {field: fields.index(field) for field in required}

    # Collapse identical printings. Recognition still ranks every artwork, but
    # metadata describes the underlying card/face and is repeated on reprints.
    profiles = set()
    shard_dir = os.path.join(carddata_dir, "shards")
    for filename in sorted(os.listdir(shard_dir)):
        if not filename.endswith(".json"):
            continue
        with open(os.path.join(shard_dir, filename), encoding="utf-8") as source:
            for row in json.load(source):
                profiles.add(tuple(row[positions[field]] for field in required))
    return manifest, sorted(profiles)


def analyze(profiles):
    mana = [profile[2] or "none" for profile in profiles]
    exact_types = [profile[3].lower() or "none" for profile in profiles]
    types = [coarse_type(profile[3]) for profile in profiles]
    combined = list(zip(mana, types))
    exact_combined = list(zip(mana, exact_types))

    word_sets = [oracle_words(profile[4]) for profile in profiles]
    document_frequency = Counter(word for words in word_sets for word in words)
    rarest_sizes = [
        min((document_frequency[word] for word in words), default=len(profiles))
        for words in word_sets
    ]
    conditioned_frequency = Counter(
        (mana_value, type_value, word)
        for mana_value, type_value, words in zip(mana, exact_types, word_sets)
        for word in words
    )
    conditioned_sizes = [
        min(
            (conditioned_frequency[(mana_value, type_value, word)] for word in words),
            default=len(profiles),
        )
        for mana_value, type_value, words in zip(mana, exact_types, word_sets)
    ]
    useful_rarest = [size for size, words in zip(rarest_sizes, word_sets) if words]
    useful_conditioned = [size for size, words in zip(conditioned_sizes, word_sets) if words]
    return {
        "card_faces": len(profiles),
        "mana_cost": bucket_summary(mana),
        "coarse_type": bucket_summary(types),
        "mana_plus_type": bucket_summary(combined),
        "exact_type_line": bucket_summary(exact_types),
        "mana_plus_exact_type": bucket_summary(exact_combined),
        "rarest_oracle_word": {
            "faces_with_useful_word": sum(bool(words) for words in word_sets),
            "unique_rate": round(sum(size == 1 for size in rarest_sizes) / len(profiles), 4),
            "median_candidates": statistics.median(rarest_sizes),
            "p90_candidates": percentile(rarest_sizes, 0.9),
            "useful_word_unique_rate": round(
                sum(size == 1 for size in useful_rarest) / max(1, len(useful_rarest)), 4,
            ),
            "useful_word_p90_candidates": percentile(useful_rarest, 0.9),
        },
        "mana_type_plus_rarest_word": {
            "faces_with_useful_word": sum(bool(words) for words in word_sets),
            "unique_rate": round(sum(size == 1 for size in conditioned_sizes) / len(profiles), 4),
            "median_candidates": statistics.median(conditioned_sizes),
            "p90_candidates": percentile(conditioned_sizes, 0.9),
            "useful_word_unique_rate": round(
                sum(size == 1 for size in useful_conditioned) / max(1, len(useful_conditioned)), 4,
            ),
            "useful_word_p90_candidates": percentile(useful_conditioned, 0.9),
        },
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("carddata", nargs="?", default=os.path.join("public", "carddata"))
    args = parser.parse_args()
    manifest, profiles = load_profiles(args.carddata)
    print(json.dumps({
        "index_version": manifest["version"],
        **analyze(profiles),
    }, indent=2))


if __name__ == "__main__":
    main()

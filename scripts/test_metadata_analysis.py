#!/usr/bin/env python3
"""Small deterministic checks for metadata discriminativeness analysis."""

from analyze_metadata import analyze, coarse_type, oracle_words


def main():
    assert coarse_type("Legendary Artifact Creature — Golem") == "creature+artifact"
    assert coarse_type("Kindred Sorcery — Goblin") == "sorcery+kindred"
    assert oracle_words("Trample\nWhen this creature enters, investigate twice.") == {
        "trample", "enters", "investigate", "twice",
    }

    profiles = [
        ("Alpha", 0, "{2}{R}{U}", "Creature — Elemental", "Trample. Investigate."),
        ("Beta", 0, "{2}{R}{U}", "Artifact", "Flying. Investigate."),
        ("Gamma", 0, "{G}", "Sorcery", "Create a uniqueleaf token."),
    ]
    result = analyze(profiles)
    assert result["card_faces"] == 3
    assert result["mana_cost"]["buckets"] == 2
    assert result["mana_plus_type"]["buckets"] == 3
    assert result["rarest_oracle_word"]["unique_rate"] == 1
    assert result["mana_type_plus_rarest_word"]["unique_rate"] == 1
    print("OK: metadata discriminativeness analysis")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Fail if the hashing code in recognizer.js drifts from hash.js.

The recogniser runs as a classic Web Worker (it needs importScripts for
OpenCV), so it carries its own copy of the hashing functions rather than
importing hash.js. That copy is what production actually uses — and it is NOT
what scripts/test_hash_compat.py checks, since that test imports hash.js.

So the bit-compatibility guarantee has a hole: hash.js could stay in perfect
agreement with build_index.py while recognizer.js quietly drifts, and every
scan would degrade without a single error being raised.

Until the duplication is removed, this asserts the two copies stay identical
so the existing test transitively covers both.
"""

import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HASH_JS = os.path.join(ROOT, "src", "recognition", "hash.js")
WORKER_JS = os.path.join(ROOT, "src", "recognition", "recognizer.js")

SHARED = [
    "toGray", "areaResize", "computeHashes",
    "contrastStretch", "rotate90", "queryVariants", "hammingSearch",
]


def extract(path, fn):
    """Return the source of `fn`, brace-matched from its header."""
    with open(path, encoding="utf-8") as f:
        src = f.read()
    m = re.search(r"(?:export )?function " + fn + r"\s*\(", src)
    if not m:
        return None
    start = src.index("{", m.end() - 1)
    depth = 0
    for i in range(start, len(src)):
        if src[i] == "{":
            depth += 1
        elif src[i] == "}":
            depth -= 1
            if depth == 0:
                return src[m.start():i + 1]
    return None


def normalise(text):
    """Ignore the export keyword, comments and all whitespace/brace style.

    Strips trailing `//` comments as well as whole-line ones. These are pure
    numeric routines with no string literals, so there is no `//` to protect.
    """
    text = re.sub(r"//.*$", "", text, flags=re.M)
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    text = text.replace("export ", "")
    return re.sub(r"\s+", "", text)


def main():
    failures = []
    for fn in SHARED:
        a = extract(HASH_JS, fn)
        b = extract(WORKER_JS, fn)
        if a is None:
            failures.append(f"{fn}: not found in hash.js")
        elif b is None:
            failures.append(f"{fn}: not found in recognizer.js")
        elif normalise(a) != normalise(b):
            failures.append(f"{fn}: DRIFTED between hash.js and recognizer.js")

    if failures:
        print("Hash duplication check FAILED:\n")
        for f in failures:
            print(f"  - {f}")
        print(
            "\nrecognizer.js carries its own copy of these functions because a\n"
            "classic worker cannot import them. test_hash_compat.py only checks\n"
            "hash.js, so drift here degrades every scan silently.\n"
            "Bring the copies back into agreement, or remove the duplication."
        )
        return 1

    print(f"OK: {len(SHARED)} hashing functions identical in hash.js and recognizer.js")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Verify JS hash implementation matches the Python index builder.

Generates random test images, hashes them in Python (index side), exports
them as JSON, then runs node on src/recognition/hash.js (query side) and
compares Hamming distances. Distances must be near-zero for identical
images and large between different images.
"""
import json, os, subprocess, sys
import numpy as np
import cv2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_index import compute_hashes, CARD_W, CARD_H

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
rng = np.random.RandomState(42)

cases = []
for i in range(6):
    # structured random image (blocks + gradients, more card-like than noise)
    img = np.zeros((CARD_H, CARD_W, 3), np.uint8)
    img[:] = rng.randint(40, 220, 3)
    for _ in range(15):
        x, y = rng.randint(0, CARD_W - 20), rng.randint(0, CARD_H - 20)
        w, h = rng.randint(15, 120), rng.randint(15, 120)
        cv2.rectangle(img, (x, y), (min(CARD_W - 1, x + w), min(CARD_H - 1, y + h)),
                      tuple(int(c) for c in rng.randint(0, 255, 3)), -1)
    py_hash = compute_hashes(img)
    rgba = np.dstack([cv2.cvtColor(img, cv2.COLOR_BGR2RGB), np.full((CARD_H, CARD_W), 255, np.uint8)])
    cases.append({"rgba": rgba.flatten().tolist(), "w": CARD_W, "h": CARD_H,
                  "py_hash": py_hash.tolist()})

with open("/tmp/hash_cases.json", "w") as f:
    json.dump(cases, f)

node_script = r"""
import { readFileSync } from "fs";
import { toGray, computeHashes } from "%s/src/recognition/hash.js";

const cases = JSON.parse(readFileSync("/tmp/hash_cases.json"));
const POP = new Uint8Array(256);
for (let i = 0; i < 256; i++) POP[i] = (i & 1) + POP[i >> 1];
const ham = (a, b) => a.reduce((s, v, i) => s + POP[v ^ b[i]], 0);

const jsHashes = cases.map((c) => {
  const imageData = { data: Uint8ClampedArray.from(c.rgba), width: c.w, height: c.h };
  return computeHashes(toGray(imageData));
});
let maxSelf = 0;
cases.forEach((c, i) => {
  const d = ham(jsHashes[i], Uint8Array.from(c.py_hash));
  console.log(`case ${i}: py-vs-js distance = ${d} / 512`);
  maxSelf = Math.max(maxSelf, d);
});
let minCross = 512;
for (let i = 0; i < cases.length; i++)
  for (let j = 0; j < cases.length; j++)
    if (i !== j) minCross = Math.min(minCross, ham(jsHashes[i], Uint8Array.from(cases[j].py_hash)));
console.log(`max self-distance: ${maxSelf}, min cross-distance: ${minCross}`);
if (maxSelf < 40 && minCross > 120) console.log("COMPAT OK");
else { console.log("COMPAT FAIL"); process.exit(1); }
""" % ROOT

with open("/tmp/compat_test.mjs", "w") as f:
    f.write(node_script)
r = subprocess.run(["node", "/tmp/compat_test.mjs"], capture_output=True, text=True)
print(r.stdout, r.stderr)
sys.exit(r.returncode)

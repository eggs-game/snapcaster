These final-source hint controls passed against BUILD35's 71 production source
files and the pinned 113,269-face catalog. [The combined check](pair.json) binds
the raw reports and current source/catalog fingerprints; [the manifest](manifest.json)
provides relative paths and SHA256 for all archived evidence.

Twenty predeclared nearby stale-card replacements use a real prior successful
lookup as the stale hint. BUILD35 resolves 19/20 with no hints and 19/20 with that
stale hint, with all 38 published targets correct. Anger is newly resolved;
High Market remains unresolved. Every BUILD34 correct target keeps its raw
name, printing, face, pathway, confidence, click ownership and regional source
proof. All 60 paired native JPEG byte hashes, crop geometries and chosen samples
are exact; 120 original control/candidate JPEG files are preserved here.

The four previously verified fast-hint controls hit 4/4 on both builds and keep
the same printing/face. Current repeated display is 692 ms median, with all four
below one second. Voja remains a separately declared same-card stored-hint miss:
its complete learned fallback stays correct with the same printing/face and
`hintHit:false`, displaying the repeated result in 892 ms. These small targeted
observations do not establish a new full 200 speed qualification.

The compiled Game pointer handler, three 120 ms native video samples, sharpness
selection, unchanged production JPEG quality 0.9 encoder, loopback WebRTC data channel,
matcher and decoded/full-opacity sidebar are real. Camera pixels and signaling
are test adapters; models/index are warmed. BUILD35's recorded Milo backend is
WebGPU. OpenCV's reported heap stays 134 decimal MB (approximately 128 MiB); this
does not include browser/GPU/model memory. No physical camera, public room,
STUN/TURN, cross-network delivery or production/account writes are exercised.

Each valid/fallback browser arm records its sibling raw native report SHA and
asserts that the actual compiled runtime BUILD agrees. The control's 70-file and
candidate's 71-file fingerprints remain separate. Raw reports retain historical
local-cache execution paths; use the portable manifest links here.

The offline gate can be reproduced without a camera or browser from the project
root, while source/catalog remain at this release:

```sh
node scripts/check_native_card_hint_pair.mjs \
  snaptest/runs/2026-10-12-milo-click-release/game-controls/hints-final/control34/report.json \
  snaptest/runs/2026-10-12-milo-click-release/game-controls/hints-final/candidate35/report.json \
  --validHints=snaptest/runs/2026-10-12-milo-click-release/game-controls/hints-final/valid4/report.json \
  --voja=snaptest/runs/2026-10-12-milo-click-release/game-controls/hints-final/voja-fallback/report.json \
  --output=snaptest/runs/2026-10-12-milo-click-release/game-controls/hints-final/pair.json
```

Browser reproduction uses `benchmark_native_card_hints.mjs` with the same lossless
scene fixtures and explicit `--allowSourceChange=1`, then
`test_native_valid_hints.mjs --indices=0,6,24,79` and the separate
`--indices=199 --allowHintMiss=1` Voja control. The fixture catalog/capture SHA
checks must pass before comparing results. Broad recognition timing jobs run
sequentially to avoid CPU interference.

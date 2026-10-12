# Native Game moving-frame and cancellation controls

[manifest.json](manifest.json) gives portable report paths and SHA256 for every
preserved raw JSON file. [Aggregate evidence](native-game-cancellation-v4/evidence.json)
records the separate test instrumentation hashes, runtime/backend, source and
catalog fingerprints. All 71 production source files matched the frozen final
candidate when this archive was created.

- [Clean nine-control run](native-game-cancellation-v4/report.json): real compiled
  Game clicks, production three samples 120 ms apart, sharpness selection, JPEG
  quality 0.9, native RTC and decoded card previews. It checks valid first-frame
  geometry followed by a sharper frame, first-card replacement, empty geometry,
  held detector replies, rapid clicks, stale UI/hints and queue cleanup.
- [Six exact moving pairs](native-game-cancellation-v4/moving-pair.json) against
  the [integrated baseline](native-game-moving-baseline/report.json) retain final
  JPEG SHA, geometry, chosen sample and every final match field. This baseline
  includes GPU, deferred recovery and the bitmap-dimensions fix, before early
  full recognition and comparison reuse. It is not a timing comparison against
  committed main.
- [Bounded positive](native-game-held-v4-bounded/report.json): the newest Drana
  lookup displays in 439 ms with an idle queue while the old public image GET
  remains held. The [no-cancellation negative](native-game-no-race-bounded-negative/report.json)
  fails the 2.5-second deadline while that GET is still held and the queue is
  active/waiting, before the normal 30-second timeout can free it.
- [Unsafe first-frame adoption](native-game-unsafe-first-adoption/report.json)
  deliberately keeps and adopts discarded pixels; the selected-card assertion
  rejects it. Negative reports intentionally have `ok: false`.

The invalid observer run resolved a job prematurely by reusing its protocol ID;
the observer now uses metadata `scanId`. A separate run passed the nine controls
but failed test route teardown. Both earlier runs remain excluded research in
the local cache and are not archived as positive evidence.

Chrome's GPU backend and models/index were warm. Reported OpenCV WASM memory is
134 rounded decimal MB, approximately 128 MiB; this excludes GPU/model memory and
total browser memory. Media are deterministic canvas tracks with loopback
signaling, without physical cameras, microphones, accounts, production writes,
NAT or TURN. These selected controls do not establish complete 200-card latency,
sensor autofocus behavior or first-visit download performance.

Reproduce the healthy controls from the repository with preserved scene fixtures:

```sh
node scripts/benchmark_native_card_delivery.mjs \
  --output=.cache/native-game-controls \
  --sceneFixtures=.cache/native-delivery-control/scenes \
  --controlsOnly=1 --repeat=0 --gameCancellationControls=1
```

Add `--gameControlsCases=held-only --latestDeadlineMs=2500` for the bounded
held-image/newest-lookup control. The tracked helper is
`scripts/native_game_cancellation_controls.mjs`. Cache paths inside raw reports
are execution provenance; portable archive links are in the manifest.

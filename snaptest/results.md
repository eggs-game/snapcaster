# SNAPTEST results history

Newest first. Run via `snapcaster.vercel.app/snaptest`.

> **Degrade v2 (2026-07-20):** manual camera tests failed on speed-17 while
> SNAPTEST stayed green — real players hold the card well above the click
> point and near frame edges, which v1 never simulated (cards were always
> centered ±40px). Degradations now include off-center and edge-cut
> placements. Results below this note used degrade v1 and are not directly
> comparable to v2 numbers.

## 2026-07-22 — `outline-offclick-1` — Full Test Plan — measurement follow-up

All three production suites were run sequentially in one browser session. Two
suites cleared the 90% goal; the 100-card tableau landed one card below it and
two below the prior run, exactly at the documented noise boundary. No
recognition change was attempted from that movement.

- **Tableau 10 scenes / EDH staples:** **89/100 (89.0%)**, 0 errors; target
  distance **-1 card**. Avg 2.3s, median 1.8s, p90 4.3s, max 5.7s. Stage means:
  prep 0.52s, rank 1.01s, ORB 0.67s, OCR 0.78s. Art-match 83/83 and
  visual-exact 4/4 were 100% precise. Layout: side-by-side 58/60 (96.7%),
  spaced 27/30 (90.0%), overlapping 4/10 (40.0%); clear cards were 86/91
  (94.5%). Rotation: upright 49/55 (89.1%), tapped 28/31 (90.3%), upside-down
  12/14 (85.7%). Nine misses were absent and two were rank 6+.
- **Random 200:** **190/200 (95.0%)**, 0 errors; target distance **+10 cards**.
  Avg 2.9s, median 3.1s, p90 4.0s, max 4.4s. Stage means: prep 0.49s, rank
  1.43s, ORB 0.75s, OCR 0.56s. Art-match 182/182 and visual-exact 3/3 were
  100% precise. Placement: mild-centered-a 56/56, above-click 48/48,
  mild-centered-b 48/48, top-edge-clipped **38/48 (79.2%)**. Every one of the
  ten misses was top-edge-clipped and the true card was absent. Rotation:
  upright 46/50, tilt 49/50, sideways 49/50, upside-down 46/50.
- **EDH staples 200:** **185/199 (93.0%)**, one Scryfall image-load error;
  target distance **+6 cards** among completed scans. Avg 2.9s, median 3.0s,
  p90 3.9s; one 23.3s completed outlier. Stage means: prep 0.50s, rank 1.44s,
  ORB 0.78s, OCR 0.52s. Art-match 182/182 and visual-exact 1/1 were 100%
  precise. Placement: mild-centered-a 56/56, above-click 48/48,
  mild-centered-b 47/47, top-edge-clipped **34/48 (70.8%)**. All 14 misses
  were top-edge-clipped and absent. Rotation: upright 44/49, tilt 49/50,
  sideways 49/50, upside-down 43/50. Card/token/basic accuracy was
  141/151, 39/42 and 5/6 respectively.

Resource diagnostics reject a time-degradation explanation. WASM heap was
flat at **134MB start-to-end in all three suites**; peak JS heap was 43MB,
42MB and 27MB. First/second-half accuracy was 98%/80% (tableau), 98%/92%
(Random) and 97%/89% (EDH). In the single-card suites the losses recur at the
deterministic top-edge blocks, while every non-edge placement was perfect.
Tableau's late loss is confounded with its deliberately overlapping scene and
occurred with a flat heap.

Compared with the 2026-07-21 run on the same build, tableau moved 91% -> 89%
(inside 100-card noise), Random moved 92% -> 95% with top-edge 68.8% -> 79.2%
(fresh-card sampling, not a code effect), and EDH stayed 93% with top-edge
exactly unchanged at 70.8%. Median/p90 improved from 2.3s/4.6s to 1.8s/4.3s,
3.6s/7.0s to 3.1s/4.0s, and 3.3s/4.3s to 3.0s/3.9s respectively.

**Today's falsifiable measurement hypothesis:** SNAPTEST already captures
metadata observations but drops them from its export, so completed misses
cannot satisfy the required metadata analysis without being rerun. Code
inspection confirmed the omission. The harness-only fix centralizes the Copy
payload, adds the captured metadata fields, and exposes the identical payload
as `window.__SNAPTEST_LAST_RESULT` when clipboard access is unavailable. It
does not alter recognition or the BUILD marker. Production build and hash-copy
checks pass; full hash compatibility could not start locally because the
Python environment lacks `cv2`, so CI remains the authoritative check.

No recognition experiment was shipped. The single best next experiment is a
deterministic Fixed top-edge 64 A/B that clusters off-click contours before
the spatial-rival guard: test whether inner-frame/background contours from the
same physical card are being mistaken for a competing card, disabling the
bounded rescue. Require gains across all four rotations and no regression on
Fixed 200 or overlapping tableaux.

## 2026-07-21 — `outline-offclick-1` — Full Test Plan — READY

The first degrade-v2 Full Test Plan exposed a deterministic cliff at index 48:
top-edge clipping moved the click away from the real card, and the contour
stage discarded every outline that did not contain it. A bounded off-click
outline quota restores those candidates. A spatial-rival guard disables the
quota in crowded scenes so a neighbouring card cannot win by a perfect art
match.

- **Tableau 10 scenes / EDH staples:** **91/100 (91.0%)**, 0 errors; avg 2.9s,
  median 2.3s, p90 4.6s. Art-match 84/84 and visual-exact 6/6 were 100%
  precise. The remaining nine misses were eight absent and one rank 6+.
- **Random 200:** **184/200 (92.0%)**, 0 errors; avg 4.0s, median 3.6s,
  p90 7.0s. Art-match was 182/182 precise. Placement accuracy was 98.2%,
  100%, 100% and 68.8% for the four blocks.
- **EDH staples 200:** **186/200 (93.0%)**, 0 errors; avg 3.2s, median 3.3s,
  p90 4.3s. Art-match was 181/181 precise. The three non-edge placement
  blocks were 100%; top-edge-clipped was 34/48 (70.8%).
- **Fixed 200 regression control:** **94.0%** with the first three placement
  blocks at 100% and top-edge-clipped at 74.5%.
- A new **Fixed top-edge 64** mode makes this failure class directly and
  deterministically testable. The original recogniser scored **8/64 (12.5%)**;
  the bounded off-click candidate experiment scored **47/64 (73.4%)**.

An unconditional off-click quota was rejected after it produced perfect art
matches on neighbouring cards in overlapping tableaux. Edge-specific crop
families and a wider escalation threshold were also tested and discarded: both
left the targeted result at 12.5%. The accepted change clears the 90% goal on
all three Full Test Plan suites without sacrificing accepted-match precision.
The remaining route toward 95% is now explicit: improve top-edge recall while
keeping the crowded-scene guard, then isolate overlapping tableau contours.

## 2026-07-21 — `art-rescue-2` — Full Test Plan baseline

The first complete manual Full Test Plan established the daily three-suite
baseline and reproduced the real framing gap that degrade v2 was built to show.

- **Tableau 10 scenes / EDH staples:** 91/100 (91.0%), 0 errors; avg 3.3s,
  median 3.0s, p90 5.2s. Clear and spaced/side-by-side cards were 97%; the six
  overlapped cards were 33%. Art-match and visual-exact were both 100% precise.
- **Random 200:** 152/199 (76.4%), 1 image-load error; avg 3.2s, median 3.4s,
  p90 4.3s. First half 83.8%, second half 69.0%.
- **EDH staples 200:** 155/199 (77.9%), 1 image-load error; avg 3.0s, median
  3.2s, p90 4.3s. First half 83.8%, second half 72.0%.

Both independent 200-card runs started near 100%, then fell sharply at card 48.
That boundary is deterministic benchmark behavior, not session degradation:
degrade v2 changes placement in 16-card blocks, and indices 48–63 are the first
block deliberately clipped against the top edge. A 63-card diagnostic rerun
with staged reference requests and a 48-entry cache reproduced the same fall;
all 15 misses fetched 36/36 references successfully and every accepted art
match remained correct. The speculative request/cache changes were discarded.

All 91 recognition misses in the complete 200-card runs had the true card
absent from the shortlist. The next accuracy work should therefore target
top-edge/off-center crop recall, then verify every rotation and the Fixed 200
control. Tableau's remaining gap is separately concentrated in overlapping
cards. Do not tune ORB thresholds or metadata gates from these misses—the true
printing never reached either verifier.

## 2026-07-21 — `art-rescue-2` — bounded Arcane-medium A/B — READY

- Current `main` reached **9/20 (45%)** on the fixed Arcane-medium prefix.
  The integrated shifted-art rescue reached **18/22 (81.8%)**, with every
  success a 100%-precise `art-match` and no errors.
- Integrated timing: avg 5.6s / median 4.6s / p90 10.0s, versus main's
  avg 8.0s / median 8.3s / p90 14.7s on its 20-card run. More decisive art
  exits outweighed the bounded extra search work.
- A Fixed-set control found three absent sideways misses in 35 integrated
  cards. Production reproduced the same three true-card failures in its first
  40, so they are baseline crop failures rather than regressions from this
  change.
- The Arcane branch's rules-box-as-title OCR was deliberately excluded: it
  produced none of the wins and weakened the OCR safety boundary. Existing v4
  rules metadata remains positive-only supporting evidence.

## 2026-07-20 — `speed-17` — Fixed 200 — **100%** (200/200, 0 errors) — MERGED

- **First perfect run**, and 3x faster than the pre-speed baseline:
  avg 1.82s / median 1.85s (was 99.0% at 5.4s avg on artfix-13b).
- Every rotation and every occlusion class at 100%. Peak memory 33MB.
- Stage avg: prep 0.35s, rank 0.9s, orb 0.4s; ocr 3.1s but only on the few
  cards that still need it (visual-exact + art-decisive skip it otherwise).
- Gate passed → Speed-Update branch merged to main.

## 2026-07-20 — `speed-17` — Random 200 — **99.5%** (199/200, 0 errors)

- Avg 2.27s / median 1.97s. One visual miss on a brutal degradation
  (White Ward, fingers+dice). Wider recall pool + <13-char OCR corroboration
  fixed both failure patterns from speed-16's random run.

## 2026-07-20 — `speed-16` (Speed-Update branch) — Fixed 200 — **99.0%** (198/200, 0 errors)

- Avg 5.6s / median 3.7s. Stage avg: prep 0.7s, rank 1.8s, orb 0.7s, ocr 6.9s
  (OCR-path cards only).
- Merge gate vs artfix-13b's 99.0%: PASSED, but as a 2-for-2 swap — the two old
  OCR false positives are fixed, while two heavily-occluded cards (Bala Ged
  Thief tilt+fingers-dice, Dust Stalker sideways+fingers) fell out of the
  seed-shortlist's contention pool. Addressed in speed-17 (pool 400→1000).

## 2026-07-20 — `speed-16` (Speed-Update branch) — Random 200 — **97.5%** (195/200, 0 errors)

- Avg 3.9s / median 4.1s — down from 5.4s+; the timeout error class (20/200 on
  the previous run) is entirely gone (lazy title strips).
- Stage avg: prep 0.4s, rank 0.8s, orb 0.6s, ocr 3.6s (OCR-path cards only).
- 5 misses: 2 were mid-length OCR false positives ("Experience", "Apes of
  Rath") — corroboration guard widened to <13 chars in speed-17; 3 were visual
  misses on hard degradations.

## 2026-07-19 — `ocr-corroborate-15` — Random 200 — **100%** (180/180, 20 errored)

- Avg 14.1s / median 8.4s (in-run degradation; pre lazy-strips). All 20 errors
  were 30s recognition timeouts — the hardest cards never got answers, so the
  100% excludes them.

## 2026-07-19 — `artfix-13b` — 200 cards — **99.0%** (195/197, 3 errored)

- Avg 5.4s / median 5.8s per scan (on a normal machine).
- By rotation: upright 97.9%, tilt 100%, sideways 100%, upside-down 98.0%.
- By occlusion: none 100%, fingers 98.0%, dice 97.9%, fingers+dice 100%.
- **Both misses were short-name OCR false positives** (OCR misread a title and
  matched a 4-letter card name, which was accepted as decisive over the visual
  match):
  - Children of Korlis → "Wall" (upside-down, dice) via ocr-title
  - Urza's Ruinous Blast → "Rats" (upright, fingers) via ocr-title
- Takeaway: rotation and occlusion are essentially solved; the remaining failure
  mode is OCR producing a garbage read that matches a short/common card name.

## 2026-07-21 — `tableau-20` — Tableau 10 scenes (100 cards) — **90.0%**

First benchmark that models a real table: 10 cards per 1920x1080 landscape
frame (4 cols x 3 rows), 90% of cards non-overlapping, ~5% clipped by the frame,
25% tapped, every 4th scene inverted, dim/glare-lit, clicked at a random point
on visible artwork, cropped with the production capture geometry.

- Avg 4.4s / median 2.5s / p90 12.3s / max 15.8s. No errors.
- By rotation: upright 85.5%, tapped **93.5%**, upside-down **100%**.
- By layout: side-by-side 98.3%, spaced 96.7%, overlapping **20.0%**.
- By coverage: 0% (clear) 97.8%; any overlap at all 11.1% (1/9).
- By pathway: visual-exact 49/49, art-match 38/38 — **both 100%**; the
  remaining 13 fell through to plain visual ranking at 23%.
- All 10 misses have the true card ABSENT from the match list (never rank 2-5).

Progression on the tableau benchmark: 36.4% -> 53.1% -> 65.3% -> 63.6% -> 90.0%.
The fixes that moved it, in order of size:

1. **Relative background-crop filter.** A fixed detail threshold discarded
   nearly every crop in dim scenes (cases of 34 of 35 dropped, one candidate
   left). Biggest single jump.
2. **Landscape crops for tapped cards.** Every crop was portrait card-shaped,
   so a sideways card could not be framed at all. Tapped 42% -> 68% -> 93.5%.
3. **Mirrored art anchors (`artf-*`).** Fix 2 introduced a regression: the
   art-anchored seeds assume artwork in the upper third, but a 180-degree card
   shows it in the lower third. Upside-down 58% -> 33% -> **100%**.

Remaining gap is almost entirely one failure mode: **8 of the 10 misses are in
the single overlapping scene**, and adjacency (not coverage) is what breaks it —
cards at 3-12% coverage fail alongside cards at 40%. Touching contours merge and
no crop isolates the target card.

OCR is now pure cost: it produced **zero** identifications this run (1 in each of
the two prior runs) and costs ~5.3s on each of the 13 cards that reach it,
driving p90 to 12.3s. 87 of 100 cards short-circuit before it via
visual-exact/art-match.

## 2026-07-21 — `ocr-gate-1` — Tableau 10 scenes (100 cards) — **92.0%**

Same benchmark as `tableau-20`, plus OCR gating. Accuracy up, tail nearly halved.

- Avg **2.9s** (was 4.4s) / median 2.3s / p90 **7.0s** (was 12.3s) / max 13.6s.
- By layout: side-by-side **100%** (60/60), spaced **100%** (30/30),
  overlapping 20% (2/10).
- By coverage: 0% coverage — **91/91, a clean sweep**.
- By rotation: upright 87.3%, tapped 96.8%, upside-down 100%.
- By pathway: visual-exact 48/48, art-match 37/37 — both 100%.

**Every non-overlapping card was identified correctly.** All 8 misses sit in the
single overlapping scene, which is 1 scene in 10 by design.

Accuracy rose (90.0 -> 92.0) while OCR was gated off, confirming the gates
discard nothing that mattered — OCR had produced 0-1 identifications per 100
across four runs while costing ~5.3s on every card that reached it.

Remaining known issues, both confined to the overlapping scene:

1. **Adjacency, not coverage.** Cards at 8% coverage fail alongside cards at
   40%. Touching contours merge and no crop isolates the target.
2. **`rank` is now the dominant cost there** — 7.0-8.2s with 62-74 crops tried,
   against ~39 elsewhere. Overlapping cards generate far more outline quads.
   This is a side effect of the 12 candidate crops added to fix rotation.

One ranking bug found and fixed here: 13 ORB inliers promoted "Riku and Riku"
(d198) over the correct "Sowing Mycospawn" (d133) — the first miss ever recorded
where the true card was ranked (4th) rather than absent. A non-decisive keypoint
lead (<16 inliers) can no longer override a hash distance better by 50+.

## 2026-07-21 — `edh-3` — Tableau 10 — EDH staples (100 cards) — **90.0%**

First run against a realistic card population: 70% EDHREC top-15k, 25% tokens,
5% basic lands (see `scripts/build_popularity.py`).

- Avg **2.7s** / median **1.6s** / p90 **5.7s** / max 13.3s. No errors.
- By layout: side-by-side 96.7%, spaced 96.7%, overlapping 30%.
- By pathway: visual-exact 47/47, art-match 40/40 — both 100%.
- By rotation: upright 85.5%, tapped 93.5%, upside-down 100%.

Against `ocr-gate-1` (random index cards, 92.0%) this is a 2-card difference on
n=100 — inside run-to-run noise, so "realistic cards are harder" is NOT
established. What did change: 3 misses fell outside the overlapping scene, where
the previous run had none.

Two candidate explanations, neither yet proven:

- **4 of the 10 misses are tokens** (Centaur, Sphinx, Squadron, Reanimated) —
  but all four sit in the overlapping scene, so this is confounded with the
  layout and cannot be separated on this run.
- **2 of the 3 non-overlapping misses are unusual printings**: Cataclysm is a
  From the Vault foil-only print, Talion's Messenger is extended-art. Staple
  cards carry alternate treatments far more often than the index average —
  16% of the printings of the top 40 staples are borderless/extended/showcase,
  against 3-6% across all paper printings. Plausible mechanism, two examples.

Speed is now comfortably inside the original 2-3s goal on the median, with the
tail driven entirely by the overlapping scene (rank 6.6-8.2s at 58-74 crops).

## 2026-07-21 — production incident: CSP disabled OpenCV

Not a benchmark run; recorded because it silently disabled half the pipeline
and took three wrong diagnoses to find.

The Content-Security-Policy added during the security audit omitted
`'unsafe-eval'`. OpenCV's Emscripten build evaluates strings internally, and
`'wasm-unsafe-eval'` covers WASM compilation but not `eval`/`Function`, so
`importScripts` threw and OpenCV never loaded. Effect on every scan:

- no contour detection  -> "No outline — using crops"
- no ORB verification   -> `Art: 0 kp`, and the 100%-precise path gone
- real scans landing at d209 against art-series prints

Wrong turns, in order: blamed the missing `docs.opencv.org` origin (allowing
it changed nothing); blamed cross-origin `importScripts`; blamed asset
caching of the worker's CSP. The answer only appeared by running
`importScripts` inside a worker and printing the exception, which named the
directive outright.

Verified after the fix, on a real scan of Generous Gift:
`OpenCV ready`, `Card outline detected`, `d145 via outline-1`,
`Art: 79 kp, colour 86%` — against `Art: 0 kp` and d209 while broken.

Lessons worth keeping:

1. **A security header must be verified by checking the protected thing still
   WORKS**, not that the header is present. The header was correct and the app
   was broken.
2. **Verify in a browser that enforces the policy.** The embedded browser used
   for checking reported success while production was broken; it was later
   confirmed to enforce CSP, so the earlier pass was against edge-cached
   headers from before the policy existed.
3. **Read the exception.** Three plausible theories cost far more time than
   printing the actual error once.

Two resilience bugs fixed alongside: `cvPromise` cached the *rejection*, so a
single failed init downgraded every later scan in the session to blind crops
until reload; and the 60s init ceiling competed with a 19MB index load in the
same worker.

## 2026-07-21 — `art-margin-1` — Tableau 10 — EDH staples (100 cards) — **90.0%**

First run with OpenCV working again (see the CSP incident above). Two findings,
one of them the reason the headline did not move.

**The art-match margin fix landed hard.** Measuring the decisiveness margin
against the best rival CARD rather than the next row (the shortlist keeps
several printings of one name on purpose, so the runner-up is usually the same
card) more than doubled how often the confident path fires:

| | before | after |
| --- | --- | --- |
| art-match fires | 37 | **81** |
| art-match precision | 100% | **100%** |
| avg OCR | 2872ms | **800ms** |
| median | 2340ms | **1968ms** |
| p90 | 5652ms | **4064ms** |

Faster *because* of the accuracy fix: those scans now short-circuit before OCR.

- By pool: token 94.7%, basic 100%, card 88.0% — tokens are not the weak spot.
- By layout: side-by-side 96.7%, spaced 96.7%, overlapping 30%.
- 7 of 10 misses in the single overlapping scene. The other three
  (Undergrowth Stadium, Oketra's Monument, Shifting Woodland) are lands and
  artifacts reporting `Art: 0-6 kp, weak` — ORB finds nothing to grip on.

**The heap instrumentation proved the earlier leak fix was not the leak.**

    wasmHeapStartMB 134 -> wasmHeapEndMB 268
    firstHalfAcc 0.98   -> secondHalfAcc 0.82

The OpenCV heap doubled across 100 cards and dragged the back half down, which
is why the headline stayed at 90%. The real leak: `knn.get(i)` in orbScore
returns an OWNED DMatchVector, not a view, and was never deleted — once per
match pair, per reference (24 a scan), per query image, every scan. Every other
`.get()` in the file was already released.

Fixed in `leak-fix-1` and verified directly: **WASM heap flat at 134MB across
10 consecutive scans**, cv ready and ORB running on every one.

Lesson: the earlier orbScore homography fix was a real bug and fixing it felt
like progress, but it was not the cause. Only the measurement distinguished
them — which is the whole argument for instrumenting before believing a fix.

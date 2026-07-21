# SNAPTEST results history

Newest first. Run via `snapcaster.vercel.app/snaptest`.

> **Degrade v2 (2026-07-20):** manual camera tests failed on speed-17 while
> SNAPTEST stayed green — real players hold the card well above the click
> point and near frame edges, which v1 never simulated (cards were always
> centered ±40px). Degradations now include off-center and edge-cut
> placements. Results below this note used degrade v1 and are not directly
> comparable to v2 numbers.

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

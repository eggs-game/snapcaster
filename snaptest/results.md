# SNAPTEST results history

Newest first. Run via `snapcaster.vercel.app/snaptest`.

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

# SNAPTEST results history

Newest first. Run via `snapcaster.vercel.app/snaptest`.

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

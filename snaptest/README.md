# SNAPTEST — Snapcaster recognition benchmark

A reproducible accuracy + speed benchmark, with a UI at
**`snapcaster.vercel.app/snaptest`**: pick a sample, press Run, read the
results.

## Sample modes

- **Random 200 (new each run)** — draws a fresh random 200 cards from the
  full live card index every run. Best for *discovering new failure cases*
  to fix, since it's never the same 200 twice.
- **Fixed 200 / Fixed 1000 (regression)** — always the same cards
  (`public/snaptest/cards.json`, sampled once with a fixed seed, one
  printing per distinct name for spread across colors/types/lands). Use
  these to check whether a change actually helped or regressed, since the
  input is identical run over run.

Because every card comes from the live index, ground truth is always
in-index — a miss is always a real recognition failure, never a coverage
gap.

## Degradations

Applied deterministically per card (`src/snaptest/degrade.js`, shared by the
page and the console runner) to simulate a webcam pointed at a playmat:

- **small** — card is 28–56% of the frame height
- **blurry** — 0.4–1.5px blur
- **rotation** — evenly split across upright / tilted / **sideways (90°)** /
  **upside-down (180°)**
- **occlusion** — evenly split across none / **fingers** / **dice on top** /
  fingers + dice
- plus warm/cool color casts and off-center placement

## Reading the results

- **Accuracy** — top match name equals the true name. **1st/2nd-half
  accuracy** and **peak memory** are also shown; if 2nd-half accuracy drops
  well below 1st-half, something is degrading over the course of a long run
  (this caught a real bug once — see `results.md`, 2026-07-19).
- **By rotation / by occlusion** — accuracy broken out by degradation type,
  to spot whether e.g. sideways cards or dice occlusion are disproportionately
  hard.
- **Misses** — cards that returned a *wrong* top match. Shown with the
  degraded scan next to what we guessed, plus which stage decided
  (`ocr-title`, `art-match`, etc.) and the rotation/occlusion tags — the
  fastest way to spot a pattern (e.g. "short OCR names hijacking the
  match").
- **Errors** — cards that never produced a result at all, separate from
  misses because they're a different kind of failure:
  - **timeout** — recognition exceeded the 30s worker timeout. This *is* a
    real user-facing failure (they'd give up waiting) and worth chasing.
  - **image-load** — the Scryfall reference image itself failed to fetch;
    this is a benchmark/network artifact, not a recognizer bug.
  - **identify-error / other** — an unexpected exception; the message is
    shown and worth investigating directly.
  - Each error keeps the scanned thumbnail (capped to the first 30) and the
    elapsed time, so a timeout can be inspected visually.

## Recording results & iterating

1. Run **Random 200**, click **Copy results**, and paste the JSON
   (summary + misses + errors) to whoever's working on recognition.
2. Look for the *pattern* behind the misses/errors — not every individual
   card, but what they have in common (a rotation, an occlusion, an
   identification stage, a timing cluster).
3. Ship a fix, then re-run **Fixed 200** (or **Fixed 1000**) to confirm the
   known cases improved without regressing anything, and append a row to
   `results.md`.
4. Periodically run **Random 200** again to surface new failure cases.

## Console runner (fallback)

The UI page is the primary way to run SNAPTEST. A console-only runner also
exists at `public/snaptest/runner.js` for the frozen 1000-card set:

```js
await (async () => { (0, eval)(await (await fetch('/snaptest/runner.js')).text()); })();
const cards = await (await fetch('/snaptest/cards.json')).json();
const summary = await SNAPTEST.run(cards);   // add { start, end } to run a slice
console.log(summary);
```

Requires `?debug=1` and a hard-refresh so `window.__scIdentifyUrl` is
available. Live progress is in `window.__snap`.

# SNAPTEST — Snapcaster recognition benchmark

A **frozen, reproducible** accuracy + speed benchmark. Every run measures the
**same 1000 cards** under the **same deterministic degradations**, so numbers
are comparable across recognition changes over time.

## What it measures

- **1000 cards** (`cards.json`) — sampled from the live card index with a fixed
  seed (`20260720`), one printing per distinct card name, for spread across
  colors, types, lands, and tokens. Because they're sampled from the index,
  ground truth is always in-index — every miss is a real recognition failure,
  not a coverage gap.
- **Deterministic degradations** (seeded per card in `public/snaptest/runner.js`) simulating a
  webcam pointed at a playmat:
  - **small** — card is 28–56% of the frame height
  - **blurry** — 0.4–1.5px blur
  - **rotation** — evenly split across upright / tilted / **sideways (90°)** /
    **upside-down (180°)**
  - **occlusion** — evenly split across none / **fingers** / **dice on top** /
    fingers + dice
  - plus warm/cool color casts and off-center placement
- **Scoring** — a card is correct when the top match name equals the true name.
  Reports overall accuracy, average + median identify time, and breakdowns by
  rotation class and occlusion type.

## How to run

The benchmark assets live in `public/snaptest/` and are served at
`/snaptest/…` on the deployed site.

1. Open `https://snapcaster.vercel.app/?debug=1` and hard-refresh (so
   `window.__scIdentifyUrl` is available and you're on the latest build).
2. Load the runner and the card set, then run — paste into the DevTools console:
   ```js
   await import('/snaptest/runner.js').catch(async () => (0, eval)(await (await fetch('/snaptest/runner.js')).text()));
   const cards = await (await fetch('/snaptest/cards.json')).json();
   const summary = await SNAPTEST.run(cards);   // add { start, end } to run a slice
   console.log(summary);
   ```
4. Live progress is in `window.__snap` (`done`, `correct`, `liveAcc`). The
   promise resolves with the summary; it's also on `window.__snap.summary`.

A full run is ~1000 identifications and takes roughly 60–100 minutes depending
on machine and per-scan latency. You can run a slice with
`SNAPTEST.run(c, { start: 0, end: 100 })`.

## Recording results

When you take a measurement, append a row to `results.md` with the build marker
(from `src/main.jsx`), date, overall accuracy, avg/median ms, and the
per-rotation / per-occlusion breakdown. That history is how we tell whether a
change actually helped.

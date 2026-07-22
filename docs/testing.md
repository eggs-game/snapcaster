# How we know it works

**SNAPTEST** is the benchmark, at
**[snapcaster.vercel.app/snaptest](https://snapcaster.vercel.app/snaptest)**.
Pick a sample, press Run, read the results, paste the JSON.

Recognition cannot be verified by trying a few cards by hand — it fails in
patterns (a rotation, a layout, a card kind) that only appear across a
hundred scans. Every recognition change in this project is judged by a run.

## The central lesson

> **A benchmark that does not reproduce the failure cannot verify the fix.**

For a long time SNAPTEST fed the recogniser one card, alone, centred, on a
blank field. It reported 97–100% while real webcam scans were failing badly.
The benchmark was measuring the easy case and reporting success.

Everything about the current design follows from fixing that. The benchmark
now renders a **whole table** and clicks it the way a player does.

## Tableau scenes — the realistic mode

`src/snaptest/scene.js` renders a full camera frame — **1920×1080 landscape**,
the shape a video tile actually is — containing 10 cards:

- **4 columns × 3 rows**, rows evenly filled and individually centred
- **90% of cards overlap nothing.** Most sit side by side with a little space;
  clear separation is common; significant overlap is 1 scene in 10 and mild
- **~5% of cards clipped** by the frame edge, since a camera occasionally
  sits too close
- **25% tapped** (turned 90°), because tapped permanents really are sideways
- **every 4th scene inverted**, for the player sitting opposite
- dim, warm, uneven lighting with vignetting and glare; cards tilted ±12°;
  cloth background; JPEG compression

Each card is then clicked at a **random point on its visible artwork** — never
dead centre, and never on a spot a neighbour covers, since naming the card
actually under the cursor would not be a miss.

The frame is cropped using **the same geometry as production**
(`captureGeometry.js`), so a run exercises the real capture path rather than
handing the recogniser a clean render.

These properties are verified numerically, not by eye — the layout maths is
checked across the full card-size and spacing range before shipping.

## Which cards get tested

A uniform draw from the 110k index is not what a webcam ever sees: only 19% of
it is inside the EDHREC top 2,000, and 10% is tokens, art-series prints and
Un-set jokes nobody will hold up.

The **EDH staples** modes model what actually gets *clicked* — which is not the
same as what is most numerous on a table:

| Pool | Share | Reasoning |
| --- | --- | --- |
| EDHREC top 15,000 | 70% | The cards people own |
| Tokens | 25% | Clicked out of all proportion — a token has no mana cost and no readable text, so "what token is that?" is exactly what a remote table cannot answer |
| Basic lands | 5% | Numerous, but nobody needs a Forest identified |

Popularity comes from Scryfall's `edhrec_rank` (`scripts/build_popularity.py`),
which is EDHREC's own ranking — no scraping. Tokens carry no rank, so they are
ordered by how often Wizards has printed them.

*Checked:* sampling six commanders' actual EDHREC lists, **99%** of their cards
already sit inside the global top-20k, so scraping 2,000 commander pages would
add ~1%.

## Modes

| Mode | Use |
| --- | --- |
| **Tableau 10 — EDH staples (100 cards)** | The default. Realistic scenes, realistic cards, ~5 min |
| **Tableau 10 EDH dice (100 cards)** | Same EDH tableau, with one white/black/blue/red/pink die on every card |
| **Fixed tableau overlap dice (100 cards)** | Same 100 frozen cards in forced-overlap dice scenes; repeatable targeted A/B, not a production score |
| **Tableau 100 — EDH staples (1000 cards)** | Separates confounded signals; ~45 min |
| **Tableau 10 / 100** | Same scenes, uniform draw from the whole index |
| **Random 200** | Single cards, fresh sample — discovers new failure cases |
| **Fixed 200 / 1000** | Single cards, identical every run — regression checking |
| **Fixed top-edge 64** | Four deterministic repetitions of degrade-v2's hardest clipped placement |
| **EDH staples 200** | Single cards from the realistic pool |

Ground truth always comes from the live index, so a miss is always a real
recognition failure, never a coverage gap.

## Reading the results

The headline accuracy is the least useful number. These are the ones that
diagnose:

- **`missTrueRank`** — where the correct card ranked on a miss. `rank 2-5`
  means candidate generation worked and ranking is at fault; **`absent`** means
  no crop ever surfaced it, which is a framing problem. Opposite fixes.
- **`byPathway`** — which path decided. `visual-exact` and `art-match` have
  been 100% precise; loss concentrates in cards that fall through to plain
  ranking.
- **`byRotation`** — upright / tapped / upside-down. This is how the tapped
  (42%) and upside-down (33%) regressions were both caught.
- **`byLayout`** — side-by-side / spaced / overlapping. Isolates crowding.
- **`byPool`** — card / token / basic. Answers "are tokens weak?"
- **`byClipped`**, **`byCoverage`** — cost of frame-clipping and of neighbours.
- **`byPlacement`** — the single-card crop geometry: two mildly centred
  blocks, an above-click block and the top-edge-clipped block. Each copied miss
  also includes its original index and degradation index for exact replay.
- **`wasmHeap` start→end** — OpenCV's heap is invisible to
  `performance.memory`; a leak once took a tab to 1.5GB while it reported 52MB.
- **1st/2nd-half accuracy** — a large gap means the *harness* is degrading, not
  the recogniser. Check this before believing any long run.

Every miss records the top-3 with distances, ORB inliers, the OCR text, the
click position, per-stage timings and the scryfall id — because reproducing a
miss costs another full run, so a miss that cannot be explained is expensive.
After a run, `window.__SNAPTEST_LAST_RESULT` and the hidden
`#snaptest-result` element contain the exact **Copy results** payload, including
metadata observations on misses, so completed diagnostics remain available
when browser clipboard or page-world access is unavailable.

## Workflow

1. Run **Tableau 10 — EDH staples**, click **Copy results**, paste the JSON.
2. Find the *pattern*, not the individual cards — a rotation, a layout, a
   pathway, a timing cluster.
3. Ship one fix. Bump the `BUILD` marker.
4. Re-run and compare. Append a row to [`snaptest/results.md`](../snaptest/results.md).

**Two runs of 100 differ by a couple of cards through noise alone.** A 2-card
change is not a result. This has been a real trap — twice, changes were shipped
on plausible-but-unverified reasoning and did nothing.

## Control experiments

The most valuable diagnostics have not been accuracy numbers but controls:

- **Perfect crop** — cutting a card exactly out of a scene and identifying it
  alongside the pipeline's own crop. d85–151 vs d185–196 proved framing was
  the entire problem and killed several plausible theories at once.
- **Injected drift** — `check_hash_duplication.py` was verified by deliberately
  changing a hash function to confirm it fails, rather than trusting a green
  check.

## Progression

| Build | Accuracy | Median | p90 |
| --- | --- | --- | --- |
| tableau-4 | 36.4% | — | — |
| tableau-8 | 65.3% | — | — |
| tableau-20 | 90.0% | 2.5s | 12.3s |
| **ocr-gate-1** | **92.0%** | **2.3s** | **7.0s** |
| edh-3 (realistic cards) | 90.0% | 1.6s | 5.7s |

In the 92% run, **every non-overlapping card was identified correctly**
(side-by-side 60/60, spaced 30/30); all 8 misses were in the single
overlapping scene.

Full history with per-run analysis: [`snaptest/results.md`](../snaptest/results.md).

## Automated checks

CI (`.github/workflows/ci.yml`) runs on every push:

- **`test_hash_compat.py`** — JS and Python must hash bit-identically, or the
  index silently stops matching.
- **`check_hash_duplication.py`** — the worker's copy of the hashing functions
  must match `hash.js`.
- **`npm run build`**.

## Console runner (fallback)

For the frozen 1000-card set, `public/snaptest/runner.js`:

```js
await (async () => { (0, eval)(await (await fetch('/snaptest/runner.js')).text()); })();
const cards = await (await fetch('/snaptest/cards.json')).json();
console.log(await SNAPTEST.run(cards));   // { start, end } to run a slice
```

Requires `?debug=1` and a hard refresh so `window.__scIdentifyUrl` exists.
Progress is in `window.__snap`.

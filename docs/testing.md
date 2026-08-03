# How we know it works

**SNAPTEST** is the benchmark, at
**[snapcast.app/snaptest](https://snapcast.app/snaptest)**.
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
dead centre, and never on a spot a neighbour or a die covers, since naming the
card actually under the cursor would not be a miss.

### Calibrating against real frames

Twenty-five real webcam frames were measured the same way the renders were, and
the comparison corrected several things eyeballing had missed:

| | Real frames | Scenes before | Change |
| --- | --- | --- | --- |
| glare — worst % of pixels blown | **11%** | 0.1% | hotspots widened, with a flat saturated core. A highlight that only tints the art is not the case that defeats art verification |
| sleeves | bright about as often as dark | 5 matte darks only | added saturated blue, green, purple, deep red and a pale cream. A dark sleeve hides the card edge against a dark mat, a bright one against a bright mat |
| dice | square from above | **rendering as circles** | `roundedRect` was called with `size` passed twice, so the corner radius became the full side length. Every die in every dice suite was a rounder, smaller occluder than intended |
| blur | one sharp plane, softer away from it | per-card random | blur now follows distance from a focal band, so a scan's difficulty depends on where on the table the card sits. A sharp card beside a soft one at the same distance cannot happen |
| playmats | many | one registered | the four Ultra-PRO mats and four full-art mats are now registered, so `REAL_MATS` resolves instead of silently falling back to bare cloth |

The frames are a **visual reference, not a target.** The point is that every
condition is present and in a plausible range, not that a statistic matches.

`scripts/scenepreview.html` renders a single scene for visual inspection with no
build step. Serve the repo with `python3 scripts/serve_preview.py 8777` (it maps
`/src/**` to the repo and everything else to `public/`, the way Vite does) and
open `/scripts/scenepreview.html?scene=0&mat=1`. Query parameters are
`scene`, `mat` and `realism=0`. `scripts/scenesheet.html?from=0&count=6` shows
several scenes at once, and `&crop=1` shows the production capture crop the
recogniser actually receives instead of the whole frame.

### Running Real life without a build

`scripts/reallife_runner.html` drives the real pipeline — `matcher.js`, the
recognition worker, the live card index — over Real life scenes with no Vite
build, which matters on a machine with no Node. It mirrors the `realLife` mode's
card draw, scene options and scoring; **`SnapTest.jsx` remains authoritative** if
the two ever disagree.

```
python3 scripts/serve_preview.py 8777
# open /scripts/reallife_runner.html?scenes=20
```

Progress and the final summary land on `window.__run`. It needs `tesseract.js`
resolvable through the page's import map, so `npm install` (or a copy of that
one package into `node_modules/`) must have happened; without it OCR fails to
load and timings understate production.

A 200-card run takes roughly 30 minutes. **Do not run anything else heavy on the
machine while it is going** — a `lsh-recall-1` measurement was once read as a
54% p90 win that turned out to be another process finishing, and the tell was a
stage moving that the change could not touch.

The **Perspective EDH staples** mode keeps one card isolated per frame, but
maps the card onto a four-corner trapezoid before adding warm cloth lighting,
blur, shadow and glare like the supplied phone photos. The four buckets
(`near-left`, `near-right`, `far-left`, `far-right`) rotate deterministically
through a fresh random draw of 100 cards from the EDH staples pool. This
uses only the top 15,000 EDHREC-ranked card names (not the separate token or
basic-land click pools). This isolates camera/card-plane perspective from
neighbour occlusion.

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
| **Real life (200 cards)** | **The primary suite.** Every condition a webcam over a real table shows, applied at once: sleeved and stacked cards, tapped and inverted, dice on them, blur, blown-out glare and camera perspective, cycling all nine playmats plus bare cloth. Fixed 200-card draw (`seed: 20260803`) so a few cards moving is a real change and not a different sample |
| **Tableau 10 — EDH staples (100 cards)** | Faster realistic-scene check, realistic cards, ~5 min |
| **Tableau Magic Con Vegas playmat — EDH staples (200 cards)** | Twenty 10-card Tableau scenes rendered over the supplied Magic Con Vegas playmat; includes the normal 25% tapped-card mix. Misses also run through an exact counter-rotated crop, reported as `perfectCropControl`, to separate retrieval/isolation failures from unreadable source pixels. |
| **Tableau 10 EDH dice (100 cards)** | Same EDH tableau, with one white/black/blue/red/pink die on every card |
| **Fixed tableau overlap dice (100 cards)** | Same 100 frozen cards in forced-overlap dice scenes; repeatable targeted A/B, not a production score |
| **Tableau 100 — EDH staples (1000 cards)** | Separates confounded signals; ~45 min |
| **Perspective EDH staples (100 random cards)** | One random EDH-staples card per run item, rendered at four deterministic oblique camera angles |
| **Tableau 10 / 100** | Same scenes, uniform draw from the whole index |
| **Random 200** | Single cards, fresh sample — discovers new failure cases |
| **Fixed 200 / 1000** | Single cards, identical every run — regression checking |
| **Recent-card fast path (20 repeated scans)** | Runs each degraded card normally, then repeats the exact capture with the first result as a hint; verifies correctness, speedup, and whether any scan escaped the outline-only hint tier into the complete crop/index pipeline |
| **Fixed top-edge 64** | Four deterministic repetitions of degrade-v2's hardest clipped placement |
| **EDH staples 200** | Single cards from the realistic pool |

Ground truth always comes from the live index, so a miss is always a real
recognition failure, never a coverage gap.

## Full recognition test plan

Run the complete plan after any crop, retrieval, hashing, card-isolation, ORB,
or OCR decision change and before releasing that recognition build:

| Order | Suite | Release gate |
| --- | --- | --- |
| 1 | **Real life (200 cards)** | The headline suite. Deterministic draw, so compare card-for-card against the last recorded run rather than against a gate alone. `art-match` and `visual-exact` must stay ≥99% precise; inspect `byOcclusion`, `byRotation` and the perfect-crop control. |
| 2 | **Tableau 10 — EDH staples (100 cards)** | At least 95% overall; no accepted-pathway precision regression; inspect layout and rotation breakdowns. |
| 3 | **Tableau Magic Con Vegas playmat — EDH staples (200 cards)** | Complete all 200 cards in a fresh browser session. At least 90% overall, 92% on clear cards, 95% on side-by-side cards, and 85% in every rotation bucket. `art-match` and `visual-exact` must remain 100% precise. |
| 4 | **Tableau 10 EDH dice (100 cards)** | At least 90% overall; inspect every die-colour bucket and compare clear-card accuracy with the ordinary tableau. |
| 5 | **Random 200** | At least 95% overall; inspect the top-edge/clipped placement separately. |
| 6 | **EDH staples 200** | At least 93% overall; no regression in the first three placement blocks or the top-edge block. |

**Real life leads the plan** because it is the only suite carrying every
condition at once. The gates on suites 2–6 were set against cleaner scenes; they
remain useful as regression detectors but a build that passes them all and
regresses Real life has regressed.

The Vegas suite is a required playmat-stress gate, not an optional targeted
experiment. Its illustrated background reproduces the real failure where
decorative contours and card art compete during isolation. Always report
`byLayout`, `byRotation`, `byCoverage`, `byOcclusion`, `missTrueRank`,
accepted-pathway precision, median/p90 latency, first/second-half accuracy, and
the perfect-crop control. A partial Vegas run may guide development but cannot
satisfy the release gate.

Run each long suite in a fresh browser session. Sequential runs have previously
hit bursty reference-image delivery and produced misleading latency tails. A
recognition change ships only when the target suite improves beyond the
documented two-card noise band and the other suites stay within their gates.

For a recent-card optimization, additionally run **Recent-card fast path (20
repeated scans)**. `summary.recentHint.hits` must equal `attempted`, accuracy
must remain 100%, the WASM heap must stay flat, and `baselineAvgMs /
hintAvgMs` must show a material speedup. This targeted mode proves the fast
path; it does not replace the ordinary no-hint release suites.

`summary.recentHint.fullCropFallbacks` must be empty for this deterministic
mode. Each fallback records the framing strategy and stage timings so a future
crop change cannot quietly move repeated scans back onto the expensive full
path.

## Fast local policy checks

These do not replace SNAPTEST, but catch contracts that do not require pixels:

```sh
node scripts/test_recognition_hints.mjs
node scripts/test_recognition_queue.mjs
node scripts/test_video_quality.mjs
node scripts/test_card_search_cache.mjs
node scripts/test_metadata_evidence.mjs
python3 scripts/check_hash_duplication.py
```

`npm test` runs this fast policy set plus the account/security guards in one
command. `npm run check` adds a production build and is the normal pre-push
gate for non-recognition work. Recognition pipeline changes still require the
full SNAPTEST plan above; a green fast check is not a substitute for pixels.

`npm run test:a11y` injects a tracked test-only mock fixture, serves the
production build, and runs Playwright with axe against representative
light/dark landing pages, a public profile, the shared confirmation dialog,
and the in-game settings drawer. It enforces WCAG 2 A/AA,
including automated color-contrast checks. Run `npm run check` first so the
`dist/` bundle being audited matches the code under review.

`test_card_search_cache.mjs` verifies multi-word local autocomplete and that
concurrent identical Scryfall lookups share one request. Hash-compatibility and
index-generation Python checks additionally require OpenCV (`cv2`) in the
Python environment.

## Reading the results

The headline accuracy is the least useful number. These are the ones that
diagnose:

- **`missTrueRank`** — where the correct card ranked on a miss. `rank 2-5`
  means candidate generation worked and ranking is at fault; **`absent`** means
  no crop ever surfaced it, which is a framing problem. Opposite fixes.
- **`byPathway`** — which path decided. `visual-exact` and `art-match` have
  been 100% precise; `recent-hint` must also remain precise because it is
  verified against the new capture. Loss concentrates in cards that fall
  through to plain ranking.
- **`byRotation`** — upright / tapped / upside-down. This is how the tapped
  (42%) and upside-down (33%) regressions were both caught.
- **`byLayout`** — side-by-side / spaced / overlapping. Isolates crowding.
- **`byPool`** — card / token / basic. Answers "are tokens weak?"
- **`byClipped`**, **`byCoverage`** — cost of frame-clipping and of neighbours.
- **`byOcclusion`** — clear / overlapped / edge.
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

For a slow scan observed during a real game, inspect
`window.__SNAP_RECOGNITION_TIMINGS`. It retains the latest 50 local timing
records and separates capture/network delay from recognition and worker-stage
time. The same breakdown appears in the card panel under `?debug=1`. The ring
contains timing and counts only, never camera frames, card identity, room
identity, or player content.

Future live scans are also written asynchronously to the insert-only
`recognition_timing_events` table. In the Supabase SQL editor, this query gives
a content-free recent-room overview:

```sql
select
  room_fingerprint,
  count(*) as scans,
  count(*) filter (where outcome like '%timeout') as timeouts,
  round(avg(capture_ms)) as avg_capture_ms,
  round(avg(recognition_ms)) as avg_recognition_ms,
  percentile_cont(0.9) within group (order by total_ms) as p90_total_ms,
  max(received_at) as last_seen
from recognition_timing_events
where received_at > now() - interval '2 hours'
group by room_fingerprint
order by last_seen desc;
```

Use the newest fingerprint to drill into `outcome`, `remote`, `capture_chars`,
`outgoing_video_quality`, and `stage_ms`. The table intentionally has no card
or player content, and anonymous app clients cannot read it.

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
- **Fast runtime policies** — recognition hints/queue bounds, cached card
  search, metadata gates, video quality, account/RLS guards, and bounded
  recognition evidence for guest and signed-in sessions.
- **`npm run build`** on Node 22, matching the current Supabase runtime floor;
  the build also rejects an initial JavaScript entry above the documented
  80 KiB gzip budget.
- **`npm run test:a11y`** after installing Playwright Chromium — axe scans the
  production bundle for WCAG 2 A/AA regressions, including color contrast, in
  both themes and in representative account/game overlays.

## Console runner (fallback)

For the frozen 1000-card set, `public/snaptest/runner.js`:

```js
await (async () => { (0, eval)(await (await fetch('/snaptest/runner.js')).text()); })();
const cards = await (await fetch('/snaptest/cards.json')).json();
console.log(await SNAPTEST.run(cards));   // { start, end } to run a slice
```

Requires `?debug=1` and a hard refresh so `window.__scIdentifyUrl` exists.
Progress is in `window.__snap`.

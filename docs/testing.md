# How we know it works

## Non-recognition UI regression checks

`scripts/test_media_devices.mjs` reproduces stale saved-device failures against
the shared acquisition helper and actual game transport. It verifies bounded
recovery, actual selected IDs, preserved capture quality, visitor audio-only
mode and permission/busy failures without repeated requests. It runs in the fast
policy set.

After `npm run check`, `npm run test:media:setup` checks the compiled create
and visitor setup screens with Chrome's native fake camera/microphone backend.
It reproduces an actual `OverconstrainedError` from stale saved IDs, requires a
decoded preview and correctly resolved device selectors, and checks track
cleanup on cancellation. It accesses no physical devices or production rooms.
Use `SNAPCAST_CHROME_PATH` to select an installed Chrome executable; reports
and screenshots are written to `.cache/media-setup/`.

`npm run test:webrtc` runs the actual `GameConnection` with native browser peer
connections and local fake camera/microphone tracks. Only signaling is replaced
by an in-memory adapter. It requires received audio RTP bytes, decoded/presented
non-black video frames, and open data channels across four-player mesh, late
visitor, reconnect, equal-timestamp and separate/streamless-track cases. Forced
delivery delays exercise ICE before SDP, offers before membership admission and
offers before room initialization. It makes no production requests and does not
test remote NAT/TURN or physical cameras. `SNAPCAST_CHROME_PATH` selects Chrome;
reports are in `.cache/webrtc-browser/`.

`scripts/test_webrtc_signaling.mjs` runs in the fast policy set. It reproduces
early SDP/ICE ordering and verifies that pending messages remain bounded,
expire, and cannot negotiate for an unapproved or removed membership.

`npm run test:media:playback -- --url=http://127.0.0.1:5184` runs the actual tile
and audio components against a loopback source preview. It checks autoplay
retries, delayed tracks, remounts and cleanup; `--baseline=<commit>` reproduces
controlled autoplay failures against older source. Browser autoplay rejection
is deliberately injected and must not be presented as a diagnosis of a live
network. Reports are in `.cache/ui-audit/media-playback/`.

[The four-player practice table](ui-simulation.md) runs the real game interface
with three simulated opponents on one computer. Use it for settings, chat,
whispers, counters, dice, readiness, player controls and game management.
Its browser driver checks desktop/mobile layouts and both themes while blocking
external writes. Run `npm run test:ui:simulation` after `npm run check`.

`npm run test:ui:sidebar` separately verifies card-result presentation, Chat
unread/scroll behavior, IME composition and whisper recipients with the actual
sidebar component. `npm run test:ui:pages` covers account settings, decks,
notifications, friends and shared header menus against a loopback source
preview (`--url=http://127.0.0.1:5184`). Reports/screenshots are in
`.cache/`; review screenshots as well as assertions. Fixtures cannot establish
real OAuth, physical media, WebRTC/TURN or durable server-write correctness.

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

**Keep the browser pane visible for the whole run.** Chrome deprioritises the
worker threads of a background tab, and every pipeline stage inflates by
roughly 4x — an 18-second scan against 3.8. It is a nasty failure because the
usual throttling checks all look fine in a stalled tab (`setTimeout(0)` 0.1ms,
image load 8.2ms, microtasks 0ms); only the worker's CPU share is affected, and
no harness code can outrank the scheduler.

The runner defends itself: it **parks before each scan while the pane is
hidden** rather than emit a number it cannot stand behind, and marks any scan
the pane hides *during* as `tainted`, dropping it from the latency stats while
still counting it for accuracy. Check `taintedScans` and `hiddenPauses` in the
summary before trusting a median. Long unattended runs need another machine.

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

The sequential release driver also saves the actual failed gallery pixels before
closing each context. Result exports include the exact normalized point supplied
to recognition, including the single-card default (0.5, 0.5); older exports mark that point unknown rather than
reconstructing it from rounded truth metadata. These captures allow confident
neighbour failures from random draws to be replayed faithfully.
The driver rejects incomplete runs when a polling interval exceeds sixty seconds:
machine sleep or long scheduling stalls invalidate latency evidence. Keep the
machine awake for unattended runs and rerun a discarded suite in a fresh context.

For Milo changes, `scripts/benchmark_milo_lookup.mjs` runs a paired control
with Cornelius enabled in both arms and Milo disabled only in the control by
default. Use `--baselineMilo=1` and `--baselineUrl` pointing at a frozen current-main
production build to compare improvements against a release that already has Milo.
Both arms then use Milo and the same current catalogs; exports record that setting.
For a supplied-photo change, run the paired `arcane` suite at `--severity=medium`
with that same frozen-main control and `--releaseOutput` / `--controlOutput`.
Both engines receive the original photo files; neither arm changes their pixels.
The Arlinn fixture's label is **Arlinn Kord** in all three severities: its visible
front-face artwork and rules text, and the light photo's readable title, contradict
the former reverse-face label. Apply that correction equally to the control;
historical 159/200 exports retain the original label and are not the corrected
160/200 control. The release record saves the supporting Scryfall face metadata.

`check_recognition_release.mjs CANDIDATE CONTROL --photo-improvement=PAIRED_JSON`
allows the statistically meaningful gain to come from those supplied photos.
It requires all 200 unchanged manifest identities/files in order, more than four
additional correct identities, no individual identity losses, 100% confident
precision, at least 20% median speedup, improved p90 and more correct subsecond
reads. The complete crowded-table matrix still runs: the primary must preserve
every previously correct identity against current main, and the usual precision,
rotation and hint gates remain. Without that explicit evidence argument, the
ordinary primary improvement gate still requires more than four recovered cards.

The final candidate must pass the same complete release matrix as a crop change. `scripts/test_milo_browser.mjs`
checks normal-reference retrieval on the saved new-face cases, missing-catalog
fallback, and the actual shared WASM allocation across alternating corner and
lookup jobs. Its wrapper is written only into a temporary compiled `dist`; it
is not production instrumentation. Run it separately from timed benchmarks.
`scripts/test_reference_features_browser.mjs BASE DIST OUTPUT` separately checks
raw/contrast descriptor and keypoint parity for the thumbnail, legacy normal
downsample and enlarged reference, reuse after eviction, the sixty-entry
bound, and actual OpenCV WASM allocation across 320 replacements. Its worker
wrapper also lives only in the temporary build. The companion unit test checks
native ownership and the older-browser fallback.
`scripts/test_photo_browser.mjs BASE OUTPUT` runs five supplied photos in all
four quarter-turn orientations through the actual compiled pipeline. It checks
identity and the direct-frame route; these repeated augmentation timings are
excluded from headline benchmarks. Replay the saved Geier Reach Sanitarium
capture and exact click with `scripts/replay_recognition_capture.mjs` as well:
its legacy normal-image downsample must retain the crowded-card registration.
`scripts/test_edge_isolation.mjs` exercises physical boundary scoring on a
synthetic clipped landscape card, bounded per-family crop quotas, quarter-turn
hash coverage and disjoint full-index bridges. `scripts/compare_recognition_captures.mjs`
replays exact saved suite misses in both frozen builds using their original
pixels and clicks. This distinguishes an existing difficult draw from a
regression and verifies improvements on the failure that motivated them. These
replays are excluded from headline timings; keep failed release exports as well
as the final run rather than discarding a difficult random draw.
Use `check_recognition_release.mjs CANDIDATE --broad` to check all broad
precision/rotation/hint gates before paying for the paired timed comparisons.
This partial check does not replace the complete final gate. Every checked
suite, including hints, must have the same candidate BUILD marker.
The saved Royal // Virtuous table capture reproduces a confident Monster //
Virtuous answer on frozen main. Both names share the same Virtuous half. Its
correct final replay must register the Royal half as well; one shared half
cannot confer confidence or exclude the real target. `test_click_matching.mjs`
checks both directions, missing evidence, reprint deduplication, unique split
names, near-exact hash preservation and clicked-card ownership.
The saved Bebop Art Series capture reproduces a confident Event-counterpart
error three times on frozen main. Replay it with its exact click on the candidate
and keep both exports; a missing shortlist rival must still trigger the existing
shared-art text requirement. `test_reference_wait.mjs` checks catalog name
selection, cache reuse and missing-index fallback, and proves that this catalog
challenge cannot introduce an answer or prevent text-supported acceptance.
The saved Kaya overlap fixture allows a correct result or an unresolved guess;
it must never confidently name another card. Its exact pixels reproduce a
thin-match retry error. `test_milo_lookup.mjs` checks the 24-inlier retry boundary
in both crop and source coordinates, including unknown/outside click proof.
The Art Series fixture likewise prevents confidently substituting the playable
Adventure layout. `test_click_matching.mjs` checks that a poor whole-card match
with only global illustration proof cannot anchor neighbour exclusions; regional
registration or distinguishing printed text preserves legitimate rescues.
Use frozen production builds, the authoritative Real life sampler and the
same captures. Save every scan, recovered/regressed identities, accepted
precision, rotations, overlaps, half-run accuracy, perfect-crop controls and
memory. Then complete every release suite below. A descriptor's top-k recall
alone cannot satisfy a recognition release gate.

Run `scripts/test_milo_lookup.mjs`, `scripts/test_milo_catalog.py` and
`scripts/verify_milo_catalog.py` as well. They check failed-model fallback,
clicked-card evidence, stale row rejection, shortlist diversity and publication
refusal for corrupt/incomplete face catalogs. A new database snapshot must
keep **both** visual catalogs aligned and complete.

| Order | Suite | Release gate |
| --- | --- | --- |
| 1 | **Real life (200 cards)** | The headline suite. Deterministic draw, so compare card-for-card against the last recorded run rather than against a gate alone. `art-match` and `visual-exact` must stay ≥99% precise; inspect `byOcclusion`, `byRotation` and the perfect-crop control. |
| 2 | **Tableau 10 — EDH staples (100 cards)** | At least **92%** overall; no accepted-pathway precision regression; inspect layout and rotation breakdowns. |
| 3 | **Tableau Magic Con Vegas playmat — EDH staples (200 cards)** | Complete all 200 cards in a fresh browser session. At least **83%** overall, **84%** on clear cards, and **77%** in every rotation bucket. `art-match` and `visual-exact` must remain ≥98% precise. |
| 4 | **Tableau 10 EDH dice (100 cards)** | At least 90% overall; inspect every die-colour bucket and compare clear-card accuracy with the ordinary tableau. |
| 5 | **Random 200** | At least 95% overall; inspect the top-edge/clipped placement separately. |
| 6 | **EDH staples 200** | At least 93% overall; no regression in the first three placement blocks or the top-edge block. |

### Thresholds were re-derived on 2026-08-04

Two gates were failing by default, which is worse than having no gate: a real
regression would have looked exactly like the expected failure.

Both described a benchmark that no longer exists. Scene v2.1 fixed two bugs that
had been making these suites easier than intended — dice rendered as *circles*
because `roundedRect` was called with `size` passed twice, and `PLAYMAT_IMAGES`
registered only one of the nine mats `REAL_MATS` cycles, so four scenes in ten
silently used bare cloth instead of illustrated backgrounds. It also calibrated
card blur, which had been ~13x heavier than the real frames it models.

Each new threshold sits ~1 point below a **paired control measured with the
recogniser's speed changes reverted**, so it reflects the corrected scenes rather
than the current build:

| suite | old | control | new |
| --- | --- | --- | --- |
| Tableau EDH 100 | 95% | 94.0% | **92%** |
| Vegas 200 | 90% overall | 86.0% | **83%** |
| Vegas per-rotation | 85% | 79.2% (tapped) | **77%** |

Vegas's `art-match` requirement drops from 100% to >=98% because realistic
degradation genuinely produces occasional false keypoint agreement; it measured
98.1-98.8% across both arms.

**Re-derive these again after any change to `scene.js`.** A threshold calibrated
against different pixels is not a gate.

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

## Local AI crop A/B

Prepare local assets with `python3 scripts/setup_ai_crop.py`, start Vite, then
run `node scripts/benchmark_ai_crop.mjs --suite=smoke`. Set `--chrome=/absolute/path/to/chrome`
if Playwright's own Chromium is unavailable. `--url` selects the development
server (default `http://127.0.0.1:5173`); `--output` selects the JSON destination.

The paired runner uses frozen `public/snaptest/cards.json` selections and the
actual scene/capture functions, giving both arms identical JPEGs and clicks.
Each arm has a fresh, separate browser context and recognition worker; scan
order alternates to balance external fetch timing. Ordinary recognition runs
with `{ aiCrop: false }`, the AI arm with `{ aiCrop: true }`.
Per-call `false` supplies the control arm; `?aiCrop=0` disables inference for a whole page.

Available suites are `tableau` (100), `vegas` (200), `dice` (100), `overlap`
(100 forced-overlap), and `arcane` (200 supplied captures, `--severity=light|medium|heavy`).
`smoke` is 20 forced-overlap cards on the Vegas playmat and is not a release
gate. Output records every paired result, proposal diagnostics, recoveries,
regressions, accepted-pathway precision, rotations/layouts, latency, half-run
accuracy, and WASM heap. Model warmup completes before scanning. Older prototype records included cold start on their first scan.
The frozen samples are targeted experiments, not the randomized EDH release
scores; releasing a recognition change requires the complete normal release
matrix above and separately captured real-camera examples.

For a production A/B, serve unchanged current main and the candidate separately,
and serve the candidate source with `python3 scripts/serve_preview.py 8877`.
Run the paired primary suite with:

```sh
node scripts/benchmark_ai_crop.mjs --suite=realLife --production=1 \
  --url=http://127.0.0.1:4183 --baselineUrl=http://127.0.0.1:4184 \
  --generatorUrl=http://127.0.0.1:8877 --output=.cache/paired-real-life-200.json \
  --releaseOutput=.cache/recognition-release/final \
  --controlOutput=.cache/recognition-release/current-main-control
```

The sampler and mode constants are extracted from the actual `SnapTest.jsx`,
then the actual scene and capture functions generate each JPEG once. Both
production engines receive that same capture and click, alternating order.
The primary suite runs all 200 cards with perfect-crop controls for misses,
records every result, and reports neighbour recoveries and fast-path precision.
Each engine has a fresh context; the driver brings its page to the foreground
before each scan and refuses to time a hidden page. It runs in headless Chrome
with background worker throttling disabled. These timings describe this
controlled desktop-browser run, not camera transfer or phone performance.

Run the other suites with
`node scripts/benchmark_recognition_release.mjs --url=http://127.0.0.1:4183
--modes=tableauEdh10,tableauVegasEdh20,tableauEdhDice10,random200,edh200,recentHint20,arcaneMedium
--output=.cache/recognition-release/final`. Each suite opens a fresh context
and writes its exact Copy results payload. `--ai=0` disables model inference
for an entire control page. Validate with
`node scripts/check_recognition_release.mjs .cache/recognition-release/final
.cache/recognition-release/current-main-control`, then inspect breakdowns and
card-for-card regressions. Production assets must include the pinned model,
runtime and source/license package under `dist/vendor/vision`.

## Fast local policy checks

These do not replace SNAPTEST, but catch contracts that do not require pixels:

```sh
node scripts/test_recognition_hints.mjs
node scripts/test_recognition_queue.mjs
node scripts/test_ai_crop.mjs
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

`npm run test:auth-callback` builds a production fixture using a fake Auth
endpoint and the real Supabase client. It holds the PKCE exchange open, verifies
the callback code stays in the URL until authentication finishes, then checks
that the account appears, the consumed code is removed, and no game dialog
opens. All external requests are intercepted; it does not contact production
or change real accounts. `--baseline=<commit SHA>` can reproduce the failure
against an earlier `App.jsx` while retaining the same fixture.

`scripts/test_account_origins.mjs` exercises the real account API handlers with
no auth token: both production hostnames must reach the 401 authentication
boundary, while unrelated, spoofed, insecure and nonstandard-port origins
remain rejected with 403. It runs in the fast policy set without contacting
Supabase or modifying account data.

After a production deployment, `npm run check:production-decks` verifies the
live Commander and card-list APIs reject unauthenticated callers with 401 and
foreign origins with 403. It catches missing server configuration (503) without
tokens or mutations. Its offline fixture test runs in the fast policy set and
deliberately injects the missing-configuration failure in each endpoint. An
authenticated save/import smoke test is still needed to verify the privileged
key and database writes; see `docs/security-operations.md`.

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

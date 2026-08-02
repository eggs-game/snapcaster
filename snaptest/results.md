# SNAPTEST results history

Newest first. Run via `snapcast.app/snaptest`.

> **Degrade v2 (2026-07-20):** manual camera tests failed on speed-17 while
> SNAPTEST stayed green — real players hold the card well above the click
> point and near frame edges, which v1 never simulated (cards were always
> centered ±40px). Degradations now include off-center and edge-cut
> placements. Results below this note used degrade v1 and are not directly
> comparable to v2 numbers.

## 2026-08-02 — `platform-1` — React 19 migration; Vite 8 and Tesseract 7 rejected

The platform migration evaluated each major independently. React upgraded from
18.3.1 to 19.2.8 and passed the production build, policy checks, and a final
Tableau 100-card regression. Vite 8/Rolldown and Tesseract 7 were both restored
to their prior major versions after application-specific recognition gates
showed that their generic performance claims did not hold for Snapcast.

- **Retained React 19 configuration:** Tableau EDH finished **98/100 (98%)**
  with 0 errors. Side-by-side and spaced cards were 60/60 and 30/30;
  overlapping was 8/10. Accepted art-match and visual-exact pathways were
  **97/97 precise**. Rotation was 54/55 upright, 30/31 tapped, and 14/14
  upside-down; WASM stayed 134→134MB. The run used the restored Vite 6.4.3,
  plugin-react 4.7.0, and Tesseract 6.0.1 production artifact.
- **Rejected Tesseract 7.0.0 candidate:** Tableau passed at 98/100, but the
  required Vegas suite finished 184/200 (92%) with p90 latency **21.432s**
  versus **8.0s** on the pre-migration baseline. Average OCR time increased
  from 4.88s to **8.876s**, and upside-down accuracy fell to 25/33 (75.8%),
  below the 85% rotation gate. Tesseract returned to 6.0.1.
- **Rejected Vite 8.2.0 candidate:** the Rolldown build itself improved from
  roughly 1.7–2.1s to 0.5–0.7s, but the final Tesseract-6 Vegas regression
  finished **177/200 (88.5%)**, below the 90% overall gate. Clear cards were
  168/187, side-by-side 113/120, and upside-down 24/33. Accepted pathways
  remained 166/166 precise and perfect-crop control recovered 22/23 misses,
  pointing to a bundled retrieval/isolation regression rather than bad source
  pixels. Vite returned to 6.4.3 and plugin-react to 4.7.0.

The retained dependency change is therefore React 19 only. The BUILD marker
was updated to `platform-1 (React 19)`; recognition decisions, hashing, Vite,
and OCR runtime remain on their previously verified implementations.

## 2026-08-02 — `hardening-1` — full recognition health check

The complete five-suite release matrix ran locally in fresh browser sessions
after the profile and deck-management work. No recognition decision, crop,
hash, or retrieval code changed in this pass: every headline release gate
passed, accepted visual pathways remained perfectly precise, and the only
movement against the most recent comparable baseline stayed inside the
documented two-card noise band.

- **Tableau 10 — EDH staples (100): 96/100 (96.0%)**, 0 errors. Clear cards
  were 93/94, side-by-side 60/60, spaced 29/30, and overlapping 3/6.
  Rotation was 53/55 upright, 30/31 tapped, and 13/14 inverted. Accepted
  art-match and visual-exact pathways were **95/95 precise**. Median was
  **2.628s**, p90 **7.088s**, and WASM stayed 134→134MB. The four misses
  were one low-ranked clear card and three deliberately overlapped cards that
  were absent from the shortlist.
- **Magic Con Vegas playmat — EDH staples (200): 186/200 (93.0%)**, 0 errors.
  Clear cards were 174/187, side-by-side 113/120, spaced 56/60, overlapping
  17/20, and all three edge-clipped cards were correct. Rotation was 106/114
  upright, 49/53 tapped, and 31/33 inverted, so every rotation gate passed.
  Accepted art-match and visual-exact pathways were **179/179 precise**. The
  first/second halves were 89%/97%; median was **6.6s**, p90 **8.0s**, and
  WASM stayed 134→134MB. Side-by-side missed its strict sub-gate by one card,
  matching the historical noise band; all 14 misses were absent from the
  shortlist rather than accepted false matches.
- **Tableau 10 EDH dice (100): 94/100 (94.0%)**, 0 errors. Clear cards were
  92/94. White dice were 18/20; black, blue, red, and pink were each 19/20.
  Accepted art-match and visual-exact pathways were **89/89 precise**. The
  first/second halves were 96%/92%; median was **2.961s**, p90 **7.311s**, and
  WASM stayed 134→134MB. Two misses were low-ranked clear cards and four
  were overlapped cards absent from the shortlist.
- **Random 200: 190/200 (95.0%)**, 0 errors, meeting the release gate.
  Ordinary placement blocks were 55/56, 47/48, and 48/48; top-edge/clipped
  was **40/48**, two cards below the previous 42/47 completed-card run and
  therefore inside normal sampling noise. Accepted art matches were
  **187/187 precise**. The first/second halves were 97%/93%; median was
  **3.103s**, p90 **6.098s**, and WASM stayed 134→134MB. All ten misses were
  absent from the shortlist.
- **EDH staples 200: 193/200 (96.5%)**, 0 errors. The first three placement
  blocks were a perfect **152/152** and top-edge/clipped was **41/48**, within
  the historical 41–43/48 range. Accepted art-match and visual-exact pathways
  were **189/189 precise**. The first/second halves were 97%/96%; median was
  **3.067s**, p90 **6.149s**, and WASM stayed 134→134MB. All seven misses were
  top-edge cards absent from the shortlist.

The remaining weakness is unchanged: heavily overlapped tableau cards and
single-card top-edge crops sometimes fail to introduce the true printing into
the shortlist. Expanding global crop or proposal budgets has regressed other
rotations in earlier controlled experiments. This run therefore records the
health check without a speculative recognition change or BUILD-marker bump.

## 2026-07-26 — `performance-pass-1` — bounded recognition and outline-first hints

This performance pass keeps one active recognition and only the newest waiting
click, transports native camera JPEGs as bounded binary data-channel chunks,
reuses camera capture buffers, and verifies shared room hints in stages. A
hint first sees six cheap click-local crops, then only OpenCV card-outline
rectifications; the complete crop family and 110k-printing rank run only when
those verified checks fail.

- **Recent-card fast path (20 repeated scans):** **20/20 (100%)**, 0 errors,
  **20/20 verified hint hits**, and **zero full-crop fallbacks**. Average repeat
  recognition was **0.274s** versus **2.354s** for the normal first lookup, an
  **8.59× speedup**. Median was 0.274s and p90 0.299s; hint preparation
  averaged 0.270s and verification 0.003s. Every rotation and occlusion bucket
  was 100%, and WASM stayed flat at 134→134MB.
- **Tableau 10 — EDH staples (100 cards), no hints:** **99/100 (99.0%)**,
  exceeding the 95% release gate with 0 errors. Clear cards were 94/94,
  side-by-side 60/60, spaced 30/30, and overlapping 9/10. Upright and
  upside-down were 55/55 and 14/14; tapped was 30/31. Accepted art matches
  were **86/86 precise** and visual-exact matches **11/11 precise**. Median was
  **1.840s**, p90 **5.047s**, and WASM stayed 134→134MB. The one miss was a
  15.8%-covered tapped token in the deliberately overlapping scene.

The first no-hint verification run exposed an undefined metadata-OCR parameter
left behind by the new dynamic Tesseract import. That boundary was fixed and
the complete 100-card run above repeated afterward; OCR metadata completed
without an error. The recognition decision gates and hashing contract were not
changed.

## 2026-07-26 — `recent-hints-1` — verified room cache

Repeated lookups now use strong results from the current room as a spatial
shortlist shared by players and visitors. The worker still verifies each
hinted printing against the new capture and falls back to the unchanged
full-index pipeline when verification does not pass. Duplicate in-flight
clicks at the same spot are coalesced, and only the newest distinct click may
update the card panel.

- **Recent-card fast path (20 repeated scans):** **20/20 (100%)**, 0 errors,
  with **20/20 verified hint hits**. Average repeat recognition was **0.482s**
  versus **1.841s** for the first full lookup, a **3.82× speedup**. The repeat
  stage means were 0.461s prep and 0.019s hint verification. All four rotation
  and all four occlusion buckets were 100%; WASM stayed flat at 134→134MB.
- **Tableau 10 — EDH staples (100 cards), no hints:** **96/100 (96.0%)**,
  meeting the 95% gate with 0 errors. Side-by-side was 60/60, spaced 29/30,
  overlapping 7/10, and fully clear cards 90/91. Median was **1.828s**, p90
  **5.386s**, and WASM stayed 134→134MB. Visual-exact was 9/9 precise;
  art-match was 85/86, with the single wrong art match on a 15.8%-covered card
  in the deliberately overlapping scene—the known cursor-isolation failure
  that also predates this no-hint-equivalent code path.

## 2026-07-25 — `isolation-speed-2` — single-pass exact ranking

Exact full-index ranking now evaluates all eight rotation/contrast variants
while each printing vector is hot, rather than rereading the 7MB index once
per variant. The minimum Hamming distance and every candidate remain
unchanged. Live scans also retain a local 50-entry capture/recognition/stage
timing ring so future reports of “slow” can distinguish transfer time from the
worker fallback.

- **Fixed top-edge 64:** **52/64 (81.3%)**, versus 51/64 (79.7%) on
  `isolation-retrieval-7`; the one-card movement is noise. Accepted art
  matches were 51/51 precise and the rotation/occlusion breakdown was
  unchanged. Median improved from **5.609s to 4.8s** (14%), average from
  **5.032s to 4.6s** (9%), while p90 was effectively flat at 8.5s versus
  8.626s.
- **Tableau EDH 100:** **95/100 (95.0%)**, meeting the accuracy gate.
  Accepted art/visual pathways were **93/93 precise**. Clear cards were 90/94,
  side-by-side 59/60, spaced 29/30, and overlapping 7/10. Median was **2.0s**,
  average **2.5s**, and p90 **5.8s**; average rank time was 1.07s.
- **Magic Con Vegas 200:** **184/200 (92.0%)**, above the 90% gate and up
  four cards from the previous 180/200 run (within expected sampling
  movement). Accepted art/visual pathways were **175/175 precise**. Clear
  cards were 173/187, side-by-side 114/120, spaced 52/60, overlapping 18/20,
  and all three edge-clipped cards were correct. Median improved from
  **7.093s to 6.1s** (14%) and p90 from **8.8s to 7.4s** (16%); average rank
  time was 4.00s.

An earlier candidate also shortened the isolation ANN proposal tail. It was
faster on the targeted set, but a realistic run fell below the 95% gate. That
shortcut was discarded: the final implementation keeps the complete proposal
breadth and takes its speedup only from result-equivalent index traversal.

## 2026-07-25 — `isolation-retrieval-7` — above-click edge isolation

The production-build candidate was tested from a stable local `vite preview`
after one long dev-server run reloaded mid-suite. The implementation adds a
bounded top-edge proposal family that can place the click below the card,
requires the proposed card to meet the capture boundary, suppresses that
family when a card-shaped contour already contains the click, and keeps
edge-retrieval distance separate from the ordinary image selected for ORB.
The existing two-exact-crops-per-orientation wild-playmat bridge remains
intact; reducing it to one caused a clear Vegas regression and was discarded.

- **Fixed top-edge 64:** **51/64 (79.7%)**, up from **42/64 (65.6%)** on the
  same cards (**+9**, well outside noise). No-occlusion was 15/16; rotation was
  upright 12/16, tilt 14/16, sideways 15/16 and upside-down 10/16. Accepted
  art matches were 50/50 precise. Average was 5.032s versus 5.497s, p90 8.626s
  versus 9.460s; median was effectively flat/slightly slower (5.609s versus
  5.553s).
- **Tableau EDH 100:** **96/100 (96.0%)**, meeting the 95% gate. Side-by-side
  and spaced layouts were 60/60 and 30/30; all 91 fully clear cards were
  correct. The four misses were confined to the intentionally overlapping
  scene. One accepted neighbor-card art match came from the pre-existing
  ordinary path at 15.8% overlap, not the edge family; this is the remaining
  cursor-target isolation problem.
- **Magic Con Vegas 200:** **180/200 (90.0%)**, 0 errors. Accepted art/visual
  pathways were **170/170 precise** and the perfect-crop control was 20/20.
  Clear cards were 171/187, edge-clipped cards 3/3, side-by-side 113/120,
  spaced 52/60 and overlapping 15/20. Rotation was upright 104/114, tapped
  48/53 and upside-down 28/33. Median was 7.093s (previous 7.4s); p90 was
  8.800s (previous 8.3s). Overall met the 90% gate; clear, side-by-side and
  upside-down sub-gates each missed by one card or less, within the documented
  two-card sampling noise.
- **Tableau EDH dice 100:** **95/99 (96.0%)** with one 30s timeout. Accepted
  art/visual pathways were **91/91 precise**. Clear cards were 92/93; every
  die-color bucket was 94.7–100%. Median/p90 were 3.168s/5.814s versus the
  prior 3.4s/7.2s.
- **Random 200:** **193/199 (97.0%)** with one Scryfall image-load error, up
  from **185/200 (92.5%)**. Accepted pathways were **189/189 precise**.
  Ordinary placements were 151/152 and top-edge/clipped improved from 33/48
  to **42/47 (89.4%)**. Median/p90 improved from 3.6s/6.5s to
  3.439s/6.180s.
- **EDH staples 200:** **192/199 (96.5%)** with one Scryfall image-load error,
  up from **186/200 (93.0%)**. Accepted pathways were **192/192 precise**.
  Top-edge/clipped improved from 35/48 to **43/48 (89.6%)**. Median/p90
  improved from 3.5s/6.3s to 3.282s/6.135s.

The broad Random and EDH gains are seven completed cards each and therefore
real under the project's two-card noise rule. Across the final five-suite
plan, accepted visual pathways were 100% precise except for the one documented
ordinary-path overlap error. The remaining route to 99% is no longer general
top-edge framing: it is partial-card retrieval under fingers/dice and explicit
cursor-connected isolation in overlapping scenes. Expanding global crop or
exact-scan budgets was tested and did not help.

## 2026-07-25 — production Full Test Plan + post-deploy Fixed control

The three required suites began sequentially on production BUILD
`warm-lobby-1 (lobby core preload + ready handshake)`. While they were
running, `main` and production advanced independently to
`isolation-retrieval-6`; the three baseline payloads therefore retain their
actual old-build marker rather than being attributed to the later deployment.
All complete Copy-results payloads are preserved under `snaptest/runs/`.

- **Tableau 10 scenes / EDH staples:** **89/100 (89.0%)**, 0 errors; average
  2.290s, median **1.967s**, p90 **3.572s**, max 5.861s. Stage means: prep
  0.517s, rank 1.136s, ORB 0.565s, OCR 0.842s, total 2.281s. Layout:
  side-by-side 58/60, spaced 27/30, overlapping 4/10. Clear cards were 86/91;
  coverage buckets were 86/91, 2/4, 1/4 and 0/1 from clear through 30%+.
  Rotation was upright 46/55, tapped 30/31, upside-down 13/14. Art-match
  83/83 and visual-exact 5/5 were precise; the no-match path was 1/12.
  Ten misses were absent and one rank 6+. Card/token/basic accuracy was
  61/71, 24/25 and 4/4. First/second-half accuracy was 98%/80%; JS peaked at
  43MB and WASM stayed 134→134MB.
- **Random 200:** **186/200 (93.0%)**, 0 errors; average 2.743s, median
  **2.955s**, p90 **3.897s**, max 4.422s. Stage means: prep 0.497s, rank
  1.463s, ORB 0.641s, OCR 0.531s, total 2.641s. The first three placement
  blocks were **152/152**; top-edge/clipped was **34/48**. Rotation was
  upright 45/50, tilt 48/50, sideways 48/50, upside-down 45/50. Occlusion was
  none 50/52, fingers 47/52, dice 44/48, fingers+dice 45/48. Art-match
  181/181 and visual-exact 1/1 were precise; the no-match path was 4/18.
  Thirteen misses were absent and one rank 6+. First/second-half accuracy was
  97%/89%; JS peaked at 41MB and WASM stayed 134→134MB.
- **EDH staples 200:** **186/200 (93.0%)**, 0 errors; average 3.852s, median
  **3.276s**, p90 **6.352s**, max 17.073s. Stage means: prep 0.706s, rank
  2.174s, ORB 0.827s, OCR 0.586s, total 3.745s. The first three placement
  blocks were **152/152**; top-edge/clipped was **34/48**. Rotation was
  upright 44/50, tilt 50/50, sideways 49/50, upside-down 43/50. Occlusion was
  none 49/52, fingers 48/52, dice 45/48, fingers+dice 44/48. Card/token/basic
  accuracy was 134/146, 45/47 and 7/7. Art-match 180/180 and visual-exact 2/2
  were precise; the no-match path was 4/18. All 14 misses were absent.
  First/second-half accuracy was 98%/88%; JS peaked at 27MB and WASM stayed
  134→134MB.

Across the 500 scans there were no errors. Accepted art/visual pathways were
**452/452 precise**; 37 of 39 misses were absent and two were rank 6+, with no
rank 2–5 misses. Metadata did not participate in any miss: observations were
null, veto counts were zero, `metadataConflictAll` was false and there were no
metadata errors. This rules out metadata gates, OCR thresholds and ORB
acceptance as the current recall bottleneck. The single-card losses remain
entirely top-edge/clipped, while tableau losses concentrate in overlap plus a
few clear-card framing failures.

Compared with the prior same-build run, tableau moved 92%→89%, at the edge of
the documented small-run noise and matching an earlier 89% run; no code story
is built from it. Random stayed exactly 186/200 with the same 34/48 clipped
score and the same 13-absent/one-rank-6+ split. EDH stayed exactly 186/200
with the same 34/48 clipped score and all 14 misses absent. Random timing
returned to a normal 3.0s/3.9s median/p90 after the prior contaminated
8.9s/21.5s run. EDH was also faster than that prior contaminated p90
(6.4s versus 11.5s), but the third sequential suite again encountered bursty
image delivery and should not be treated as a clean speed A/B. Flat WASM heaps
and placement-aligned losses reject resource degradation; the half-run gaps
come from deterministic late overlap/clipped blocks.

After `isolation-retrieval-6` reached production, a fresh-tab **Fixed 200**
regression completed **186/199 (93.5%)** with one Scryfall image-load error.
The first three blocks remained **152/152**; top-edge/clipped was 34/47. All
13 completed misses were absent, and art-match was 183/183 precise. Rotation
was upright 46/50, tilt 48/50, sideways 46/49 and upside-down 46/50.
First/second-half accuracy was 94.9%/92.0%; WASM stayed 134→134MB and JS
peaked at 12MB. Completion-adjusted accuracy is unchanged from the prior
187/200 control, whose clipped block was 35/48.

The Fixed control exposes a speed cost without a top-edge gain: median moved
3.046s→3.303s and p90 **3.974s→5.994s**. Weak clipped misses now try roughly
156–169 candidates, with rank alone taking 3.7–5.3s, because the new
isolation fallback activates but still leaves every true card absent. This
does not invalidate its measured wild-playmat benefit, but it proves the
fallback is not a general top-edge fix and should not be expanded further.

No recognition code was changed by this Full Test Plan run and no new commit
was created. The independently pushed commit `2a8a28a` passed GitHub's 1/1
status check and production exposes BUILD `isolation-retrieval-6`. Its
existing evidence is a 53.3%→90.3% partial wild-playmat A/B plus a 98/100
standard-cloth run; the required complete 200-card Vegas gate remains the
release-evidence gap.

**Best next experiment:** complete the full Vegas 200 suite in a fresh
session, then A/B a bounded activation gate for `isolate-*` using a measurable
wild-background signal (for example contour-cluster density) on Vegas versus
Fixed top-edge 64. Require the Vegas gain to remain, keep Fixed 200's three
easy blocks perfect and clipped recall unchanged, and restore the Fixed p90
toward 4s. Do not tune ORB, OCR, metadata or hashing: the true card is absent
before those gates, and rules-box text remains supporting metadata only.

## 2026-07-24 — `isolation-retrieval-6` — wild-playmat retrieval redesign

**Failure reproduced:** the new 200-card Magic Con Vegas mode renders the
ordinary ten-card EDH tableau over the supplied illustrated purple playmat.
The pre-change recogniser completed an initial 30-card slice at **53.3%**; all
14 misses had the true card absent. A first multi-table ANN pass reached
**64.5% over 31 cards**, but all 11 misses were still absent.

A miss-only perfect-crop control then identified **8/8** of the same cards at
hash distances **6–28**, versus **164–192** for the ordinary capture. This
proved the playmat did not make the card pixels unreadable and the 110k-card
index was healthy; click-local card isolation was the fault.

The retained redesign:

- evaluates several thousand cheap source-space rectangles around the click
  for four coherent edges at the Magic-card aspect ratio;
- refines the strongest geometry basins before rendering;
- fixes the source-to-output transform that had silently zoomed larger crops;
- treats portrait height and tapped-card short-side scale separately;
- preserves independent quotas for portrait, raw-sideways and
  counter-rotated-sideways geometry;
- retains close anchor refinements instead of suppressing them as duplicates;
- lets all surviving crops query a 16-table Hamming index, with a six-crop
  exact bridge for the strongest geometries.

The retained build completed **93/103 (90.3%)** on the Vegas playmat slice,
up **37 points** from the reproduced baseline. Clear cards were **87/94
(92.6%)**; side-by-side **60/63 (95.2%)**, spaced **26/30 (86.7%)**, and the
deliberately overlapping scene **7/10 (70.0%)**. Rotation stayed balanced:
upright **54/59 (91.5%)**, tapped **28/31 (90.3%)**, upside-down **11/13
(84.6%)**. Art-match was **87/87** and visual-exact **2/2** precise. All ten
misses remained absent; the perfect-crop control identified **10/10**, so the
remaining loss is still geometric isolation rather than ranking or source
quality. Median was 7.073s and p90 11.561s; WASM stayed flat at 134MB.

A more exhaustive angle/size quota experiment briefly reached 95.5% at 22
cards but regressed to **41/47 (87.2%)** and raised p90 to 12.375s, so it was
reverted rather than selected from an early favorable slice.

Standard-cloth regression on the retained build completed **98/100**: all
**94/94 clear cards**, all **60/60 side-by-side**, and all **30/30 spaced**
cards were correct; both misses were in the deliberately overlapping scene.
By rotation: upright **54/55**, tapped **30/31**, upside-down **14/14**.
Median was 2.033s and p90 4.288s. This rejects a normal-table or rotation
regression from the wild-playmat fallback.

## 2026-07-22 — `warm-lobby-1` — recognition cold-start preload

**Hypothesis:** the slow first recognition is initialization latency, because
the lobby previously loaded only the lightweight manifest/name tables while
the Game screen created the worker, compiled OpenCV WASM and loaded the full
hash/card/color/art indexes only after the player entered. Starting that core
work in the lobby and exposing a real worker-ready handshake should move the
cost before the first scan without changing recognition decisions or steady
state speed.

The smallest change that tests this now calls `preloadRecognition()` from the
lobby, memoizes the worker/core-index load, and waits for OpenCV plus all core
tables before showing **Recognition ready**. Optional OCR warm-up begins only
after the core is ready and the browser is idle, so it cannot compete with the
common visual/art path. The page also preconnects the Scryfall image host.
Production A/B confirmed the new lobby state: immediately after opening it
showed **Preparing card recognition**, then **Recognition ready · 110,533 card
printings** after **2.324s** (worker core **1.569s**). Before this change the
recognition worker did not exist until Game mounted, so the first identify had
to pay this cost.

Production regression results and distance from the 95% goal:

- **Tableau 10 scenes / EDH staples:** **92/100 (92.0%)**, **3 short**;
  median 2.068s, p90 4.083s. Layout: side-by-side 59/60, spaced 30/30,
  overlapping 3/10; clear cards 90/91. Rotation: upright 49/55, tapped 29/31,
  upside-down 14/14. All eight misses were absent. Art-match 85/85 and
  visual-exact 5/5 were precise. WASM stayed 134MB; JS peaked at 39MB.
- **Tableau 10 EDH dice:** **91/100 (91.0%)**, **4 short**; median 3.422s,
  p90 20.270s. Layout: side-by-side 60/60, spaced 30/30, overlapping 1/10;
  clear cards 90/94. Rotation: upright 48/55, tapped 29/31, upside-down 14/14.
  Every miss was absent. Art-match 77/77 and visual-exact 11/11 were precise.
  Die colours were white 18/20, black 19/20, blue 18/20, red 18/20 and pink
  18/20. WASM stayed 134MB; JS peaked at 17MB.
- **Random 200:** **186/200 (93.0%)**, **4 short**; median 8.858s, p90 21.539s.
  Placement: mild-centered-a 56/56, above-click 48/48, mild-centered-b 48/48,
  top-edge/clipped **34/48**. Thirteen misses were absent and one was rank 6+.
  Art-match 181/181 and visual-exact 3/3 were precise. Rotation: upright
  45/50, tilt 49/50, sideways 48/50, upside-down 44/50. WASM stayed 134MB;
  JS peaked at 27MB.
- **EDH staples 200:** **186/200 (93.0%)**, **4 short**; median 3.718s, p90
  11.543s. Placement: the first three blocks were **152/152** and
  top-edge/clipped was **34/48**. All 14 misses were absent. Rotation: upright
  46/50, tilt 49/50, sideways 49/50, upside-down 42/50. Art-match was 185/186
  precise; the lone false acceptance was an absent, clipped Market Gnome
  matched to Gideon, Martial Paragon. WASM stayed 134MB; JS peaked at 27MB.
- **Fixed 200 control:** **187/200 (93.5%)**; median 3.046s, p90 3.974s.
  The first three placement blocks remained **152/152** and top-edge/clipped
  was 35/48. All 13 misses were absent; art-match was 184/184 precise. Rotation
  was 46/50 upright, 48/50 tilt, 47/50 sideways and 46/50 upside-down.

Compared with the preceding same-day production run, normal and dice tableaux
moved 89% -> 92% and 88% -> 91%; Random moved 95% -> 93% on a fresh random
sample; EDH remained 93%. Fixed 200 moved only 94.0% -> 93.5%, and its first
three blocks stayed perfect, so there is no deterministic evidence that the
warm-up change altered recognition. The remaining losses still cluster in
known overlap and top-edge framing failures. First/second-half accuracy was
100%/84%, 100%/82%, 96%/90% and 96%/90%; flat WASM heaps and placement-aligned
losses reject a time/resource degradation explanation.

The latter sequential suites encountered bursty upstream image delivery after
thousands of reference-image requests, inflating stage times (especially rank
and ORB). A fresh dice page reproduced the slowdown immediately and completed
its first 10 cards at 10/10 before the rate-limited repeat was stopped. Because
SNAPTEST never mounts the lobby or calls its preload, these contaminated p90s
are not attributable to this change and are not used as a steady-state speed
comparison. The completed Fixed 200 control retained its prior 3.0s/4.0s
median/p90 profile.

Production build, hash duplication, cross-language hash compatibility, index
metadata, metadata analysis/evidence and `git diff --check` all pass. GitHub's
`hash-compat` check and the Vercel deployment succeeded for commit `a61a22e`;
the live BUILD marker is `warm-lobby-1 (lobby core preload + ready handshake)`.
The single best next recognition experiment remains a fixed top-edge A/B for
cursor-connected target isolation/neighbor-edge rejection, requiring gains in
all four rotations while keeping the three easy blocks, Fixed 200, clear
tableaux and accepted-pathway precision intact.

## 2026-07-22 — `outline-offclick-1` — dice tableau + overlap A/B

The Full Test Plan now targets 95% and includes a fourth daily production
suite, **Tableau 10 EDH dice**. It samples the same realistic EDH population as
the ordinary tableau and places one deterministic white, black, blue, red or
pink die on every card. Dice randomness is isolated from scene randomness, so
normal-vs-dice comparisons do not silently move or relight cards.

Today's four production results and distance from 95%:

- **Tableau 10 scenes / EDH staples:** **89/100 (89.0%)**, **6 cards short**;
  median 1.8s, p90 4.3s. Side-by-side 96.7%, spaced 90.0%, overlapping 40.0%.
- **Tableau 10 EDH dice:** **88/100 (88.0%)**, **7 cards short**, 0 errors;
  avg 3.2s, median 3.2s, p90 4.4s, max 5.9s. Stage means: prep 0.53s, rank
  1.75s, ORB 0.78s, OCR 0.81s. Side-by-side 57/60 (95.0%), spaced 29/30
  (96.7%), overlapping **2/10 (20.0%)**. Upright 45/55 (81.8%), tapped 29/31
  (93.5%), upside-down 14/14. Art-match 79/79 and visual-exact 8/8 were 100%
  precise. Ten misses were absent and two rank 6+. By die colour: white 16/20,
  black 17/20, blue 18/20, red 18/20, pink 19/20.
- **Random 200:** **190/200 (95.0%)**, at target; median 3.1s, p90 4.0s.
  All ten misses were in top-edge/clipped placements; every non-edge placement
  was perfect.
- **EDH staples 200:** **185/199 (93.0%)**, **5 completed cards short**, one
  image-load error; median 3.0s, p90 3.9s. All 14 misses were top-edge/clipped;
  every non-edge placement was perfect.

The dice run does **not** establish a colour-specific recognition problem.
Cards with zero neighbour coverage scored **87/91 (95.6%)** despite every one
carrying a die. Eight of 12 misses came from the one overlapping scene, and
white/black happened to occupy more of those placements. First/second-half
accuracy was 96%/80%, but JS stayed at 43MB and the OpenCV WASM heap stayed
flat at 134MB; the late drop is scene 9's deterministic layout, not resource
degradation.

A new **Fixed tableau overlap dice 100** control freezes the card printings and
forces all ten scenes into the overlapping layout. Baseline: **39/100**, median
5.2s, p90 5.7s. Zero-coverage cards were 13/17 (76.5%), 0-15% coverage 16/34
(47.1%), 15-30% 10/40 (25.0%), and 30%+ 0/9. All 61 misses had the true card
absent. Art-match remained 35/36 precise and visual-exact 1/1.

**Hypothesis tested:** overlap destroys the outer contour, while the known
tableau-scale cursor-anchored art crops exist but never receive a full-index
scan. Three bounded escalation experiments were deployed and tested on the
identical control:

1. Replacing existing slots with a tighter 28% art crop regressed to 8/25 and
   was stopped and reverted.
2. Replacing them with the measured 38% crop regressed to 3/12 and was stopped
   and reverted. This proved the late outline slots already rescue real cards.
3. Keeping all five existing slots and adding upright/inverted 38% scans
   completed at **39/100 exactly unchanged**, with the same 61 misses and every
   rotation/coverage/pathway count identical. Rank work rose from 2.90s to
   3.11s, so it was reverted too.

No recognition change cleared the ship gate; production recognition remains
`outline-offclick-1`. The shipped changes are harness-only: the dice suite, its
repeatable overlap control, richer dice diagnostics, and the daily automation
update. The single best next experiment is cursor-connected target isolation:
use the click plus nearby card-edge orientation to reject neighbour edges and
construct one bounded target quad, then prove it on the fixed overlap control
without disturbing the current clear-card and top-edge paths.

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
as `window.__SNAPTEST_LAST_RESULT` plus a hidden `#snaptest-result` element when
clipboard or page-world access is unavailable. It does not alter recognition
or the BUILD marker. Production build and hash-copy
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

## 2026-07-24 — `warm-lobby-1` — Perspective EDH staples (100 random cards) — **100.0%**

Fresh sample of 100 cards from the top 15,000 EDHREC-ranked card names, with
tokens and basics excluded. Each card was rendered in an isolated 640×640
phone-like frame with a deterministic trapezoidal perspective, blur, cloth
lighting, shadow and occasional glare. All four buckets were perfect:
`near-left` 25/25, `near-right` 25/25, `far-left` 25/25, `far-right` 25/25.

- 100/100 correct, 0 errors; 1st half 100%, 2nd half 100%.
- Median 3.7s, average 3.8s, p90 4.2s, slowest 4.4s.
- WASM heap stayed flat at 134→134MB; JS heap peaked at 48MB.
- Art-match decided 99 scans; one correct result had no pathway label.

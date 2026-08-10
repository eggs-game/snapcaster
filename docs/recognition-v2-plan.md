# Recognition v2 — a plan for 2s and 95%

Written 2026-08-04, after a day of measuring the current pipeline stage by
stage. Every number below was measured on the Real life suite unless stated.

The current architecture reached **~3280ms and ~83%** after four accuracy-neutral
speed cuts and one structural change. It will not reach 2000ms, and this
explains why, what to build instead, and what could go wrong.

## Why the current architecture stops here

The cost is not in any one stage. It is in **how many hypotheses the pipeline
carries**, because it does not know where the card is.

| stage | ms | what it is |
| --- | --- | --- |
| rankSeeds | 756 | 11 seed crops, each scanning all 110,592 printings |
| isolatePrep | 727 | preparing ~74 blind-swept rectangles |
| rankRefine | 710 | ~20 more crops refining the shortlist |
| prep | 615 | hashing ~90 candidates, 4-8 variants each |
| orb | 605 | fetching and matching 36 reference images |
| isolateScore | 363 | scoring the swept rectangles |

Roughly **90 candidate crops** are generated, hashed, and scored per scan; 11 of
them get a full 110k scan; 36 references are fetched and keypoint-matched. Every
one of those numbers exists for one reason: **localization is uncertain, so the
pipeline hedges.**

Three measurements say the hedging is the cost, not the work itself:

- The 110k hamming scan is **43ms per seed** — microbenchmarked, and *faster
  than numpy* for the identical computation. Scanning is not slow; scanning
  eleven times is.
- `isolatePrep` was 82% **candidate preparation**, not search. Proposal scoring
  was 104ms of 1573ms. The sweep is cheap to run and expensive to consume.
- A **perfect crop recovers 42%** of Real life misses and identifies at far lower
  distance. When framing is right, everything downstream gets easier.

Cutting constants is exhausted. Four cuts landed (isolation cap, art budget, OCR
gate, half rotations) and each was a threshold calibrated when a good scan
measured distance 60-90, on a pipeline where realistic scans now land at 91-180.
The remaining stages were then tested directly: firing the early ORB exit before
refinement was **rejected** because refinement genuinely surfaces matches, and
trimming isolation further **cost Vegas ~1.5 points**. What is left is real work.

## The target architecture

**Localize once, well. Then identify once, cheaply.** Keep the current pipeline
as the fallback.

```
capture ─▶ detector (top-3 quads + confidence)
             │
             ├─ confident ─▶ rectify 3 ─▶ hash ─▶ scan ─▶ ORB verify 10 ─▶ done
             │                                                    ~400-600ms
             └─ not confident ─▶ existing pipeline unchanged      ~3280ms
```

Arithmetic for the fast path, using measured per-unit costs:

| step | ms | basis |
| --- | --- | --- |
| detector inference | 130 | measured, current JS port |
| rectify 3 crops | ~10 | trivial |
| hash 3 crops | ~25 | `queryVariants` is ~8.6ms/candidate measured |
| 3 full 110k scans | 130 | 43ms/scan measured |
| ORB verify 10 refs | ~200 | 605ms for 36, scales with count |
| **total** | **~500ms** | |

That is 2000ms with a very large margin, and it needs **no new descriptor** —
the existing hash is fine once it is asked three questions instead of ninety.

This is the single most important conclusion of the day: **the descriptor was
never the problem for speed.** Three replacements were tested and all lost to
pHash (DINOv2 23.5%, VLAD 59% raw / 29.5% shippable, hash 74% on identical
inputs). The hash is good. It is simply being run ninety times.

## What has to be built

### 1. A detector worth trusting — the whole bet

The current one scores **58% of proposals above IoU 0.8 on unseen playmats**
(78.9% on trained ones), and its single crop won only **2 of 27** scans against
the sweep's best-of-110. Both failures have identified causes:

**Too few backgrounds.** 12,000 samples across 8 playmats. The first run without
augmentation scored 34.4% on unseen mats — a 41-point generalization gap —
because eight backgrounds seen 12,000 times teaches mats, not cards. Photometric
jitter plus a mirror closed it to 21 points. The fix is **procedural background
generation**: unlimited synthetic mats (noise fields, gradients, printed-text
blocks, line art, photographic textures) so no background can be memorised.

**One proposal, not many.** A single quad at IoU 0.8 loses to the best of 110.
The detector must emit **top-k proposals with confidence**, the way an object
detector does, so the pipeline can try three and let the existing scoring pick.

**Wrong success metric.** "IoU > 0.8 identifies" came from *perturbing the true
quad*. A model's error is systematic, not random jitter, and that equivalence
was load-bearing and unverified. Train and select against **end-to-end
identification rate**, not IoU.

Target: **90% of scans have a correct card among the top-3 proposals, on
playmats never trained on.** Below that the fallback fires too often to matter.

**Status, measured 2026-08-08.** The first two causes have been tested and the
results split:

- *Too few backgrounds* — real. But the prescription was backwards. Procedural
  backgrounds **replacing** the real mats made unseen playmats worse, 58.2% to
  38.4%; a synthetic family is not a superset of the real one. Procedural data
  **added to** the real mats works: unseen playmats reach **75.3%** at
  IoU > 0.8 and the generalisation gap falls from 21 points to under 9.
- *One proposal, not many* — **confirmed, and it is the binding constraint.**
  That much better detector, run end-to-end on the fixed 100-card draw, scored
  81/100 against the control's 80 and replaced the isolation sweep on **3 of
  80 scans**. A 17-point localisation gain converted to nothing, because the
  sweep does not need to be right once, it needs one of 110 tries to be right.

So the third cause — *wrong success metric* — is the one that mattered most.
Selecting on IoU would have called this detector a large win. The end-to-end
number is the only reason it is not being shipped, and `detectorEnabled`
stays false until top-k proposals beat it.

**Update 2026-08-09: top-k was tested cheaply and the bet is closed.** Rather
than retrain a top-k head, the detector's prediction was re-cropped at five
scales and angles and all five scored — the most generous form top-k could
take, since the spread is hand-picked rather than learned. It converted no
better than one crop: 79/100 against the control's 80, the sweep replaced on
5 of 79 scans, and the detector's crop **wrong 5 times in 13** when it won the
ranking.

Jitter covers near-misses in scale and angle, which is the failure mode mean
IoU 0.840 implies. Since that converted nothing, the remaining errors are not
near-misses — the detector sometimes locks onto the wrong object entirely, and
re-cropping the wrong object cannot help.

A learned head could propose genuinely different rectangles, so this is not a
proof. But two independent ways of giving the detector more to work with — a
17-point IoU gain, and a 5x crop spread — both landed in the noise, and the
falsification criterion above (90% top-3 on unseen mats) is nowhere in reach
from a 6% replacement rate. `detectorEnabled` stays false and the 126ms
forward pass plus 2.9MB asset are not worth paying.

**The localisation bet should be considered closed. v2 needs a different
lever.**

### 2. A confidence gate

Already proven in miniature — the part that matters here is precision, and it
is perfect. The early ORB exit skips isolation when a decisive keypoint match
exists, and **every early-decisive match has been the correct card**: 26 of 26
across the first two runs, 25 of 25 in the clean A/B that followed. The same
gate shape applies: take the detector's fast path, verify with ORB, and fall
through to the current pipeline when verification fails.

The exit itself is **off in production**, but for cost, not correctness — at a
31% hit rate its probe runs on 80 scans to win 25 and nets -61ms. That is an
argument about *when* to spend a verification, not about whether the verdict
can be trusted, and it does not weaken the gate. It does carry one warning
forward: the fast path has to be cheap enough that paying for it on every scan
is worth the scans it saves. A detector at ~130ms clears that bar far more
easily than a 335ms ORB probe does.

This is what makes the plan low-risk. A detector that works 70% of the time
still cuts the median enormously, because the other 30% costs only the
detector's 130ms on top of what happens today.

### 3. Nothing else, initially

No new descriptor, no ANN index, no embedding. Those become worthwhile *later*,
for accuracy, and only after the localization bet pays.

## Accuracy, separately

Speed and accuracy have different answers, and conflating them wasted most of a
day.

The perfect-crop control says localization is worth about **+8 points** on Real
life (42% of misses recovered), taking ~83% to roughly **88%**. That is the
ceiling of the plan above. **95% needs a better descriptor**, and the honest
state of that question is:

- Generic pretrained embeddings are **worse**, decisively (23.5% vs 74%) —
  semantic invariance is the wrong invariance for near-identical card layouts
- VLAD over local features is competitive raw (59%) but **uncompressible** —
  PCA to a shippable 256 dims collapses it to 29.5%
- A **purpose-trained metric-learning embedding** is untested. It is the only
  remaining candidate, and it is a genuine bet, not a plan

The right order is speed first, because a 500ms pipeline iterates accuracy
experiments six times faster than a 3280ms one.

## Effort and risk

| phase | work | risk |
| --- | --- | --- |
| Procedural backgrounds + 100k samples | 1-2 days | low, mechanical |
| Multi-proposal detector, trained to identification rate | 1-2 weeks | **high — this is the bet** |
| Gate + fast path integration | 2-3 days | low, pattern proven |
| Gate re-derivation and full suite validation | 2-3 days | low |

**The plan lives or dies on the detector.** Everything else is arithmetic that
already checks out, or a pattern already validated in the early ORB exit.

Honest odds, given the current model reaches 58% on unseen mats and needs ~90%
top-3: the gap is large but the causes are diagnosed and none is mysterious.
More backgrounds and multi-proposal output both attack measured failures rather
than guessed ones.

## What would falsify this

Worth writing down in advance, because six hypotheses were falsified today:

- If a properly trained detector still cannot reach 90% top-3 on unseen mats,
  the fast path fires too rarely and the plan is dead.
- If the fallback fires more than ~40% of the time, the added detector cost
  outweighs the saving.
- If detector-proposed crops identify at materially worse distance than swept
  ones at the same IoU, then IoU is not the right proxy after all and selection
  needs rebuilding around identification directly.

Each is measurable before any integration work, using the probe pattern that
worked today: measure the opportunity, then build it.

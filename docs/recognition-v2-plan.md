# Recognition v2 — a plan for 2s and 95%

Written 2026-08-04, after a day of measuring the current pipeline stage by
stage. Every number below was measured on the Real life suite unless stated.

**2026-10-10 Milo integration:** complete local retrieval now covers all
113,263 current printing faces. The final paired full pipeline scores **184/200**
against 171/200 current main, with 13 recovered and zero regressed cards;
174/174 accepted answers are correct. Warmed desktop median is 837ms, average
1708ms and p90 4977ms. Local candidate retrieval, camera-coordinate registration,
bounded higher-quality references and matching color treatment improve accuracy
without a paid per-scan API. Every-click sub-second recognition and 200/200
remain unmet. Only two of the sixteen remaining misses pass the same full
verifier on exact crops; better input/evidence is the next constraint.
See [the final results](../snaptest/results.md) for controls and release validation.
The research and original plan below remain historical measurements.

**2026-10-10 update:** the rejected custom detector remains disabled. A separate
pretrained Cornelius 2.12 model now proposes full-frame and click-local corners,
with the existing hash/ORB verifier deciding identity. The final paired 200-card
production test replaced the full pipeline on 133 scans, all correct; median
fell from 3.844s to 0.858s and accuracy rose from 81% to 84.5%, with no individual
regressions. The p90 increased from 4.407s to 5.700s when the fast attempt needed
the full fallback. This supports this particular detector integration rather
than overturning the earlier custom-model experiments. No embeddings or paid
per-scan API are involved. Full evidence and remaining limitations are in
[the October results](../snaptest/results.md). The original plan below is kept
as the measured history of the earlier approach.

## 2026-10-10 investigation — one clicked card in less than one second

The updated target is **under one second per clicked card**, including difficult
table positions. The current release has a warmed desktop median of 0.858s,
but p90 is 5.700s and accuracy is 84.5%; meeting the median alone does not meet
that target. A new research probe tests a card-trained descriptor rather than
repeating the rejected generic CLIP/DINO experiments. This is retrieval research,
not a runtime change or a deployment.

[Milo v1](https://huggingface.co/HanClinto/milo) is a 5.2MB MobileViT-XXS model
trained with ArcFace on illustration and set identities, producing normalized
128-dimensional vectors. Its compatible July 9 gallery intersects our index at
109,711 printing/face rows. **881 local rows and 103 distinct names are absent**;
all 200 sampled identities happen to be covered. An integration must build and
maintain descriptors for our entire index rather than adopt this stale gallery.
Model/gallery versions and SHA-256 checksums are recorded in the raw results.

Both descriptor arms receive the same lossless PNG pixels and rank exactly the
same complete gallery. Cornelius and rectification are the actual production
helpers. Hashing uses the worker's white balance followed by its bit-compatible
gray/contrast/rotation hashes. Milo uses upstream portrait orientation,
448×448 bilinear resizing, ImageNet normalization, and both 0° and 180° inputs.
Results are **name-level first-correct-printing ranks**, not exact printing
accuracy, calibrated confidence, click ownership, or ORB/OCR-verified answers.

| Real life, 200 frozen captures | Gray hash top 1 | Milo top 1 | Milo with int8 gallery top 1 |
| --- | --- | --- | --- |
| Actual detector crops, best score over up to two proposals | 165/192 | 178/192 | 177/192 |
| Diagnostic perfect crop, retaining dice/glare/blur | 124/200 | 193/200 | 194/200 |

Eight captures have no model proposal. Counting those as misses gives
165/200 versus 178/200, rather than implying 92.7% identification coverage.
The model retrieves 20 identities the gray descriptor misses and loses seven
it gets right. Across all 200 attempts, gray→Milo top-1 counts are upright
88→100/109, tapped 46→48/55, and inverted 31→30/36. Existing artwork/color
descriptor controls were also scored; their isolated top-1 results are in the
raw output. The combined control generously applies the production v3 formula
over the whole gallery without its gray cutoff. None of these controls runs
the full pipeline's multi-crop search, verification, or acceptance gates.
The unrectified production capture gives neither descriptor a correct top-1 identity;
this model needs localization too.

A separate **forced-overlap 100** puts every scene into an overlapping layout;
86 cards have nonzero coverage. Gray→Milo top-1 retrieval improves **40→65/100**
(26 recovered, one lost), with seven missing detector proposals counted as
misses. Yet the exact same frames' diagnostic perfect crops give **99/100 for
gray hashes versus 94/100 for Milo**. Framing remains a major constraint and
the learned descriptor is complementary, not universally stronger. No wrong
top-1 answer names another selected card in its scene in either arm; this draw
therefore does not demonstrate an additional neighbour-ownership fix. Existing
source-space registration remains necessary.

In actual Chrome on an **Apple M2 Max**, 31 fixed crops from 16 captures took
**317ms median, 322ms p90, 363ms maximum** for two orientations plus full
int8-gallery search and sorting. Median model/preprocessing was 271ms and
search was 46ms. All 31 top-1 results agree with the Python int8 probe;
embedding cosine parity is median 0.999824, minimum 0.991755, reflecting
browser/Pillow resize differences. These costs exclude camera transport,
image decoding, corner detection, reference fetches and verification. Loading
from a loopback server took 258ms before model warmup; that is not a production
network or first-visit latency claim. The current experimental assets total
24.1MB before HTTP compression, reusing the already vendored ONNX runtime.
The inference weights remain fp32; only stored gallery vectors are quantized.
Phone speed and retained WASM memory have not been measured.

The evidence supports a **bounded supplemental shortlist trial**. Preserve the
current lookup and recent-card cache; use a card-trained embedding to introduce
missing printing candidates, then require interior artwork/text and
source-space click proof to accept them. A similarity score alone must not
select a neighbour or become a displayed probability. Measure full click-to-
answer latency, coverage and wrong accepted identities independently, on actual
phone/desktop camera captures and all rotations, before changing production.
Index coverage and full pipeline verification are prerequisites, not benefits
demonstrated by this descriptor experiment.

**100% identification on every possible frame cannot be promised.** A die,
overlap, saturated glare or blur can remove all distinguishing information.
The model still misidentifies a perfectly framed Blood Crypt under a die and
The Fire Crystal under heavy glare. Use a better or subsequent camera frame
when evidence is insufficient; an unresolved attempt still counts against
overall identification coverage. Local inference has no per-scan API charge.
See [the research results](../snaptest/results.md) for the additional forced-
overlap probe and reproducible scripts.

**After the October 10 catalog refresh:** the live index now contains 113,263
faces and 35,648 names. The compatible Milo gallery still intersects at
109,711 rows, leaving **3,552 faces and 699 names** without descriptors. The
probe above retains its original July-index denominator; integration must
embed the complete refreshed catalog and maintain it alongside daily updates.

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

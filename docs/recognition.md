# How Snapcast identifies cards quickly

One click, ~1.6s median, against 110,524 printings — without a server and
without a trained model.

**There is no machine learning here.** No weights, no training, nothing to
fine-tune. It is perceptual hashing against a precomputed index, plus
geometric keypoint verification. That matters when reading the rest of this:
"improving recognition" means improving *crops, ranking and gates*, never
"training on more data".

## The core problem

The naive approach — crop where the user clicked, hash it, find the nearest
index entry — fails almost always, for one reason:

> A hash only matches if the query is framed like the reference.

The index is built from Scryfall scans: the card, upright, filling the frame.
A click on a webcam gives you a card that is tilted, possibly tapped 90° or
upside down, occupying a fraction of the frame, next to four other cards.
Hash that crop and it is nowhere near the right entry.

We proved this directly. Cropping a card *perfectly* out of a benchmark scene
(counter-rotated, exact bounds) identifies it at distance **85–151**. The
pipeline's own crop of the *same card in the same scene* gave **185–196** and
the wrong answer. Same blur, same glare, same lighting.

**Framing is the whole problem.** Everything below is machinery for producing
at least one well-framed crop from a click.

## The pipeline

### 1. Capture — get real pixels

`webrtc.js · captureLocalFrame`

Clicking a card on someone's tile sends a request over the data channel; that
player's own browser photographs its camera at **native resolution** and
returns the crop. The compressed video stream is never used for recognition.

- Camera requested at up to 4K.
- Takes the sharpest of 3 frames (gradient variance) to dodge motion blur.
- The square crop is **clamped inside the frame**. It used to be centred on
  the click and black-padded when it ran off the edge — a card held beside
  someone's head lost 30%+ of the capture to black, which skewed the colour
  signature and the hash.
- Because clamping moves the crop, the click is no longer necessarily at the
  centre, so the true in-crop position travels with the image.

### 2. Candidate crops — many guesses at framing

`recognizer.js`

A click produces ~58 candidate crops, because we do not know where the card
is, how big it is, or which way up:

| Family | What it handles |
| --- | --- |
| `outline-1..8` | OpenCV contour quads, perspective-rectified — the best case |
| `center-*` (7 scales) | Card size unknown |
| `art-*` (5 scales) | **Clicks land on artwork**, which is the upper third of a card, not its centre |
| `artf-*` (3 scales) | The player opposite: art in the *lower* third |
| `tap-*` (4) | **Landscape** crops — a tapped card is sideways and no portrait crop can frame it |
| `title-*` (2) | Clicks on the name bar |
| `tilt±20/±40`, `off*` | Tilted cards, clicks beside the card |
| `isolate-*` | Weak-read fallback: click-local, counter-rotated card windows scored by their four-sided frame |

The art/title/tap families exist because of measured failures. Tapped cards
scored 42% until landscape crops were added (now ~97%). Upside-down cards
scored 33% until the mirrored art anchor was added (now 100%).

Contour selection normally prefers quads containing the click. Near the top
of the camera frame, however, crop clamping can move the click below the real
card. The recogniser therefore keeps a bounded quota of the strongest
off-click contour cluster (three of eight outline candidates). It only does so
when that cluster has no substantial spatial rival; multiple strong clusters
mean a crowded tableau, where an off-click contour is likely to be a neighbour
and must not be allowed to introduce a false art match.

Crops that are mostly featureless are dropped, using a **relative** threshold —
a fixed one discarded almost every crop in dim scenes, once leaving a single
candidate out of 35.

If the ordinary crops still produce no plausible visual read, the recogniser
does not trust decorative contours from a playmat. It evaluates several
thousand card-shaped rectangles around the click directly against the source
pixels. A boundary score looks for four coherent edges at the Magic-card aspect
ratio. A coarse search is refined around the strongest edge basins; portrait
and tapped cards use different physical size ranges. Three protected proposal
families cover portrait cards, raw landscape cards, and landscape cards
counter-rotated into a portrait frame; each gets its own quota so decorative
edges cannot crowd an orientation out. Near-identical duplicates are removed,
but the refined few-pixel anchor and scale variants are deliberately preserved;
coarse diversity suppression once discarded the correct crop after finding its
geometry basin. Up to 144 strong rectangles are rendered and hashed. Every
survivor can query a compact multi-table Hamming index; only two-table hits
receive exact 512-bit scoring and ORB verification. The two strongest
rectangles in each orientation family also receive a bounded exact full-index
scan, preventing a good isolation from being lost solely at the
approximate-index gate. This fallback is deferred until the normal pipeline is
uncertain, so it does not tax ordinary exact scans.

### 3. Ranking — coarse to fine

Scoring 58 crops against 110k printings would be far too slow, so:

- ~10 **seed** crops get a full scan of all 110,524 printings.
- Each seed contributes its ~1,000 closest printings to a shortlist.
- The remaining crops only refine that shortlist.

Each crop is hashed as 8 variants (raw and contrast-stretched × 4 rotations),
so 90°/180° rotation is handled by the hash rather than by more crops. Scoring
combines the grayscale hash, a 13-byte hue histogram, and a 32-byte
art-region hash. Exact ranking evaluates all eight variants in one traversal
of the full index. This produces the same minimum Hamming distance as eight
separate passes while avoiding eight reads of the 7MB table for every seed.

> **A crop must be a seed to introduce an answer on the ordinary fast path.**
> Weak scans now have one deliberate exception: click-local isolation crops
> query a multi-table Hamming index and can introduce candidates through that
> bounded retrieval path. This is why historical misses showed the true card
> *absent* rather than mis-ranked, and why adding crops alone did not fix them.

The fallback index uses 16 independent 16-bit keys spanning both the
perceptual and difference hashes. Query keys probe a Hamming radius of two,
but a printing must agree in at least two tables before exact 512-bit scoring.
That rejects random playmat collisions while allowing every plausible
isolation crop—not only the ten full-scan seeds—to surface a printing.

Edge-clipped cards use one additional bounded isolation family. Unlike the
ordinary click-local grid, it allows the click to sit below the physical card
and only keeps rectangles whose top edge meets the capture boundary. This
models a card held above the cursor or partially outside the camera frame.
The family is disabled when a card-shaped contour already contains the click,
which prevents a card higher in an overlapping tableau from replacing the
card the player selected. Its retrieval distance is tracked independently from
the ordinary crop used for ORB; the edge image joins visual verification only
when an edge-sourced printing actually reaches the verification shortlist.

Query crops are white-balanced first: a warm room casts the whole image, and
the index is built from neutral scans.

### 4. Art verification — ORB keypoints

`verifyTopMatches`

The top 24 printings are fetched from Scryfall and geometrically compared to
the query using ORB keypoints and a RANSAC homography.

- Correct card: ~20–190 agreeing keypoints. Wrong card: typically < 12.
- **Decisive** (≥16 inliers and 1.5× the runner-up) settles identity as
  `art-match` and skips everything downstream.
- A marginal lead (<16 inliers) cannot override a hash that is better by 50+.
  13 inliers once promoted a card at d198 over the correct one at d133.
- Top-cropped and dark-letterboxed captures also get a bounded pure-art rescue:
  shifted art windows can introduce up to 12 candidates beyond the 24 combined
  guesses, and ORB verifies at most 36 total. Expensive full-index art scans
  are capped at eight, including escalation crops.

This path has been **100% precise** across benchmark runs — when it fires, it
is right.

### 5. Title OCR — last resort, heavily gated

`matcher.js`, tesseract.js, main thread.

OCR is skipped when it cannot change the answer: an exact visual match
(distance ≤ 90), a strong art match, or any top match within distance 150.

That gating exists because OCR was measured as **~59% of total runtime for
0–1 correct identifications per 100 cards**. At realistic card sizes a title
strip is ~14px tall and mostly unreadable. Gating it took p90 from 12.3s to
7.0s with accuracy unchanged.

When OCR does run, acceptance scales with name length (≥12 chars: 0.74, ≥8:
0.88, else 0.95); 1–3 letter names need an exact read; and a strong art match
always outranks it. A hallucinated read of "Platinum Angel" once overrode a
39-inlier art match of the correct card.

### 6. Result

Confident results show as an art or title match. Anything weaker shows ranked
guesses the player can click — matches survive to distance ≤ 210, because real
correct scans land at 170–205 and unrelated cards at 220+. **Never silently
discard the ranked list.**

### Metadata evidence on uncertain scans

When a scan is too weak for the exact-visual and decisive-ORB exits and already
falls through to title OCR, the best framed and oriented crop also supplies
three narrow regions: top-right mana cost, type line, and rules box. The three
OCR reads run in parallel. OpenCV separately counts a regular row of two or
more mana-symbol circles; a generic numeral read supplies additional mana
evidence.

The main thread loads v4 metadata only for the visual shortlist and applies the
rules in `metadataEvidence.js`. A high-confidence generic-mana, symbol-count,
or primary-type contradiction vetoes that candidate. Matching meaningful rules
words promote compatible candidates but never veto, because rules OCR is often
partial. If every visual candidate conflicts, the read is treated as faulty and
the original shortlist is preserved. This pathway never runs before a decisive
visual or art match, so the common fast path keeps its existing cost.

## Cold-start warm-up

The lobby immediately starts the recognition worker and does not label it
ready until the worker confirms that OpenCV and the full hash/card/color/art
tables are resident. The worker remains alive when the lobby transitions into
the game, moving the unavoidable WASM compile and index parsing ahead of the
first card click. A safe diagnostic is available at
`window.__SNAP_RECOGNITION_WARMUP`; it contains status and timings but no card,
camera, or player data. The first Tesseract worker warms only after the core is
ready and the browser is idle, so optional OCR cannot compete with the common
visual fast path.

## Where the time goes

The deterministic 100-card realistic tableau currently measures a 2.1s
median and 5.7s p90. The harder edge-targeted set measures a 4.8s median
because most scans activate click-local isolation:

| Stage | Typical |
| --- | --- |
| prep (crops, contours) | ~0.5s |
| rank (seed scans + refine) | ~1.3s |
| ORB verification | ~0.6s |
| OCR | usually skipped |

Live gameplay records the last 50 scans locally at
`window.__SNAP_RECOGNITION_TIMINGS`. Each entry separates capture/network time
from recognition time and includes worker-stage durations, candidate count,
and isolation-proposal count; it contains no card, image, player, or room
content. With `?debug=1`, the current card diagnostics show the same timing
breakdown. This makes a slow remote capture distinguishable from a slow
recognition fallback instead of treating the entire click-to-result delay as
one opaque number.

The tail is dominated by scenes with many overlapping cards, which generate
far more contour quads (60–74 crops tried instead of ~39).

## Debugging

- `window.__scIdentifyUrl(imageUrl, {nx, ny})` runs the whole pipeline on any
  image URL from the console — no camera required. This is the primary way to
  verify a recognition change.
- `?debug=1` shows per-stage diagnostics in the sidebar: `cv_status`, best
  distance and winning strategy, candidates tried/dropped, ORB inliers and
  colour score, the exact title strip OCR saw, and the capture itself.
- Every scan reports `wasm_heap_mb`. OpenCV lives in a fixed WASM heap that
  `performance.memory` cannot see — a leak there once let a benchmark tab
  reach 1.5GB while reporting 52MB, silently killing ORB partway through.

## Known limits

- **Overlapping cards.** Touching contours merge and no crop isolates the
  target. Cards at 8% coverage fail alongside cards at 40% — adjacency is what
  breaks it, not how much is hidden.
- **Pixels.** 720p across a 20-card playmat cannot work. 1080p is borderline,
  4K comfortable.
- **An immediate click during lobby warm-up** can still wait for OpenCV and the
  index. Once the lobby reports “Recognition ready,” the first click uses the
  same resident core as later scans.
- **Brand-new sets** are missing until the monthly index rebuild.

# How Snapcast identifies cards quickly

One click against 113,263 printing faces — without a recognition
server or a per-scan inference charge.

The `milo-adaptive-16` pipeline adds local learned retrieval and a corner detector to
perceptual hashing and geometric artwork verification. Tesseract remains the
optional text fallback. No recognition API, API key, or per-scan inference
charge is involved; camera captures stay in the browser.

### Local Milo lookup

Milo 1 is a purpose-trained MobileViT card embedder, pinned to revision
`9bcc5e809e936b8c5630d1e7101aae1de1e76621`. It shares the corner detector's
serialized worker and ONNX Runtime WASM instance. Lobby warmup loads the
5.2 MB model and complete, roughly 15.4 MB quantized reference catalog.
There is no API key, capture upload or per-scan inference charge. Model and
runtime licenses, checksums and corresponding-source links ship with the app.

Clear, verified hash/artwork results and room hints retain their fast paths.
When the initial learned crop cannot settle identity, Milo embeds up to two
rectified crops in both portrait orientations. Cosine retrieval keeps two
treatments of six different card names; a card's many reprints cannot exhaust
the verification budget. Retrieval scores are not confidence labels.

Every confident artwork result with a source click must pass the existing
decisive artwork margins **and** positive
source-space clicked-card registration. For a rectified crop, the exact camera-to-crop
transform composes with artwork registration back into original camera coordinates.
Both learned and ordinary outline crops retain this transform. This
concentrates keypoints on the clicked card and validates the physical footprint
in the original frame, including cards that were under-cropped. An unknown footprint cannot support
artwork confidence; an explicitly outside footprint cannot receive a confident artwork or
near-exact label, even when the target itself has too little visible content to
register. An off-centre guess remains selectable; positive clicked-card proof
still excludes proven neighbours across their printings. A strong model score, shared template,
unregistered match or proven neighbour cannot replace the baseline result.
Both crop hypotheses are available to artwork verification. The first four
retrieved printings also compare a normal-resolution reference, preserving
small-reference matches while recovering features lost in the thumbnail.
After positive regional registration, color and frame-ring agreement compare
matching raw and white-balanced versions of both the physical card and its
reference. Balancing only the query can otherwise veto strongly matched green
or red cards. These variants do not reduce artwork or click-proof thresholds. Weak proposals
fall through to the full matcher, retaining the original twelve AI hash-trial
supplement slots and at most twelve additional Milo slots. Ordinary seeds
and their query-image budget remain independent.

If ordinary Milo verification fails, a second pass applies local grayscale
contrast equalization (CLAHE) to query and reference keypoints. It uses the
same candidate budget, geometric registration, interior-content requirements,
color agreement and decisive margins. A successful ordinary read skips this
pass. Contrast recovery cannot replace missing or fully obscured pixels.

If neither the initial learned crop nor Milo settles the card, Cornelius gets
one bounded retry: four click-containing zooms shifted toward the possible
card center for upright, inverted and tapped artwork clicks. At most two
distinct click-containing proposals enter the same hash/Milo verification.
A rejected retry preserves the original crops and candidate pool for the full
fallback. Recent hints and already verified reads skip the retry.
Retry artwork needs at least 24 inliers both within the crop and at the original
source click, matching the existing full-source rescue strength. Extra crop
hypotheses must not promote the thin coincidences acceptable as initial
suggestions. Near-exact whole-card hashes retain their established gate.

Reference downloads start concurrently, but verification awaits only images
it actually inspects. The existing decisive early stop can finish while unused
lower-ranked downloads are still pending. Milo's two-treatment shortlist uses
bounded typed arrays and a six-identity insertion list instead of sorting every
identity; tie-breaking and selected rows remain identical.

The worker also reuses ORB keypoints and descriptors for public reference images,
with separate raw and contrast entries. A sixty-entry LRU owns these native
OpenCV allocations and frees an evicted pair before allocating another. Weak
image references avoid extending the lifetime of reference pixels; camera query
features still get released after each verification. Browsers without `WeakRef`
use the original allocate-and-release path. Native browser checks compare all
descriptor bytes and keypoint coordinates and stress eviction while measuring
the actual WASM allocation.

For one uncertain learned crop (best gray distance >150), Milo starts while the
ordinary artwork verifier is still running. Its bounded reference shortlist
prefetches thumbnails and the first four normal images after validating the
catalog fingerprint. The final raw result and scan context must arrive before
those rows can be verified; the early notification cannot settle recognition.
The same exact crop pixels and identity gates apply. Two-crop scans keep the
ordinary schedule because speculative inference delayed easy reads in the
pilot. An unused speculative job drains before the next click enters the shared
model worker, preserving callback ownership and honest end-to-end timing.

Two different card names can reuse the same illustration. A bounded check
compares the artwork leader's reference with up to two plausible rival names;
strong interior-art registration in both directions identifies shared artwork.
Shared artwork then requires registered text evidence for confident artwork
acceptance. Otherwise stronger whole-card hash evidence stays in front and the
normal fallback remains available. The reference-pair cache is bounded to 400
entries. The saved Baxter event-card regression exercises this distinction;
matching a clicked illustration alone had previously named its creature card.
A poor whole-card hash plus global source-artwork registration also requires
registered text, unless an independently detected card region registered the
clicked footprint. This prevents an Art Series illustration from extrapolating
a playable card body into blank table space and confidently naming that layout.
That untrusted footprint also cannot exclude another card layout as a neighbour.

`?milo=0` disables lookup while retaining Cornelius. `?aiCrop=0` disables both
learned stages. The console hook also accepts `{milo:false}` as its fourth
argument. Failed downloads, incompatible catalogs and inference timeouts
fall back to ordinary recognition. A failed lookup does not disable cropping.
Cold loading and difficult fallbacks are separate from warmed fast-path time;
sub-second recognition is not guaranteed on every device or capture.

`scripts/build_milo_catalog.py` reuses the SHA256-verified compatible upstream
gallery and locally embeds **all** new card faces, including reverse faces.
The daily card-index workflow updates both catalogs in the same commit.
Publication refuses incomplete embeddings. `verify_milo_catalog.py` checks
coverage, groups, quantization norms, model/table checksums and the exact
`cards.json` fingerprint. The runtime checks that fingerprint again before
interpreting any row number, so stale/mixed deployments cannot identify the
wrong printing. Cached additions avoid re-embedding the entire catalog daily.

### Local AI-assisted cropping

Cornelius 2.12 runs in a separate worker with ONNX Runtime WASM and one thread.
Recognition warmup loads and exercises the model before the first click.
Browsers without worker/canvas/bitmap support use the established matcher;
`?aiCrop=0` is a troubleshooting switch that disables model inference.

Pinned, SHA256-verified assets are tracked under
`public/vendor/vision/cornelius-2.12-ort-1.30.0/`. The unmodified model carries
its AGPL-3.0 license and upstream source link; the runtime carries its MIT
license and third-party notices. `python3 scripts/setup_ai_crop.py` reproduces
the model/runtime files and preserves that attribution package.

The detector sees the complete capture and one bounded click-local zoom. Its
ImageNet-normalized 384×384 inputs produce corners and a sharpness value. The
adapter accepts at most two distinct convex card-like quadrilaterals containing
the click. A dominant neighbouring card is rejected. This single-card model
has not been trained to choose a clicked card in a crowded tableau; measuring
that limitation is part of the experiment.

Accepted proposals are perspective-rectified at source resolution. For a scan
without room hints, an initial pass ranks only these crops and runs the existing
artwork verification. An exact visual match (distance ≤90) or decisive ORB match
returns immediately unless source-space registration proves the match lies
outside the click, skipping contour enumeration, ordinary crop generation,
and click-local isolation. An uncertain proposal falls through to the full
pipeline. Its ordinary seeds, ranking and six verification queries remain
independent of AI proposals. Up to twelve additional printing candidates from
the trial and two rectified query images supplement artwork verification;
these candidates may change the answer only with the existing decisive artwork
gates. Weak AI candidates cannot displace the established fallback. Identity
still comes from the existing hashes,
artwork verification, and OCR gates. No model confidence is treated as card
identity. Scans with recent-card hints skip model inference to preserve the
cheaper verified hint prepass. Diagnostics include
`ai_crop` (model, status, proposal count, sharpness/gate outcomes, time) and
`stage_ms.aiCrop`, plus `fastHit`/`fastMs` and `stage_ms.aiAttempt`. A missing,
failed, or stalled runtime falls back to the normal matcher and disables the
model for that page; timeout is 15 seconds.

Crowded scans additionally verify candidate artwork against the original
capture. Strong interior text follows the same source-space ownership gates
as artwork. The homography maps the actual click into the reference card. When
strong artwork evidence locates both the clicked card and a neighbour, the
neighbour cannot win on its stronger crop alone. Shared-frame coincidences cannot
invent a decisive identity or suppress OCR: ordinary keypoint scores need
artwork support, or substantial title/rules content when artwork is covered. A sufficiently strong registration
of the clicked card can finish before enumerating isolation candidates.
The excluded names carry through printing selection, title OCR and the legacy
visual re-search; those paths cannot reintroduce a proven neighbour. Lone
off-centre cards retain the existing recovery behaviour.

Full-index Hamming search uses 32-bit words and a 16-bit popcount table. The
packed 64-byte hashes and index format are unchanged; parity tests cover every
rotation, existing distance minima and unaligned input buffers. The worker and
standalone helper remain checked for duplication.

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
player’s own browser photographs its camera at **native resolution** and
returns the crop. The compressed video stream is never used for recognition.

- Camera requested at up to 4K.
- Takes the sharpest of 3 frames (gradient variance) to dodge motion blur.
- Reuses the video/canvas capture buffers for that camera track and encodes the
  chosen frame asynchronously as JPEG.
- Sends bounded 48KB binary chunks over the reliable data channel. Legacy tabs
  still receive a data URL during a rolling deploy.
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

- ~10 **seed** crops get a full scan of all 110,592 printings.
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

The lightweight landing screen does not load Game, WebRTC, Supabase,
recognition, or OCR. Once the create/join lobby is open, an idle callback starts
the recognition worker and reports ready after OpenCV and the full
hash/card/color/art tables are resident. The worker remains alive when the
lobby transitions into the game, moving the unavoidable WASM compile and index
parsing ahead of the first card click. A safe diagnostic is available at
`window.__SNAP_RECOGNITION_WARMUP`; it contains status and timings but no card,
camera, or player data. Tesseract is dynamically imported and warms after game
entry only when the browser is idle, so optional OCR cannot compete with the
common visual fast path or initial page load.

## Verified recent-card fast path

Players and visitors repeatedly inspect the same permanents during a game.
After a high-confidence result, the scanning browser keeps a bounded hint
containing the printing ID, board owner, approximate normalized position, and
timestamp, and shares it ephemerally with the room. Every participant
contributes to and consumes this shortlist. A later click within 15% of that
board position tests at most 12 hinted printings before the full index.

Hints are candidates, never answers. The worker first tests six cheap
click-local crops, then only OpenCV's card-outline rectifications, against the
hinted printing. It accepts only at distance 90 or better, or after a decisive
ORB art verification when the distance is at most 180. Only a stale, moved, or
incorrect hint pays for the complete crop family and 110,000-printing
rank/verify/OCR pipeline. The local cache contains at most 32 hints, expires
them after four hours, and is discarded with the page.

The click scheduler separately coalesces an in-flight duplicate at the same
spot. There is one active recognition and one newest waiting recognition; a
new click replaces the waiting job instead of growing a bitmap/OCR backlog.
Only the latest requested result may update the card panel.

## Where the time goes

The deterministic 100-card realistic tableau currently measures a 1.84s
median and 5.05s p90. The harder edge-targeted set measures a 4.8s median
because most scans activate click-local isolation:

| Stage | Typical |
| --- | --- |
| prep (crops, contours) | ~0.53s |
| hintPrep + hint (nearby card, outline tier) | ~0.27s total |
| rank (seed scans + refine) | ~1.10s |
| ORB verification | ~0.59s |
| OCR | usually skipped |

Live gameplay records the last 50 scans locally at
`window.__SNAP_RECOGNITION_TIMINGS`. Each entry separates capture/network time
from recognition time and includes worker-stage durations, candidate count,
and isolation-proposal count; it contains no card, image, player, or room
content. With `?debug=1`, the current card diagnostics show the same timing
breakdown. This makes a slow remote capture distinguishable from a slow
recognition fallback instead of treating the entire click-to-result delay as
one opaque number.

The same content-free breakdown is submitted asynchronously to the insert-only
Supabase `recognition_timing_events` table. The upload is not awaited by the
lookup UI, so telemetry cannot add card-result latency. Rows include the build,
success/failure category, local-versus-remote flag, capture payload character
count, outgoing quality setting, bounded timing/count fields, temporary
room-scoped participant IDs, and a one-way room fingerprint. They explicitly
exclude the room code, names, card identity/results, images, OCR text, device
labels, and raw errors. Anonymous clients can insert rows but cannot read them;
analysis and retention management happen in the Supabase dashboard.

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
- **An immediate click before idle warm-up finishes** can still wait for
  OpenCV and the index. Once the lobby reports “Recognition ready,” the first
  click uses the same resident core as later scans.
- **Brand-new sets** are missing until the monthly index rebuild.

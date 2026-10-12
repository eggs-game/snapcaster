# Milo click-delivery evidence

This directory contains several distinct controls. Read each JSON's scope,
source fingerprints and catalog digests before comparing it with another file.
The recorded Git commit is the checkout's base; frozen source hashes establish
the application code actually tested when working changes were present.

| Files | Meaning and version |
| --- | --- |
| `correctness-source.json`, `accuracy-off-200.json` | Earlier accuracy-only replay on the 113,263-face catalog, with distinct-name stopping disabled. Both arms identified 189/200; all 186 confident reads in each arm were correct. Exact exported JPEGs/clicks are reused, but replay/cache history and recognition-only times do not establish native click-to-display latency. |
| `known-controls.json` | Earlier 113,263-face saved shared-art, split-half, neighbour, clicked-footprint and weak-registration controls. These establish specific identity gates, not their frequency in all cards. |
| `native-valid-hints-33-34-4.json` | Four positive actual-Game repeated-hint controls across three rotations, using preserved compiled BUILD 33 and 34 bundles. All four retain exact JPEG/geometry, verified hint hits, printing/face/pathway/confidence and subsecond display; both repeat medians are 691ms. |
| `native-stored-hint-miss-voja-33-34.json` | Separate overlapping Voja same-card stored-hint miss. Both builds receive the actual prior verified printing hint, but neither accepts the local hint tiers. BUILD 34 restores learned verification and display improves 2456ms to 857ms with the same printing/face/confidence. This is not a positive fast-hint case. |
| `cache-inputs.json`, `cache-geier.jpg`, `cache-reprieve.jpg`, `cache-parity.json`, `cache-parity-repro.mjs` | Native descriptor-cache 60-versus-120 capacity control on exact saved inputs and frozen recognition code, with stopping disabled. Result, printing, face, confidence and source proof remain equal; cache ownership/eviction and WASM plateau are checked. Times are recognition diagnostics. The reproducer uses the checkout's current public assets unless the archived catalog is restored; that is not automatically an exact archived rerun. |
| `native-control-200.json`, `native-candidate-200.json`, `native-pair-200.json` | Final archived native pair: control BUILD `milo-display-32`, candidate BUILD `milo-click-34`, both using the same refreshed 113,269-face catalog. These are 200 fresh actual Game clicks per arm, including native three-frame capture, production JPEG encoding, WebRTC transfer, matching and decoded full-opacity card display. All 200 captured JPEG hashes, 20 opaque camera-source proofs and winning name/pathway/confidence/printing/face/source proof remain equal. All 70 final source fingerprints also match the fixed BUILD 34 stale-hint probe. |
| `rejected-stop.json`, `rejected-stop-research-200.json`, `rejected-stop-research-analysis.json` | Rejected distinct-name stopping research. The research arm explicitly enables the experiment; production's `DISTINCT_NAME_ORB_STOP` default remains `false`. The controlled actual-verifier case shows why: a stronger different-name rival after reference ten can be skipped, producing a confidently wrong earlier reprinted guess. Aggregate accuracy cannot override that failure. |
| `stale-hints-selection.json`, `stale-hints-control-20.json`, `stale-hints-candidate-20.json`, `stale-hints-pair-20.json`, `stale-hints-control-analysis.json` | Targeted real previous-card hints on frozen BUILD 33 versus BUILD 34, with all 60 native source/replacement JPEGs and crop geometry equal. Every previously correct answer survives. The pair lists three changed same-name printings and one confidence change; no faces change. The fixed no-hint/stale-hint results agree in every recorded winning-proof field. The control analysis separately records the original failure. |

The older accuracy replay uses a historical `on` result field; its top-level
`distinctNameStop: false` describes the actual OFF setting. Do not mistake that
field name for the rejected ON experiment or combine the older 113,263-face
fingerprints with the current 113,269-face native pair.

The native pair warms models and the index, then clears only Game's room-hint
ref before each fresh click. Earlier cards can warm reference caches. No repeats
are included in either full report. These measurements include three native
video samples 120 ms apart and quality-0.9 JPEG encoding; they differ from
SNAPTEST's supplied-image quality-0.62 captures. Sources and signaling are
controlled canvas tracks and loopback adapters, with no production room writes,
physical cameras, remote NAT/TURN or first-visit download guarantee. Paint is
decoded reference pixels at full opacity followed by `requestAnimationFrame`,
not measured physical screen scanout.

The final BUILD 34 pair keeps 189/200 correct and 189/189 confident answers
correct, with the same eleven unresolved cards. Correct full-opacity pictures
under one second increase from 84/200 to 131/200. Among the 189 displayed
answers, median time decreases from 1029ms to 808ms and p90 from 2278ms to
2128ms. Recognition heap remains 134 decimal MB (128 MiB) throughout both
arms. These warmed, static camera controls do not establish a physical-camera
first-frame win rate or guarantee every card is identified within one second.

The native validator requires the complete ordered 200-card pair, every exact
JPEG hash, equal catalog digests/model-gallery identities, preserved previously
correct names and faces, and zero confidently wrong answers. Before measuring,
the performance requirements were fixed at a display-median ratio no greater
than 0.9 and at least five additional correct subsecond reads. The existing
recognition accuracy release gate remains independent. Neither changed pixels
nor a matching subset can pass this exact-pair validator.

An earlier transparent-camera painter accumulated source-over alpha between
repaints and changed three first-card JPEGs. That entire run is invalid research
and is excluded from the native headline files here. The corrected camera
paints opaque black first and proves identical raw RGBA after one versus ten
repaints for every scene, in addition to the required final JPEG equality.

The separate native stale-hint probe reproduces a moved-card failure by taking
a real verified previous-scene Game hint and comparing the replacement click
with and without it. Frozen BUILD 33 produced 18/20 correct without hints versus
12/20 with stale hints; correct subsecond displays were 14/20 versus 0/20, with
no confidently wrong stale result. All 60 prior/replacement scans match their
original native JPEG and geometry. This targeted selection does not estimate
all-card accuracy. BUILD 34 restores 18/20 correct with the same stale hints,
all 18 confident answers correct, and 11 correct subsecond pictures.
Successful-picture median/p90 decrease from 2954/4789ms to 788/2352ms.
The fixed no-hint arm remains 18/20 correct (15 subsecond). Case arm order
alternates, but shared reference caches can favor the second arm; these are
targeted moved-card controls, not another 200-card accuracy estimate.

Separate valid-hint controls cover four cards across upright, tapped and
inverted rotations; all retain verified hint hits, exact printing/face/confidence
and a 691ms median repeat display in both builds. The original fifth setup case,
overlapped Voja, misses the prepass already on BUILD 33. It is a separate stored
hint-miss control: the same Voja printing/face improves from 2456ms to 857ms on
BUILD 34, with `hintHit: false` in both and independently verified AI artwork
in the fixed build. It is never counted as a successful hint-prepass example.

Use `scripts/benchmark_native_card_hints.mjs --help` for strict replay arguments.
The valid-hint driver serves previously frozen compiled bundles; its
`--sceneFixtures` and `--sourceProof` options pin the native inputs. Lossless
camera-source PNGs are generated by the full native driver and must be retained
to replay the exact archived JPEG corpus. Recreating scenes from network assets
does not automatically reproduce archived pixels.

The optimization candidate does not change the cross-language hashing contract:
Python index generation, the shared JavaScript hash and the duplicated worker
hash must still agree bit-for-bit. `check_hash_duplication.py` and
`test_hash_compat.py` retain that contract. Timing and cache changes cannot
weaken clicked-card registration, shared-art, split-half or confidence gates.

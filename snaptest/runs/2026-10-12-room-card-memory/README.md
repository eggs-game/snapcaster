# BUILD 36 shared remembered-card evidence

A tight, unambiguous repeat click shows a previously verified card immediately
with “Previously recognized · Checking…”. Fresh native capture and verification
continue. The pending reference has no confidence, sharing controls, history
entry or new hint publication. A miss, error or changed source removes it.

The three-player compiled Game regression passes all eight cases: natural hint
broadcast, late-join snapshot, independent repeats from each participant, rapid
supersession, native capture error and replacement at a remembered position.
No answers or room memory are seeded. Native RTC, three-frame capture, matcher
and sidebar are actual application code; signaling is loopback and camera media
is a deterministic canvas. Foreground timing and an explicit decoded source-frame
change prevent inactive-tab or stale synthetic-frame artifacts.

Warmed provisional pixels paint in 18ms for the original scanner, 53ms for
another player and 37ms for the late joiner. These selected functional checks
prove pending display precedes held native capture/worker responses. They do
not measure fresh 200-card accuracy, physical devices, remote NAT/TURN or cold
downloads. The last complete native200 remains BUILD 35: 191/200 correct,
148 correct subsecond displays, 787ms median and 1269ms p90.

The separate compiled sidebar regression passes sixteen desktop-dark and
mobile-light cases, including fully opaque warmed references, visible checking
text, late image delivery, replacement, miss/error clearing and Chat-tab
preservation. Screenshots and raw reports are retained in `sidebar/` and
`multiplayer/`; `checksums.json` records their original bytes. Multiplayer
reports also bind all 72 source files and the catalog fingerprints.

Run the browser checks as documented in [testing.md](../../../docs/testing.md).
The fast policy set covers bounded caches, authorized metadata transport,
camera/room invalidation and actual Game state transitions. This change does
not alter candidate crops, hashes, model weights or confidence gates.

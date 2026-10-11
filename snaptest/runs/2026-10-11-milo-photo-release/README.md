# Photo recognition release — 2026-10-11

Frozen main b569d01c75d2d46ea77696a563a4ebfe65a31f03 / milo-adaptive-16 versus milo-photo-27, Milo enabled in both arms.

Supplied Arcane Medium: **160/200 → 198/200**, zero individual losses, **196/196 confident answers correct**. Median **4847ms → 746ms**, p90 **8563ms → 1438ms**, correct subsecond identities **22 → 139**. The Hive and Seven Dwarves remain unresolved. Primary crowded tables: **189/200 → 189/200**, zero individual losses, **186/186 confident answers correct**; this is preservation, without an established camera speed gain.

These are warmed desktop browser pipeline measurements. They exclude cold downloads and camera/WebRTC transport. This does not meet 200/200 each under one second or establish accuracy across every Magic card. Models run locally without a paid per-lookup inference call.

| Suite | Correct | Median | p90 |
| --- | --- | --- | --- |
| tableauEdh10 | 97/100 | 667ms | 2004ms |
| tableauVegasEdh20 | 192/200 | 648ms | 2140ms |
| tableauEdhDice10 | 95/100 | 640ms | 2713ms |
| random200 | 196/200 | 782ms | 3942ms |
| edh200 | 191/200 | 787ms | 3806ms |
| recentHint20 | 20/20 | 168ms | 199ms |

The final full release gate passes without changing its broad precision, rotation or hint thresholds. The explicit photo-evidence mode requires substantial paired photo accuracy and timing gains while preserving every correct current-main crowded-table identity. The default primary-improvement requirement remains unchanged.

Run `node scripts/check_recognition_release.mjs snaptest/runs/2026-10-11-milo-photo-release/candidate snaptest/runs/2026-10-11-milo-photo-release/current-main-control --photo-improvement=snaptest/runs/2026-10-11-milo-photo-release/paired-arcane-200.json`.

`provenance.json` records settings and source/script checksums; `photo-pixels-sha256.json` records all 200 unchanged source photos. `fixture-correction.json` documents the Arlinn front-face label correction applied equally to both engines. Candidate/control exports and complete paired records retain individual results.

Separate checks: 20 photo quarter-turns, 18 crowded AI-on/off cases, three exact saved Geier replays, native feature parity/eviction, and model allocation/fallback. Saved failures are replayed with their actual pixels/clicks: four of the original 28 recover, all tentatively because the real click is outside the matched card. These are separate from headline benchmark timing.

Rejected prototypes remain included: prototype 21 lost Geier by replacing the legacy reference; prototype 23 failed Random 200 at 188/200; prototype 25 reproduced a confident shared-art Event/Bebop error from main; the final bounded catalog challenge recovers the correct Bebop identity in three exact replays; prototype 24's edge family omitted quarter-turn hashes and recovered none of its 12 original random misses. The final source retains the legacy view and corrects the landscape retrieval orientations. Prototype 26 reproduced a confident Royal/Monster shared-half error from main; the final guard requires registered evidence in both halves, and the exact Royal capture passes three replays. Fresh broad-suite draws are not paired population comparisons.

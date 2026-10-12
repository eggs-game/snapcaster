# Full production recognition matrix — BUILD35

All eight suites passed with zero scan errors and every confident answer correct. Both arms used the same 113,269-face catalog, warm local models and full compiled production app under the unchanged Vercel CSP. The candidate could use its optional local GPU backend; the control retained BUILD34's backend. Source, catalog and compiled hashes are in [source-proofs](source-proofs/) and [server checks](bindings/frozen-server-checks.json).

| Candidate suite | Correct | Confident correct |
| --- | ---: | ---: |
| Real-life tables | 190/200 | 187/187 |
| EDH ten-card tables | 99/100 | 96/96 |
| Vegas twenty-card tables | 192/200 | 191/191 |
| Dice-covered tables | 96/100 | 92/92 |
| Random cards | 193/200 | 130/130 |
| EDH cards | 195/200 | 130/130 |
| Recent hints | 20/20 | 20/20 |
| Arcane medium photos | 198/200 | 196/196 |

The [paired primary](realLife-paired.json) retained every previously correct identity: BUILD34 189/200 → BUILD35 190/200, with Anger recovered. The [paired photos](arcane-medium-paired.json) retained all 198 old successes: 198/200 → 198/200, with 196/196 confident answers correct in each arm. Original photo IDs, files and visible-front identities, including Arlinn Kord, were unchanged. These photos provide retention evidence; this matrix makes no material photo-speed claim.

Timing here measures the warm URL/SNAPTEST lookup boundary, excluding camera sampling and final UI paint. Full Game click-to-visible-card improvement, using native media transport and synthetic scenes, is validated separately by the [native pair](../native/pair.json). Positive hints all verified, used no full fallback and averaged 167ms versus 819ms without hints (4.9×); WASM stayed at 134MB throughout each suite.

The original matrix command, from the repository root, was:

```sh
node .cache/card35/run-release-matrix.mjs --output=.cache/card35/release-final35
```

`node` denotes the configured workspace Node runtime, with repository dependencies and Chrome available. For browser reproduction, restore the exact candidate application source and shared public fixtures matching the proofs, then copy [runner.mjs](runner.mjs) to `.cache/card35/run-release-matrix.mjs` and [frozen-server.mjs](frozen-server.mjs) to `.cache/card35/frozen-server.mjs`. Start each server in a separate terminal before running the matrix command:

```sh
node .cache/card35/frozen-server.mjs --baseline=ae8d3d2 --output=.cache/card35/frozen-34 --port=5187
node .cache/card35/frozen-server.mjs --output=.cache/card35/frozen-35 --port=5188
```

The runner uses the authoritative benchmark scripts whose hashes are recorded in [matrix-proof.json](matrix-proof.json), creates copies that block non-GET/HEAD requests, and runs one browser job at a time. [drivers](drivers/) preserves those exact guarded copies; app and worker code received no benchmark overrides. Archived runner/server copies are provenance and must be restored at the documented cache paths because their repository-root resolution depends on that location.

[artifact-manifest.json](artifact-manifest.json) covers the exact raw paired reports, eight candidate/two control exports, matrix/source proofs, drivers, runner/server, bindings and this README. It omits its own hash. JPEG captures and compiled bundles remain in private cache; the archive supports gate recomputation, while browser replay requires the original fixtures and recreated servers. No raw report bytes were changed.

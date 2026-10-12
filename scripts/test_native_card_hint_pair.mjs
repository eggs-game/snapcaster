#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateNativeHintPair, validateValidHintBundle } from "./check_native_card_hint_pair.mjs";

// A committed real BUILD34 report makes the controls independent of .cache and
// retains low numeric ORB confidence values which are still verified art hits.
const control = JSON.parse(await readFile(new URL("../snaptest/runs/2026-10-11-milo-click-release/stale-hints-candidate-20.json", import.meta.url)));
control.selection = JSON.parse(await readFile(new URL("../snaptest/runs/2026-10-11-milo-click-release/stale-hints-selection.json", import.meta.url))).selection;
const candidate = structuredClone(control);
candidate.build = "fixture-build35";
candidate.sourceDigests["src/recognition/new-fixture-file.js"] = "e".repeat(64);
const expected = { expectedBuild: candidate.build, expectedSourceDigests: candidate.sourceDigests, expectedCatalogDigests: candidate.catalogDigests };
const proof = validateNativeHintPair(control, candidate, expected);
assert.equal(proof.capturesEqual, 60);
assert.deepEqual(proof.sourceFiles, { control: 70, candidate: 71 });
assert.equal(proof.summary.candidate.staleHint.correct, 18);

const reject = (label, mutate, pattern) => {
  const altered = structuredClone(candidate);
  mutate(altered);
  assert.throws(() => validateNativeHintPair(control, altered, expected), pattern, label);
};
reject("ok/summary cannot disguise a wrong raw result", value => { value.rows[0].noHints.got = "Sol Ring"; value.summary.noHints.correct = 20; }, /recorded correctness|wrong result/);
reject("all60 exact JPEGs required", value => { value.rows[0].noHints.capture.sha256 = "f".repeat(64); }, /exact native JPEG/);
reject("crop coordinate changes invalidate the pair", value => { value.rows[0].noHints.capture.geometry.px += .01; }, /exact native JPEG/);
reject("correct identity cannot disguise changed printing", value => { value.rows[0].noHints.winner.id = "forged-printing"; value.rows[0].staleHint.winner.id = "forged-printing"; }, /preserve old correct printing/);
reject("same source corpus requires the complete final fingerprint", value => { value.sourceDigests["src/Game.jsx"] = "f".repeat(64); }, /every final source/);
reject("matching fingerprints do not excuse a stale BUILD", value => { value.build = "wrong-build"; }, /BUILD/);
reject("catalog must stay paired", value => { value.catalogDigests["public/carddata/cards.json"] = "f".repeat(64); }, /same pinned catalog/);
reject("twenty cases cannot become a fitted subset", value => { value.rows.pop(); }, /subset/);
reject("wrong source ownership cannot be reported as art", value => { value.rows[0].noHints.winner.regionalProof = false; }, /regional source proof/);
reject("confidence must be actual numeric worker metadata", value => { value.rows[0].noHints.confidence = "1"; }, /numeric confidence/);
reject("confidence changes are exposed even with the same winner", value => { value.rows[0].noHints.confidence = .123; value.rows[0].staleHint.confidence = .123; }, /preserve old correct printing/);
reject("stale lookup requires its real prior printing", value => { value.rows[0].staleHint.identifyHints = []; }, /real prior printing/);
reject("expected answers cannot be injected into the stale hint pool", value => { value.rows[0].staleHint.identifyHints.push({ name: value.rows[0].expectedName, scryfall_id: value.rows[0].expectedID }); }, /target must not be injected/);
reject("a successful raw lookup must include real native samples", value => { value.rows[0].noHints.capture.frames.pop(); }, /three production samples/);
const archivedValid = JSON.parse(await readFile(new URL("../snaptest/runs/2026-10-11-milo-click-release/native-valid-hints-33-34-4.json", import.meta.url)));
const valid = structuredClone(archivedValid);
valid.arms.control = structuredClone(archivedValid.arms.candidate);
valid.arms.control.runtimeBuild = control.build;
// The compact archive omits private hint arrays; reconstruct those unit inputs
// from the real prior printing. Browser runs must record the actual arrays.
for (const row of valid.arms.control.rows) {
  const prior = row.fresh.winner;
  row.repeat.hintsBefore = [{ card: { scryfall_id: prior.id, face: prior.face } }];
  row.repeat.identifyHints = [{ scryfall_id: prior.id, face: prior.face }];
}
valid.arms.candidate = structuredClone(valid.arms.control);
valid.arms.candidate.build = candidate.build;
valid.arms.candidate.runtimeBuild = candidate.build;
valid.arms.candidate.sourceDigests = candidate.sourceDigests;
assert.equal(validateValidHintBundle(valid, control, candidate).cases, 4);
const wrongBuild = structuredClone(valid);
wrongBuild.arms.candidate.runtimeBuild = "unrelated compiled bundle";
assert.throws(() => validateValidHintBundle(wrongBuild, control, candidate), /compiled Game BUILD/);
const wrongSource = structuredClone(valid);
wrongSource.arms.candidate.sourceDigests = control.sourceDigests;
assert.throws(() => validateValidHintBundle(wrongSource, control, candidate), /named native bundle source/);
console.log("Native stale-hint pair: 70/71-file binding and forged/raw-result/pixel/source/hint controls passed");

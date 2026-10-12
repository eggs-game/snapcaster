import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { validateNativePair, validateNativeTailPair, NATIVE_PAIR_THRESHOLDS, NATIVE_TAIL_THRESHOLDS } from "./check_native_card_delivery_pair.mjs";

export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const CONFIDENT = new Set(["art-match", "visual-exact", "recent-hint", "ocr-title"]);

function exactFingerprints(actual, expected, label) {
  assert.ok(expected && Object.keys(expected).length > 0, `${label}: expected fingerprints are required`);
  assert.deepEqual(actual, expected, `${label}: fingerprints must match the complete frozen production source/catalog`);
}

export function validateNativeReleaseEvidence(pair, control, candidate, snapshot) {
  assert.equal(pair?.ok, true, "native evidence must record a completed validation");
  assert.ok(["median-improvement", "tail-improvement"].includes(pair.policy), "native evidence requires an explicit predeclared policy");
  assert.ok(pair.thresholds && typeof pair.thresholds === "object" && !Array.isArray(pair.thresholds), "native evidence requires explicit thresholds");
  const tail = pair.policy === "tail-improvement";
  assert.deepEqual(pair.predeclaredFreshThresholds, tail ? NATIVE_TAIL_THRESHOLDS : NATIVE_PAIR_THRESHOLDS, "native policy cannot replace predeclared thresholds");
  const result = (tail ? validateNativeTailPair : validateNativePair)(control, candidate, pair.thresholds);
  assert.equal(result.ok, true, `native reports failed revalidation: ${result.failures.join("; ")}`);
  assert.equal(result.exactPaired, true, "native evidence requires all exact 200 pairs");
  assert.equal(result.summary.fresh.control.n, 200);
  assert.equal(result.summary.fresh.candidate.n, 200);
  for (const key of ["builds", "matchedCaptures", "expectedCaptures", "thresholds", "gains", "summary"])
    assert.deepEqual(pair[key], result[key], `native saved ${key} must match the original reports`);
  assert.equal(candidate.build, snapshot.build, "native candidate must use the current final BUILD");
  assert.equal(control.build, snapshot.controlBuild, "native control must use current main BUILD");
  assert.equal(control.commit, snapshot.controlCommit, "native control must use current main commit");
  exactFingerprints(candidate.sourceDigests, snapshot.sourceDigests, "native candidate source");
  exactFingerprints(control.sourceDigests, snapshot.controlSourceDigests, "native current-main source");
  exactFingerprints(candidate.catalogDigests, snapshot.catalogDigests, "native candidate catalog");
  exactFingerprints(control.catalogDigests, snapshot.catalogDigests, "native control catalog");
  for (const mode of result.modes) for (const arm of ["control", "candidate"]) {
    const confident = result.summary[mode][arm].confident;
    assert.ok(confident.n > 0 && confident.correct === confident.n, `native ${mode} ${arm}: every confident result must be correct`);
  }
  return result;
}

export function readNativeReleaseEvidence(pairPath, snapshot) {
  const pair = JSON.parse(readFileSync(pairPath));
  const readArm = arm => {
    const input = pair.inputs?.[arm];
    assert.ok(input && typeof input.file === "string" && input.file.length > 0 && /^[a-f0-9]{64}$/.test(input.sha256 || ""), `native evidence requires a ${arm} report reference and SHA256`);
    const file = path.resolve(path.dirname(pairPath), input.file), bytes = readFileSync(file);
    assert.equal(sha256(bytes), input.sha256, `native ${arm} input SHA256 must match the validated report`);
    return JSON.parse(bytes);
  };
  const control = readArm("control"), candidate = readArm("candidate");
  return { ...validateNativeReleaseEvidence(pair, control, candidate, snapshot), control, candidate };
}

export function assertNativeMatrixPrecision(result, mode) {
  let accepted = 0, artworkAccepted = 0;
  for (const [pathway, bucket] of Object.entries(result.summary?.byPathway || {})) {
    if (!CONFIDENT.has(pathway)) continue;
    assert.ok(Number.isInteger(bucket.n) && bucket.n >= 0 && Number.isInteger(bucket.ok) && bucket.ok === bucket.n, `${mode}: every confident ${pathway} result must be correct`);
    accepted += bucket.n;
    if (["art-match", "visual-exact"].includes(pathway)) artworkAccepted += bucket.n;
  }
  assert.ok(accepted > 0, `${mode}: record a nonempty confident precision bucket`);
  if (result.summary?.accepted) {
    assert.equal(result.summary.accepted.n, artworkAccepted, `${mode}: accepted artwork count must agree with pathway buckets`);
    assert.equal(result.summary.accepted.correct, artworkAccepted, `${mode}: every accepted artwork result must be correct`);
  }
  for (const miss of result.misses || []) assert.ok(!CONFIDENT.has(miss.by), `${mode}: a confident miss cannot hide in summary precision`);
}

export function assertNativePrimaryRetention(candidate, control) {
  const misses = (report, label) => {
    assert.equal(report.summary.n, 200, `${label}: complete deterministic primary draw`);
    assert.equal(report.summary.errors, 0);
    assert.ok(Array.isArray(report.misses));
    assert.ok(Number.isInteger(report.summary.correct), `${label}: record the primary correct count`);
    assert.equal(report.misses.length, 200 - report.summary.correct, `${label}: primary misses must agree with the correct count`);
    assert.equal(report.summary.accuracy, report.summary.correct / 200, `${label}: primary accuracy must agree with correct count`);
    const result = new Map();
    for (const miss of report.misses) {
      assert.ok(Number.isInteger(miss.i) && miss.i >= 0 && miss.i < 200 && typeof miss.id === "string" && miss.id.length > 0 && typeof miss.name === "string" && miss.name.length > 0, `${label}: complete deterministic miss identity`);
      assert.ok(!result.has(miss.i), `${label}: duplicate primary miss index`);
      result.set(miss.i, miss);
    }
    return result;
  };
  const oldMisses = misses(control, "current main"), nextMisses = misses(candidate, "candidate");
  for (const [index, miss] of nextMisses) {
    assert.ok(oldMisses.has(index), "native release: no individually regressed crowded-table identity");
    assert.equal(miss.id, oldMisses.get(index).id, "native release: unchanged deterministic printing draw");
    assert.equal(miss.name, oldMisses.get(index).name, "native release: unchanged deterministic identity draw");
  }
}

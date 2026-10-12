#!/usr/bin/env node
// Additional native click-to-paint evidence. This does not replace or relax
// check_recognition_release.mjs and its unchanged accuracy release matrix.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const CONFIDENT = new Set(["art-match", "visual-exact", "recent-hint", "ocr-title"]);
const SHA256 = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const CATALOG_FILES = ["public/carddata/manifest.json", "public/carddata/cards.json", "public/carddata/milo/manifest.json"];
// Declared before the full native pair. Callers may make these stricter,
// never relax them to fit the observed outcome.
export const NATIVE_PAIR_THRESHOLDS = Object.freeze({ maxFreshMedianRatio: .9, minFreshUnder1Gain: 5 });
// BUILD 34 already has a subsecond median. The next release targets its slow
// tail; declare a separate policy before measuring any candidate. The original
// median-improvement policy stays the default and cannot be relaxed.
export const NATIVE_TAIL_THRESHOLDS = Object.freeze({ maxFreshMedianRatio: 1.05, maxFreshP90Ratio: .85, minFreshUnder1Gain: 10 });
const SAMPLE = "authoritative SNAPTEST realLife 200, seed 20260803";
const METADATA = ["id", "name", "scene", "index", "nx", "ny", "rotation", "coverage", "clipped", "layout", "occ", "pool"];
const numeric = value => typeof value === "number" && Number.isFinite(value) && value >= 0;
const percentile = values => {
  const sorted = values.filter(numeric).sort((a, b) => a - b);
  return { n: sorted.length, p50: sorted[Math.floor(sorted.length * .5)] ?? null,
    p90: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .9))] ?? null, max: sorted.at(-1) ?? null };
};
const isCorrect = (row, mode) => row[mode]?.got === row.name;
function summarize(rows, mode) {
  const bucket = list => {
    const accepted = list.filter(row => CONFIDENT.has(row[mode]?.by));
    const acceptedCorrect = accepted.filter(row => isCorrect(row, mode)).length;
    return { n: list.length, correct: list.filter(row => isCorrect(row, mode)).length,
      correctUnder1s: list.filter(row => isCorrect(row, mode) && numeric(row[mode]?.displayMs) && row[mode].displayMs < 1000).length,
      confident: { n: accepted.length, correct: acceptedCorrect, precision: accepted.length ? acceptedCorrect / accepted.length : null },
      displayMs: percentile(list.map(row => row[mode]?.displayMs)) };
  };
  const group = (key, label = row => String(row[key])) => Object.fromEntries([...new Set(rows.map(label))].map(value => [value, bucket(rows.filter(row => label(row) === value))]));
  return { ...bucket(rows), firstHalf: bucket(rows.slice(0, 100)), secondHalf: bucket(rows.slice(100)),
    byRotation: group("rotation"), byLayout: group("layout"), byPool: group("pool"),
    byCoverage: group("coverage", row => row.coverage === 0 ? "clear" : row.coverage < .15 ? "0-15%" : row.coverage < .3 ? "15-30%" : "30%+"),
    byPathway: group("by", row => row[mode]?.by || "(unresolved)"),
    captureMs: percentile(rows.map(row => row[mode]?.timing?.captureMs)),
    recognitionMs: percentile(rows.map(row => row[mode]?.timing?.recognitionMs)) };
}

export function validateNativePair(control, candidate, thresholds = {}) {
  return evaluateNativePair(control, candidate, { ...NATIVE_PAIR_THRESHOLDS, ...thresholds }, false);
}
export function validateNativeTailPair(control, candidate, thresholds = {}) {
  return evaluateNativePair(control, candidate, { ...NATIVE_TAIL_THRESHOLDS, ...thresholds }, true);
}
function evaluateNativePair(control, candidate, thresholds, tail) {
  const failures = [], captureMismatches = [], regressions = [], confidentErrors = [], winnerChanges = [];
  const fail = message => failures.push(message);
  let sourceProofValid = true;
  const pairFail = message => { sourceProofValid = false; fail(message); };
  const arms = { control, candidate };
  for (const [name, arm] of Object.entries(arms)) {
    if (!arm || arm.ok !== true) fail(`${name}: benchmark did not complete successfully`);
    if (arm?.sample !== SAMPLE) fail(`${name}: authoritative 200-card sampler is required`);
    if (!Array.isArray(arm?.rows) || arm.rows.length !== 200) fail(`${name}: complete all 200 fresh lookups`);
    for (const key of ["errors", "blockedWrites", "nativeErrors"]) {
      if (!Array.isArray(arm?.[key]) || arm[key].length) fail(`${name}: ${key} must be an empty recorded array`);
    }
    if (arm?.warmup?.core?.status !== "ready" || arm?.warmup?.milo?.status !== "ready") fail(`${name}: both recognition core and Milo must be warm`);
    if (!arm?.build || !arm?.commit) fail(`${name}: record the frozen build and commit`);
    for (const file of ["src/webrtc.js", "src/Game.jsx", "src/recognition/matcher.js", "src/recognition/recognizer.js", "src/snaptest/scene.js"]) {
      if (!SHA256.test(arm?.sourceDigests?.[file] || "")) fail(`${name}: missing frozen source digest for ${file}`);
    }
    for (const file of CATALOG_FILES) if (!SHA256.test(arm?.catalogDigests?.[file] || "")) pairFail(`${name}: missing frozen catalog digest for ${file}`);
    const manifest = arm?.catalog?.manifest, milo = arm?.catalog?.milo;
    if (!Number.isSafeInteger(manifest?.count) || manifest.count < 1 || milo?.count !== manifest.count
      || milo?.model !== "milo1" || milo?.dimension !== 128 || !/^[a-f0-9]{40}$/.test(milo?.revision || "")
      || !SHA256.test(milo?.model_sha256 || "") || !SHA256.test(milo?.seed_sha256 || "")
      || !milo?.preprocess || milo?.cards_sha256 !== arm?.catalogDigests?.["public/carddata/cards.json"])
      pairFail(`${name}: record compatible Milo model/gallery identity, count and cards fingerprint`);
    for (const [file, bytesPerRow] of [["vectors.bin", 128], ["norms.bin", 4], ["names.bin", 4]]) {
      if (!SHA256.test(milo?.files?.[file]?.sha256 || "") || milo?.files?.[file]?.bytes !== milo?.count * bytesPerRow) pairFail(`${name}: incomplete Milo gallery proof for ${file}`);
    }
  }
  if (control?.sourceDigests?.["src/snaptest/scene.js"] !== candidate?.sourceDigests?.["src/snaptest/scene.js"]) pairFail("scene rendering source must be identical");
  for (const file of CATALOG_FILES) if (control?.catalogDigests?.[file] !== candidate?.catalogDigests?.[file]) pairFail(`frozen catalog must be identical: ${file}`);
  if (JSON.stringify(control?.catalog) !== JSON.stringify(candidate?.catalog)) pairFail("model/gallery metadata and card counts must be identical");
  const oldRows = Array.isArray(control?.rows) ? control.rows : [];
  const newRows = Array.isArray(candidate?.rows) ? candidate.rows : [];
  const anyRepeats = oldRows.some(row => row.repeat != null) || newRows.some(row => row.repeat != null);
  const allRepeats = oldRows.length === 200 && newRows.length === 200 && oldRows.every(row => row.repeat != null) && newRows.every(row => row.repeat != null);
  if (anyRepeats && !allRepeats) fail("repeat lookups must be complete in both reports or absent from both");
  const modes = allRepeats ? ["fresh", "repeat"] : ["fresh"];
  const expectedCaptures = 200 * modes.length;
  let matchedCaptures = 0;
  for (let i = 0; i < 200; i++) {
    const old = oldRows[i], next = newRows[i];
    if (!old || !next) continue;
    if (old.scene !== Math.floor(i / 10) || old.index !== i % 10 || next.scene !== old.scene || next.index !== old.index) pairFail(`row ${i}: preserve complete scene and click order`);
    if (METADATA.some(key => old[key] !== next[key])) pairFail(`row ${i}: changed ground truth, geometry, rotation or layout`);
    if (!old.id || !old.name || !old.rotation || !old.layout || !numeric(old.nx) || old.nx > 1 || !numeric(old.ny) || old.ny > 1) fail(`row ${i}: incomplete source identity/click metadata`);
    for (const mode of modes) {
      const a = old[mode], b = next[mode];
      if (!a || !b) { fail(`row ${i} ${mode}: missing lookup`); continue; }
      const oldHash = a.capture?.sha256, newHash = b.capture?.sha256;
      if (!SHA256.test(oldHash || "") || !SHA256.test(newHash || "") || oldHash !== newHash) {
        captureMismatches.push({ scene: old.scene, index: old.index, name: old.name, mode, control: oldHash || null, candidate: newHash || null });
      } else matchedCaptures++;
      for (const [armName, value] of [["control", a], ["candidate", b]]) {
        const label = `row ${i} ${mode} ${armName}`;
        if (value.correct !== (value.got === old.name)) fail(`${label}: correct flag disagrees with displayed name`);
        if (value.error) fail(`${label}: scan error`);
        if (mode === "fresh" && value.timing?.hintHit !== false) fail(`${label}: a fresh lookup cannot use a prior recognition hint`);
        if (value.timing?.remote !== true) fail(`${label}: native remote transport evidence is required`);
        if (CONFIDENT.has(value.by) && (!numeric(value.confidence) || value.confidence > 1 || !value.winner || !UUID.test(value.winner.id || "") || ![0, 1].includes(value.winner.face))) fail(`${label}: confident result lacks confidence/winning printing-face metadata`);
        const capture = value.capture;
        if (!capture || !numeric(capture.width) || capture.width < 1 || !numeric(capture.height) || capture.height < 1 || !numeric(capture.bytes) || capture.bytes < 1) fail(`${label}: missing native capture dimensions/bytes`);
        const frames = capture?.frames;
        if (!Array.isArray(frames) || frames.length !== 3 || frames.some((frame, j) => frame.index !== j || !numeric(frame.at) || !numeric(frame.score))) fail(`${label}: record exactly three native samples`);
        else {
          if (frames.some((frame, j) => j > 0 && frame.at - frames[j - 1].at < 110)) fail(`${label}: native sample intervals changed`);
          const best = frames.reduce((winner, frame) => frame.score > winner.score ? frame : winner, frames[0]).index;
          if (capture.selected !== best) fail(`${label}: selected sample is not the unchanged sharpness winner`);
        }
        if (value.got != null && (!numeric(value.displayMs) || !value.image || value.image.width < 1 || value.image.height < 1 || value.image.opacity !== 1)) fail(`${label}: displayed answer lacks decoded full-opacity paint evidence`);
        for (const key of ["captureMs", "recognitionMs", "totalMs"]) if (!numeric(value.timing?.[key])) fail(`${label}: missing ${key}`);
        if (numeric(value.displayMs) && value.displayMs < value.timing?.totalMs) fail(`${label}: paint precedes the completed lookup`);
      }
      if (a.capture?.width !== b.capture?.width || a.capture?.height !== b.capture?.height || a.capture?.bytes !== b.capture?.bytes) fail(`row ${i} ${mode}: source capture dimensions/bytes changed`);
      if (isCorrect(old, mode) && !isCorrect(next, mode)) regressions.push({ scene: old.scene, index: old.index, name: old.name, mode, got: b.got });
      if (CONFIDENT.has(b.by) && !isCorrect(next, mode)) confidentErrors.push({ scene: old.scene, index: old.index, name: old.name, mode, got: b.got, by: b.by });
      if (a.winner?.id !== b.winner?.id || a.winner?.face !== b.winner?.face || a.by !== b.by || a.confidence !== b.confidence) {
        winnerChanges.push({ scene: old.scene, index: old.index, name: old.name, mode,
          control: { got: a.got, winner: a.winner, by: a.by, confidence: a.confidence },
          candidate: { got: b.got, winner: b.winner, by: b.by, confidence: b.confidence } });
      }
      if (a.got === b.got && a.winner && b.winner && a.winner.face !== b.winner.face) fail(`row ${i} ${mode}: winning face changed for the same named card`);
    }
  }
  if (captureMismatches.length || matchedCaptures !== expectedCaptures) fail("not valid exact paired evidence: every JPEG capture hash must match across all 200 fresh lookups and any included repeats; differing physics frames cannot verify the same-pixel comparison");
  if (regressions.length) fail("candidate regressed previously correct identities");
  if (confidentErrors.length) fail("candidate has wrong confident answers");
  const summary = Object.fromEntries(modes.map(mode => [mode, { control: summarize(oldRows, mode), candidate: summarize(newRows, mode) }]));
  for (const mode of modes) {
    if (!summary[mode].control.confident.n || !summary[mode].candidate.confident.n) fail(`${mode}: confident precision buckets must be nonzero`);
  }
  const gains = Object.fromEntries(modes.map(mode => [mode, {
    medianRatio: summary[mode].candidate.displayMs.p50 / summary[mode].control.displayMs.p50,
    p90Ratio: summary[mode].candidate.displayMs.p90 / summary[mode].control.displayMs.p90,
    correctUnder1s: summary[mode].candidate.correctUnder1s - summary[mode].control.correctUnder1s,
  }]));
  const declared = tail ? NATIVE_TAIL_THRESHOLDS : NATIVE_PAIR_THRESHOLDS;
  const thresholdKeys = ["maxFreshMedianRatio", "minFreshUnder1Gain", ...(tail ? ["maxFreshP90Ratio"] : []),
    ...(allRepeats ? ["maxRepeatMedianRatio", "minRepeatUnder1Gain", ...(tail ? ["maxRepeatP90Ratio"] : [])] : [])];
  const thresholdsReady = thresholdKeys.every(key => numeric(thresholds[key]))
    && thresholds.maxFreshMedianRatio > 0 && thresholds.maxFreshMedianRatio <= declared.maxFreshMedianRatio
    && Number.isInteger(thresholds.minFreshUnder1Gain) && thresholds.minFreshUnder1Gain >= declared.minFreshUnder1Gain
    && (!tail || thresholds.maxFreshP90Ratio > 0 && thresholds.maxFreshP90Ratio <= declared.maxFreshP90Ratio)
    && (!allRepeats || thresholds.maxRepeatMedianRatio > 0 && Number.isInteger(thresholds.minRepeatUnder1Gain)
      && (!tail || thresholds.maxRepeatP90Ratio > 0));
  if (!thresholdsReady) fail(tail ? "tail thresholds must retain predeclared median ratio <=1.05, p90 ratio <=0.85 and correct subsecond gain >=10; included repeats require explicit thresholds"
    : "latency thresholds must retain predeclared fresh median ratio <=0.9 and correct subsecond gain >=5; included repeats require explicit thresholds");
  else for (const mode of modes) {
    const prefix = mode === "fresh" ? "Fresh" : "Repeat";
    if (!(gains[mode].medianRatio <= thresholds[`max${prefix}MedianRatio`])) fail(`${mode}: median reduction does not meet the measured threshold`);
    if (tail && !(gains[mode].p90Ratio <= thresholds[`max${prefix}P90Ratio`])) fail(`${mode}: p90 reduction does not meet the measured threshold`);
    if (!(gains[mode].correctUnder1s >= thresholds[`min${prefix}Under1Gain`])) fail(`${mode}: correct subsecond count does not meet the measured threshold`);
  }
  return { ok: failures.length === 0, exactPaired: sourceProofValid && captureMismatches.length === 0 && matchedCaptures === expectedCaptures,
    status: !sourceProofValid || captureMismatches.length || matchedCaptures !== expectedCaptures ? "not-valid-exact-pair" : failures.length ? "failed" : "passed",
    note: "Additional native click-to-paint gate only; the existing recognition accuracy release matrix remains required and unchanged.",
    builds: { control: control?.build, candidate: candidate?.build }, modes, matchedCaptures, expectedCaptures,
    matchedSourceCaptures: matchedCaptures * 2,
    policy: tail ? "tail-improvement" : "median-improvement", predeclaredFreshThresholds: declared, thresholds, gains, summary,
    catalogDigests: control?.catalogDigests, catalog: control?.catalog,
    regressions, confidentErrors, winnerChanges, captureMismatches, failures };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [controlPath, candidatePath, ...args] = process.argv.slice(2);
  if (!controlPath || !candidatePath) throw new Error("Usage: check_native_card_delivery_pair.mjs CONTROL.json CANDIDATE.json [--tail-improvement] [--max-fresh-median-ratio=R --max-fresh-p90-ratio=R --min-fresh-under1-gain=N] [--output=FILE]; default 0.9 median/+5 or tail 1.05 median/0.85 p90/+10 may only become stricter; included repeats also require explicit thresholds");
  const flags = Object.fromEntries(args.map(arg => { const [key, ...value] = arg.replace(/^--/, "").split("="); return [key, value.join("=")]; }));
  const thresholds = Object.fromEntries(["max-fresh-median-ratio", "max-fresh-p90-ratio", "min-fresh-under1-gain", "max-repeat-median-ratio", "max-repeat-p90-ratio", "min-repeat-under1-gain"].filter(key => flags[key] !== undefined).map(key => [key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), Number(flags[key])]));
  if (flags["tail-improvement"] !== undefined && !["", "1", "true"].includes(flags["tail-improvement"])) throw new Error("Use --tail-improvement without a value (or =true/=1)");
  const validate = flags["tail-improvement"] !== undefined ? validateNativeTailPair : validateNativePair;
  const result = validate(JSON.parse(readFileSync(controlPath)), JSON.parse(readFileSync(candidatePath)), thresholds);
  const evidenceDirectory = flags.output ? path.dirname(path.resolve(flags.output)) : process.cwd();
  result.inputs = Object.fromEntries([["control",controlPath],["candidate",candidatePath]].map(([arm,file]) => [arm, {
    file: path.relative(evidenceDirectory,path.resolve(file)),
    sha256: createHash("sha256").update(readFileSync(file)).digest("hex"),
  }]));
  const json = JSON.stringify(result, null, 2) + "\n";
  if (flags.output) writeFileSync(flags.output, json);
  console.log(json);
  process.exitCode = result.ok ? 0 : 1;
}

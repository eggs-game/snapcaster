#!/usr/bin/env node
// Additional native click-to-paint evidence. This does not replace or relax
// check_recognition_release.mjs and its unchanged accuracy release matrix.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CONFIDENT = new Set(["art-match", "visual-exact", "recent-hint", "ocr-title"]);
const SHA256 = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const CATALOG_FILES = ["public/carddata/manifest.json", "public/carddata/cards.json", "public/carddata/milo/manifest.json"];
// Declared before the full native pair. Callers may make these stricter,
// never relax them to fit the observed outcome.
export const NATIVE_PAIR_THRESHOLDS = Object.freeze({ maxFreshMedianRatio: .9, minFreshUnder1Gain: 5 });
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
  thresholds = { ...NATIVE_PAIR_THRESHOLDS, ...thresholds };
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
    correctUnder1s: summary[mode].candidate.correctUnder1s - summary[mode].control.correctUnder1s,
  }]));
  const thresholdKeys = ["maxFreshMedianRatio", "minFreshUnder1Gain", ...(allRepeats ? ["maxRepeatMedianRatio", "minRepeatUnder1Gain"] : [])];
  const thresholdsReady = thresholdKeys.every(key => numeric(thresholds[key]))
    && thresholds.maxFreshMedianRatio > 0 && thresholds.maxFreshMedianRatio <= NATIVE_PAIR_THRESHOLDS.maxFreshMedianRatio
    && Number.isInteger(thresholds.minFreshUnder1Gain) && thresholds.minFreshUnder1Gain >= NATIVE_PAIR_THRESHOLDS.minFreshUnder1Gain
    && (!allRepeats || thresholds.maxRepeatMedianRatio > 0 && Number.isInteger(thresholds.minRepeatUnder1Gain));
  if (!thresholdsReady) fail("latency thresholds must retain predeclared fresh median ratio <=0.9 and correct subsecond gain >=5; included repeats require explicit thresholds");
  else for (const mode of modes) {
    const prefix = mode === "fresh" ? "Fresh" : "Repeat";
    if (!(gains[mode].medianRatio <= thresholds[`max${prefix}MedianRatio`])) fail(`${mode}: median reduction does not meet the measured threshold`);
    if (!(gains[mode].correctUnder1s >= thresholds[`min${prefix}Under1Gain`])) fail(`${mode}: correct subsecond count does not meet the measured threshold`);
  }
  return { ok: failures.length === 0, exactPaired: sourceProofValid && captureMismatches.length === 0 && matchedCaptures === expectedCaptures,
    status: !sourceProofValid || captureMismatches.length || matchedCaptures !== expectedCaptures ? "not-valid-exact-pair" : failures.length ? "failed" : "passed",
    note: "Additional native click-to-paint gate only; the existing recognition accuracy release matrix remains required and unchanged.",
    builds: { control: control?.build, candidate: candidate?.build }, modes, matchedCaptures, expectedCaptures,
    matchedSourceCaptures: matchedCaptures * 2,
    predeclaredFreshThresholds: NATIVE_PAIR_THRESHOLDS, thresholds, gains, summary,
    catalogDigests: control?.catalogDigests, catalog: control?.catalog,
    regressions, confidentErrors, winnerChanges, captureMismatches, failures };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [controlPath, candidatePath, ...args] = process.argv.slice(2);
  if (!controlPath || !candidatePath) throw new Error("Usage: check_native_card_delivery_pair.mjs CONTROL.json CANDIDATE.json [--max-fresh-median-ratio=R --min-fresh-under1-gain=N] [--max-repeat-median-ratio=R --min-repeat-under1-gain=N] [--output=FILE]; fresh defaults are predeclared 0.9/+5 and may only become stricter");
  const flags = Object.fromEntries(args.map(arg => { const [key, ...value] = arg.replace(/^--/, "").split("="); return [key, value.join("=")]; }));
  const thresholds = Object.fromEntries(["max-fresh-median-ratio", "min-fresh-under1-gain", "max-repeat-median-ratio", "min-repeat-under1-gain"].filter(key => flags[key] !== undefined).map(key => [key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), Number(flags[key])]));
  const result = validateNativePair(JSON.parse(readFileSync(controlPath)), JSON.parse(readFileSync(candidatePath)), thresholds);
  const json = JSON.stringify(result, null, 2) + "\n";
  if (flags.output) writeFileSync(flags.output, json);
  console.log(json);
  process.exitCode = result.ok ? 0 : 1;
}

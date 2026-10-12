#!/usr/bin/env node
// Offline evidence checks only: no browser, renderer, or recognition work.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modes = ["oldWarm", "noHints", "staleHint"];
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const winner = value => ({ got: value.got, by: value.by, confidence: value.confidence, winner: value.winner });
const capture = value => Object.fromEntries(["sha256", "bytes", "width", "height", "geometry", "nx", "ny", "selected", "firstSelected"].map(key => [key, value[key]]));
const correct = (row, mode) => row[mode].got === (mode === "oldWarm" ? row.oldName : row.expectedName);
// The portable archive drops duplicated baseline timing/result objects. Bind
// every immutable source/click field rather than those optional copies.
const selected = row => Object.fromEntries(["i", "expectedName", "expectedID", "expectedNativeWinner", "scene", "index", "point", "targetNX", "targetNY", "oldName", "oldScene", "oldIndex", "oldNX", "oldNY", "distance", "hint", "rotation", "coverage", "layout", "pool", "oldCapture", "targetCapture"].map(key => [key, ["oldCapture", "targetCapture"].includes(key)
  ? Object.fromEntries(["sha256", "bytes", "width", "height", "geometry"].map(field => [field, row[key]?.[field]])) : row[key]]));

function validateOutcome(row, mode) {
  const value = row[mode], label = `case${row.i} ${mode}`;
  assert.ok(value && value.capture, `${label}: actual result/capture required`);
  assert.equal(value.correct, correct(row, mode), `${label}: recorded correctness must match the raw name`);
  assert.match(value.capture.sha256, /^[a-f0-9]{64}$/, `${label}: capture SHA required`);
  assert.equal(value.capture.frames.length, 3, `${label}: all three production samples retained`);
  assert.deepEqual(value.capture.frames.map(frame => frame.index), [0, 1, 2]);
  assert.ok(value.capture.frames.every(frame => Number.isFinite(frame.score) && Number.isFinite(frame.at)));
  if (value.got == null) {
    assert.equal(value.winner, null, `${label}: unresolved has no adopted winner`);
    assert.equal(value.by, null); assert.equal(value.confidence, null);
    return;
  }
  assert.equal(value.correct, true, `${label}: no wrong result may be published`);
  assert.ok(value.winner?.id, `${label}: accepted result requires its actual printing`);
  assert.ok(Number.isInteger(value.winner.face) && value.winner.face >= 0);
  assert.ok(["art-match", "visual-exact", "recent-hint"].includes(value.by), `${label}: result requires verified visual evidence`);
  assert.ok(Number.isFinite(value.confidence) && value.confidence >= 0 && value.confidence <= 1, `${label}: accepted visual result requires its numeric confidence`);
  if (value.by === "art-match") {
    assert.equal(value.winner.clickInside, true, `${label}: source ownership retained`);
    assert.equal(value.winner.regionalProof, true, `${label}: regional source proof retained`);
  }
  assert.equal(value.image?.opacity, 1, `${label}: accepted preview is fully visible`);
}

export function validateNativeHintPair(control, candidate, { expectedSourceDigests, expectedBuild, expectedCatalogDigests } = {}) {
  for (const [name, report] of Object.entries({ control, candidate })) {
    assert.equal(report.ok, true, `${name}: completed native hints report required`);
    assert.equal(report.rows.length, 20, `${name}: subset is ineligible`);
    assert.equal(report.selection.length, 20, `${name}: full predeclared selection required`);
    assert.equal(new Set(report.rows.map(row => row.i)).size, 20, `${name}: duplicate case`);
    assert.deepEqual(report.rows.map(row => row.i), report.selection.map(row => row.i));
    for (const field of ["errors", "blockedWrites", "nativeErrors"]) assert.deepEqual(report[field], [], `${name}: ${field}`);
    assert.ok(Object.keys(report.sourceDigests || {}).length >= 70, `${name}: complete source fingerprints required`);
    for (const digest of Object.values(report.sourceDigests)) assert.match(digest, /^[a-f0-9]{64}$/);
  }
  assert.deepEqual(candidate.selection.map(selected), control.selection.map(selected), "Exact predeclared cases and canonical camera inputs retained");
  assert.deepEqual(candidate.catalogDigests, control.catalogDigests, "Both builds use the same pinned catalog");
  if (expectedSourceDigests) assert.deepEqual(candidate.sourceDigests, expectedSourceDigests, "Candidate fingerprints must match every final source file");
  if (expectedBuild) assert.equal(candidate.build, expectedBuild, "Candidate BUILD must match final source");
  if (expectedCatalogDigests) assert.deepEqual(candidate.catalogDigests, expectedCatalogDigests, "Candidate catalog must match current pinned files");
  const rows = [];
  for (let index = 0; index < 20; index++) {
    const a = control.rows[index], b = candidate.rows[index];
    for (const reportRow of [a, b]) {
      assert.deepEqual(selected(reportRow), selected(control.selection[index]), `case${a.i}: predeclared source/click metadata retained`);
      for (const mode of modes) validateOutcome(reportRow, mode);
      assert.equal(reportRow.oldWarm.correct, true, `case${a.i}: stale hint must originate from a real successful prior lookup`);
      assert.deepEqual(reportRow.noHints.identifyHints, [], `case${a.i}: no-hint arm is actually unhinted`);
      assert.deepEqual(reportRow.noHints.hintsBefore, []);
      const prior = reportRow.oldWarm.winner;
      const hints = reportRow.staleHint.identifyHints;
      assert.ok(hints.some(hint => hint.scryfall_id === prior.id && (hint.face || 0) === prior.face && hint.name === reportRow.oldName), `case${a.i}: real prior printing/face enters the stale lookup`);
      assert.ok(reportRow.staleHint.hintsBefore.some(hint => hint.card?.scryfall_id === prior.id && (hint.card.face || 0) === prior.face));
      assert.ok(!hints.some(hint => hint.name === reportRow.expectedName), `case${a.i}: expected target must not be injected as a hint`);
      assert.notEqual(reportRow.oldName, reportRow.expectedName);
      assert.deepEqual(winner(reportRow.staleHint), winner(reportRow.noHints), `case${a.i}: stale and unhinted raw winning fields must agree`);
    }
    for (const mode of modes) {
      assert.deepEqual(capture(b[mode].capture), capture(a[mode].capture), `case${a.i} ${mode}: exact native JPEG/geometry/selected sample required`);
      const expectedCapture = mode === "oldWarm" ? b.oldCapture : b.targetCapture;
      assert.equal(b[mode].capture.sha256, expectedCapture.sha256, `case${a.i} ${mode}: canonical JPEG SHA`);
      assert.deepEqual(b[mode].capture.geometry, expectedCapture.geometry, `case${a.i} ${mode}: canonical crop geometry`);
      if (a[mode].correct) assert.deepEqual(winner(b[mode]), winner(a[mode]), `case${a.i} ${mode}: preserve old correct printing/pathway/confidence/source proof`);
    }
    rows.push({ i: a.i, expectedName: a.expectedName, oldName: a.oldName, capturesEqual: 3, controlCorrect: correct(a, "noHints"), candidateCorrect: correct(b, "noHints"), controlStaleCorrect: correct(a, "staleHint"), candidateStaleCorrect: correct(b, "staleHint"), preservedPreviousCorrectWinningFields: true, currentNoHintStaleWinningFieldsEqual: true });
  }
  const summarize = report => Object.fromEntries(modes.map(mode => [mode, { n: 20, correct: report.rows.filter(row => correct(row, mode)).length, published: report.rows.filter(row => row[mode].got != null).length, correctUnder1s: report.rows.filter(row => correct(row, mode) && row[mode].displayMs < 1000).length }]));
  return { ok: true, scope: "Exact native stale20 functional/source-evidence parity; targeted timing counts do not qualify a full200 speed release", comparedCases: 20, capturesEqual: 60, sourceFiles: { control: Object.keys(control.sourceDigests).length, candidate: Object.keys(candidate.sourceDigests).length }, builds: { control: control.build, candidate: candidate.build }, summary: { control: summarize(control), candidate: summarize(candidate) }, rows };
}

export function validateValidHintBundle(report, control, candidate, { allowHintMiss = false } = {}) {
  assert.equal(report.ok, true, "Completed valid-hint browser report required");
  for (const field of ["errors", "blockedWrites"]) assert.deepEqual(report[field], []);
  const expected = allowHintMiss ? [[19, 9]] : [[0, 0], [0, 6], [2, 4], [7, 9]];
  assert.deepEqual(report.cases.map(row => [row.scene, row.index]), expected, "Predeclared valid/fallback cases retained");
  for (const [name, metadata] of Object.entries({ control, candidate })) {
    const arm = report.arms[name];
    assert.equal(arm.build, metadata.build);
    assert.equal(arm.runtimeBuild, metadata.build, "Actual compiled Game BUILD agrees with its metadata");
    assert.deepEqual(arm.sourceDigests, metadata.sourceDigests, "Browser arm is bound to the named native bundle source");
    assert.deepEqual(arm.catalogDigests, metadata.catalogDigests);
    assert.deepEqual(arm.nativeErrors, []);
    assert.equal(arm.rows.length, expected.length);
    for (const row of arm.rows) {
      for (const mode of ["fresh", "repeat"]) {
        assert.equal(row[mode].got, row.name);
        assert.ok(Number.isFinite(row[mode].confidence) && row[mode].confidence >= 0 && row[mode].confidence <= 1);
        assert.equal(row[mode].image.opacity, 1);
      }
      const prior = row.fresh.winner;
      assert.ok(row.repeat.hintsBefore.some(hint => hint.card?.scryfall_id === prior.id && (hint.card.face || 0) === prior.face));
      assert.ok(row.repeat.identifyHints.some(hint => hint.scryfall_id === prior.id && (hint.face || 0) === prior.face));
      if (!allowHintMiss) assert.equal(row.repeat.timing.hintHit, true);
    }
  }
  for (let i = 0; i < expected.length; i++) for (const mode of ["fresh", "repeat"]) {
    const a = report.arms.control.rows[i][mode], b = report.arms.candidate.rows[i][mode];
    assert.equal(b.got, a.got); assert.equal(b.by, a.by); assert.equal(b.confidence, a.confidence); assert.deepEqual(b.winner, a.winner);
    assert.deepEqual(capture(b.capture), capture(a.capture));
  }
  return { ok: true, cases: expected.length, scope: allowHintMiss ? "Voja stored-hint miss/fallback" : "Four verified fast-hint controls" };
}

async function sourceDigests(directory, prefix = "src") {
  const values = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = `${prefix}/${entry.name}`, file = path.join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(values, await sourceDigests(file, relative));
    else if (/\.(jsx?|css)$/.test(entry.name)) values[relative] = sha(await readFile(file));
  }
  return Object.fromEntries(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)));
}

async function main() {
  const args = process.argv.slice(2), positional = args.filter(arg => !arg.startsWith("--"));
  const flags = Object.fromEntries(args.filter(arg => arg.startsWith("--")).map(arg => { const [key, ...rest] = arg.slice(2).split("="); return [key, rest.join("=") || "1"]; }));
  assert.equal(positional.length, 2, "Usage: check_native_card_hint_pair.mjs CONTROL.json CANDIDATE.json [--output=PAIR.json] [--validHints=REPORT.json] [--voja=REPORT.json]");
  const reports = await Promise.all(positional.map(async value => { const file = path.resolve(value), bytes = await readFile(file); return { file, bytes, data: JSON.parse(bytes) }; }));
  const [control, candidate] = reports;
  const expectedSourceDigests = await sourceDigests(path.join(root, "src"));
  const expectedBuild = (await readFile(path.join(root, "src/main.jsx"), "utf8")).match(/const BUILD = ("[^"]+")/)?.[1];
  assert.ok(expectedBuild, "Final BUILD marker exists");
  const expectedCatalogDigests = Object.fromEntries(await Promise.all(Object.keys(candidate.data.catalogDigests).map(async file => [file, sha(await readFile(path.join(root, file)))])));
  const proof = validateNativeHintPair(control.data, candidate.data, { expectedSourceDigests, expectedBuild: JSON.parse(expectedBuild), expectedCatalogDigests });
  for (const report of reports) for (const row of report.data.rows) for (const mode of modes) {
    const file = path.resolve(path.dirname(report.file), row[mode].jpegFile);
    assert.ok(file.startsWith(`${path.dirname(report.file)}${path.sep}`), "Captured JPEG path must stay inside its evidence directory");
    assert.equal(sha(await readFile(file)), row[mode].capture.sha256, "Actual captured JPEG bytes agree with the raw report");
  }
  const output = flags.output ? path.resolve(flags.output) : null, evidenceRoot = output ? path.dirname(output) : process.cwd();
  proof.reports = Object.fromEntries(reports.map((report, i) => [i === 0 ? "control" : "candidate", { path: path.relative(evidenceRoot, report.file), sha256: sha(report.bytes) }]));
  for (const [flag, allowHintMiss] of [["validHints", false], ["voja", true]]) if (flags[flag]) {
    const file = path.resolve(flags[flag]), bytes = await readFile(file), report = JSON.parse(bytes);
    for (const [name, metadata] of Object.entries({ control, candidate })) assert.equal(report.arms[name].metadataSHA256, sha(metadata.bytes), "Valid-hint arm must bind the exact named raw native report");
    proof[flag] = { ...validateValidHintBundle(report, control.data, candidate.data, { allowHintMiss }), path: path.relative(evidenceRoot, file), sha256: sha(bytes) };
  }
  proof.sourceDigests = candidate.data.sourceDigests; proof.catalogDigests = candidate.data.catalogDigests;
  if (output) { await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(proof, null, 2) + "\n"); }
  console.log(JSON.stringify({ ok: proof.ok, comparedCases: proof.comparedCases, capturesEqual: proof.capturesEqual, sourceFiles: proof.sourceFiles, summary: proof.summary, output }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.stack || String(error)); process.exitCode = 1; });
